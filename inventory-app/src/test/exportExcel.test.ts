import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInventory } from '../useInventory';

// localStorage モック
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

// XLSX モック
const { mockAoaToSheet, mockBookNew, mockBookAppendSheet, mockWriteFile } = vi.hoisted(() => ({
  mockAoaToSheet: vi.fn(() => ({ '!cols': undefined } as Record<string, unknown>)),
  mockBookNew: vi.fn(() => ({})),
  mockBookAppendSheet: vi.fn(),
  mockWriteFile: vi.fn(),
}));
vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    aoa_to_sheet: mockAoaToSheet,
    book_new: mockBookNew,
    book_append_sheet: mockBookAppendSheet,
    sheet_to_json: vi.fn(),
  },
  writeFile: mockWriteFile,
}));

const FIXED_NOW = new Date('2026-06-28T00:00:00.000Z');

beforeEach(() => {
  localStorageMock.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mockAoaToSheet.mockClear();
  mockBookNew.mockClear();
  mockBookAppendSheet.mockClear();
  mockWriteFile.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('exportExcel', () => {
  it('XLSX.writeFile が呼ばれる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('ファイル名に今日の日付が含まれる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    const filename = mockWriteFile.mock.calls[0][1] as string;
    expect(filename).toContain('2026-06-28');
    expect(filename).toMatch(/\.xlsx$/);
  });

  it('ヘッダー行に SKU・ロットNo・在庫数 が含まれる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    const wsData = mockAoaToSheet.mock.calls[0][0] as (string | number)[][];
    expect(wsData[0]).toEqual(['SKU', 'ロットNo', '在庫数']);
  });

  it('各ロットが1行として出力される', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    const wsData = mockAoaToSheet.mock.calls[0][0] as (string | number)[][];

    const totalLots = result.current.products.reduce((s, p) => s + p.lots.length, 0);
    // ヘッダー1行 + ロット数
    expect(wsData).toHaveLength(1 + totalLots);
  });

  it('データ行に SKU・ロットNo・在庫数 が正しく入る', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    const wsData = mockAoaToSheet.mock.calls[0][0] as (string | number)[][];

    // サンプルデータの牛乳(ML-001)の最初のロットを検証
    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];
    const dataRow = wsData.slice(1).find(row => row[0] === 'ML-001' && row[1] === lot.lotNo);
    expect(dataRow).toBeDefined();
    expect(dataRow![2]).toBe(lot.quantity);
  });

  it('ロットのない商品は行が出力されない', () => {
    const { result } = renderHook(() => useInventory());

    // ロットなし商品を追加
    act(() => {
      result.current.addProduct({ name: 'ロットなし商品', sku: 'NO-LOT', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });

    act(() => { result.current.exportExcel(); });
    const wsData = mockAoaToSheet.mock.calls[0][0] as (string | number)[][];
    const hasNoLotRow = wsData.slice(1).some(row => row[0] === 'NO-LOT');
    expect(hasNoLotRow).toBe(false);
  });

  it('商品が複数ロットを持つ場合、それぞれ別の行になる', () => {
    const { result } = renderHook(() => useInventory());

    // 牛乳はサンプルデータで2ロット持っている
    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    expect(product.lots.length).toBeGreaterThanOrEqual(2);

    act(() => { result.current.exportExcel(); });
    const wsData = mockAoaToSheet.mock.calls[0][0] as (string | number)[][];
    const milkRows = wsData.slice(1).filter(row => row[0] === 'ML-001');
    expect(milkRows).toHaveLength(product.lots.length);
  });

  it('ワークシートに列幅(!cols)が設定される', () => {
    const fakeWs: Record<string, unknown> = {};
    mockAoaToSheet.mockReturnValueOnce(fakeWs);
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    expect(fakeWs['!cols']).toBeDefined();
  });

  it('XLSX.utils.book_append_sheet でシート名「在庫インポート」が使われる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportExcel(); });
    const sheetName = mockBookAppendSheet.mock.calls[0][2] as string;
    expect(sheetName).toBe('在庫インポート');
  });
});
