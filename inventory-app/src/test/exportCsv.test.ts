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

// URL.createObjectURL / revokeObjectURL モック
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

// Blob に渡されたテキストを取り出すヘルパー
function getBlobText(): string {
  const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
  return (blob as unknown as { _text: string })._text ?? '';
}

// <a> クリックをキャプチャするためのモック
const mockClick = vi.fn();
const mockAnchor = { href: '', download: '', click: mockClick };
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag === 'a') return mockAnchor as unknown as HTMLElement;
  return originalCreateElement(tag);
});

// Blob テキストを同期的に取れるようパッチ
const OriginalBlob = globalThis.Blob;
vi.stubGlobal('Blob', class extends OriginalBlob {
  _text: string;
  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    this._text = parts.map(p => String(p)).join('');
  }
});

const FIXED_NOW = new Date('2026-06-28T00:00:00.000Z');

beforeEach(() => {
  localStorageMock.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mockCreateObjectURL.mockClear();
  mockRevokeObjectURL.mockClear();
  mockClick.mockClear();
  mockAnchor.href = '';
  mockAnchor.download = '';
});
afterEach(() => { vi.useRealTimers(); });

describe('exportCsv', () => {
  it('アンカーの click() が呼ばれる（ダウンロードが発火する）', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it('download 属性に今日の日付を含む .csv ファイル名が設定される', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    expect(mockAnchor.download).toContain('2026-06-28');
    expect(mockAnchor.download).toMatch(/\.csv$/);
  });

  it('href に createObjectURL の戻り値が設定される', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    expect(mockAnchor.href).toBe('blob:mock-url');
  });

  it('URL.revokeObjectURL がクリック後に呼ばれる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('CSVの1行目がヘッダー行になっている', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    const lines = getBlobText().split('\n');
    expect(lines[0]).toBe('商品名,SKU,カテゴリ,販売定価,原価,ロットNo,賞味期限,在庫数');
  });

  it('ロットを持つ商品は各ロットが1行になる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    const lines = getBlobText().split('\n');
    const dataLines = lines.slice(1);

    // 牛乳(ML-001)は2ロットあるのでML-001の行が2行ある
    const milkLines = dataLines.filter(l => l.includes('ML-001'));
    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    expect(milkLines).toHaveLength(product.lots.length);
  });

  it('ロットを持つ商品の行に SKU・ロットNo・在庫数 が含まれる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    const lines = getBlobText().split('\n');

    const product = result.current.products.find(p => p.sku === 'ML-001')!;
    const lot = product.lots[0];
    const matchingLine = lines.find(l => l.includes('ML-001') && l.includes(lot.lotNo));
    expect(matchingLine).toBeDefined();
    expect(matchingLine).toContain(String(lot.quantity));
  });

  it('ロットのない商品は空のロットNo・賞味期限・在庫数0で1行出力される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'ロットなし', sku: 'NO-LOT', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });

    act(() => { result.current.exportCsv(); });
    const lines = getBlobText().split('\n');
    const line = lines.find(l => l.includes('NO-LOT'));
    expect(line).toBeDefined();
    // 行フォーマット: 商品名,SKU,カテゴリ,販売定価,原価,ロットNo(空),賞味期限(空),在庫数(0)
    expect(line).toMatch(/,,,0$/);
  });

  it('賞味期限のないロットは賞味期限列が空になる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.exportCsv(); });
    const lines = getBlobText().split('\n');

    // 値札ラベル(LB-R01)はexpiryDateなし
    const line = lines.find(l => l.includes('LB-R01'));
    expect(line).toBeDefined();
    const cols = line!.split(',');
    expect(cols[6]).toBe(''); // 賞味期限列
  });
});
