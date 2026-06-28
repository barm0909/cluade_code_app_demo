import { describe, it, expect, beforeEach, vi } from 'vitest';
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
// vi.mock はホイストされるため、参照する変数も vi.hoisted で宣言する
const { mockSheetToJson } = vi.hoisted(() => ({ mockSheetToJson: vi.fn() }));
vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ Sheets: { sheet1: {} }, SheetNames: ['sheet1'] })),
  utils: { sheet_to_json: mockSheetToJson },
}));

// FileReader モック: readAsArrayBuffer を呼ぶと即座に onload を発火する
class MockFileReader {
  onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null;
  readAsArrayBuffer(_file: File) {
    this.onload?.({ target: { result: new ArrayBuffer(0) } });
  }
}
vi.stubGlobal('FileReader', MockFileReader);

const fakeFile = new File([], 'test.xlsx');

beforeEach(() => {
  localStorageMock.clear();
  mockSheetToJson.mockReset();
});

describe('importExcel — 正常系', () => {
  it('一致するSKU・ロットNoの在庫数が更新される', async () => {
    const { result } = renderHook(() => useInventory());

    // サンプルデータの牛乳(ML-001)の最初のロットを取得
    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];
    const newQty = lot.quantity + 5;

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: lot.lotNo, 在庫数: newQty }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.updated).toBe(1);
    expect(res.errors).toHaveLength(0);
    const updatedLot = result.current.products.find(p => p.sku === 'ML-001')!.lots.find(l => l.id === lot.id)!;
    expect(updatedLot.quantity).toBe(newQty);
  });

  it('数量が変わらない行はupdatedにカウントされない', async () => {
    const { result } = renderHook(() => useInventory());

    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: lot.lotNo, 在庫数: lot.quantity }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.updated).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it('複数行を一括更新できる', async () => {
    const { result } = renderHook(() => useInventory());

    const p1 = result.current.products.find(p => p.sku === 'ML-001')!;
    const p2 = result.current.products.find(p => p.sku === 'BR-001')!;

    mockSheetToJson.mockReturnValue([
      { SKU: 'ML-001', ロットNo: p1.lots[0].lotNo, 在庫数: p1.lots[0].quantity + 1 },
      { SKU: 'BR-001', ロットNo: p2.lots[0].lotNo, 在庫数: p2.lots[0].quantity + 2 },
    ]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.updated).toBe(2);
    expect(res.errors).toHaveLength(0);
  });

  it('インポート後にledgerへ入庫トランザクションが追加される', async () => {
    const { result } = renderHook(() => useInventory());

    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];
    const beforeCount = result.current.ledger.length;

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: lot.lotNo, 在庫数: lot.quantity + 3 }]);

    await act(async () => {
      await result.current.importExcel(fakeFile);
    });

    expect(result.current.ledger.length).toBe(beforeCount + 1);
    expect(result.current.ledger[0].type).toBe('入庫');
    expect(result.current.ledger[0].note).toBe('Excelインポート');
  });

  it('在庫数を減らすと出庫トランザクションが記録される', async () => {
    const { result } = renderHook(() => useInventory());

    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: lot.lotNo, 在庫数: lot.quantity - 1 }]);

    await act(async () => {
      await result.current.importExcel(fakeFile);
    });

    expect(result.current.ledger[0].type).toBe('出庫');
  });
});

describe('importExcel — バリデーションエラー', () => {
  it('SKUが空の行はerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: '', ロットNo: '20261231', 在庫数: 10 }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.updated).toBe(0);
    expect(res.errors[0]).toContain('SKUが空');
  });

  it('ロットNoが空の行はerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: '', 在庫数: 10 }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.errors[0]).toContain('ロットNoが空');
  });

  it('在庫数が負の値はerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: '20261231', 在庫数: -1 }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.errors[0]).toContain('在庫数が不正');
  });

  it('在庫数が数値でない場合はerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: '20261231', 在庫数: 'abc' }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.errors[0]).toContain('在庫数が不正');
  });

  it('存在しないSKUはerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: 'UNKNOWN-999', ロットNo: '20261231', 在庫数: 10 }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.errors[0]).toContain('SKUが見つかりません: UNKNOWN-999');
  });

  it('存在しないロットNoはerrorsに追加される', async () => {
    const { result } = renderHook(() => useInventory());

    mockSheetToJson.mockReturnValue([{ SKU: 'ML-001', ロットNo: '99999999', 在庫数: 10 }]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.errors[0]).toContain('ロットが見つかりません');
  });

  it('正常行とエラー行が混在する場合、正常行だけ更新される', async () => {
    const { result } = renderHook(() => useInventory());

    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];
    const newQty = lot.quantity + 5;

    mockSheetToJson.mockReturnValue([
      { SKU: 'ML-001', ロットNo: lot.lotNo, 在庫数: newQty },
      { SKU: 'UNKNOWN', ロットNo: '20261231', 在庫数: 10 },
    ]);

    let res!: { updated: number; errors: string[] };
    await act(async () => {
      res = await result.current.importExcel(fakeFile);
    });

    expect(res.updated).toBe(1);
    expect(res.errors).toHaveLength(1);
  });
});
