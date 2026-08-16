import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  EMPTY_STOCKTAKE_FILTER,
  stocktakeCsv,
  stocktakeDiffs,
  stocktakeRows,
  stocktakeTotals,
  useInventory,
} from '../useInventory';
import type { Product, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: '20260801', expiryDate: '2026-08-01', quantity: 10, warehouseId: 'wh-sales' },
      { id: 'l2', lotNo: '20260810', expiryDate: '2026-08-10', quantity: 4, warehouseId: 'wh-hold' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l3', lotNo: '20260803', expiryDate: '2026-08-03', quantity: 6, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

// ────────────────────────────────────────────────────────────
// stocktakeRows — 棚卸表の行生成と絞り込み
// ────────────────────────────────────────────────────────────
describe('stocktakeRows', () => {
  it('全ロットを1行ずつ、商品情報を平坦に持った行にする', () => {
    const rows = stocktakeRows(PRODUCTS, EMPTY_STOCKTAKE_FILTER);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      productId: 'p1', productName: '牛乳', productSku: 'ML-001',
      lotId: 'l1', lotNo: '20260801', warehouseId: 'wh-sales',
      bookQuantity: 10, costPrice: 130,
    });
  });

  it('キーワードは商品名・SKU・ロットNoに部分一致する', () => {
    expect(stocktakeRows(PRODUCTS, { ...EMPTY_STOCKTAKE_FILTER, keyword: '食パン' }).map(r => r.lotId)).toEqual(['l3']);
    expect(stocktakeRows(PRODUCTS, { ...EMPTY_STOCKTAKE_FILTER, keyword: 'ml-001' }).map(r => r.lotId)).toEqual(['l1', 'l2']);
    expect(stocktakeRows(PRODUCTS, { ...EMPTY_STOCKTAKE_FILTER, keyword: '20260810' }).map(r => r.lotId)).toEqual(['l2']);
  });

  it('カテゴリと倉庫で絞り込める', () => {
    expect(stocktakeRows(PRODUCTS, { ...EMPTY_STOCKTAKE_FILTER, categoryId: 'cat-dairy' }).map(r => r.lotId)).toEqual(['l1', 'l2']);
    expect(stocktakeRows(PRODUCTS, { ...EMPTY_STOCKTAKE_FILTER, warehouseId: 'wh-sales' }).map(r => r.lotId)).toEqual(['l1', 'l3']);
  });

  it('ロットが実原価を持っていれば、商品の原価ではなくそちらを使う', () => {
    const withUnitPrice: Product[] = PRODUCTS.map(p => p.id === 'p1'
      ? { ...p, lots: p.lots.map(l => l.id === 'l1' ? { ...l, unitPrice: 150 } : l) }
      : p);
    const rows = stocktakeRows(withUnitPrice, EMPTY_STOCKTAKE_FILTER);
    expect(rows.find(r => r.lotId === 'l1')).toMatchObject({ costPrice: 150 });
    expect(rows.find(r => r.lotId === 'l2')).toMatchObject({ costPrice: 130 }); // 原価未設定はフォールバック
  });
});

// ────────────────────────────────────────────────────────────
// stocktakeDiffs / stocktakeTotals — 差異の算出
// ────────────────────────────────────────────────────────────
describe('stocktakeDiffs', () => {
  const rows = stocktakeRows(PRODUCTS, EMPTY_STOCKTAKE_FILTER);

  it('カウント済みの行だけを差異付きで返す（差異0も含む）', () => {
    const diffs = stocktakeDiffs(rows, { l1: 8, l3: 6 });
    expect(diffs.map(d => d.lotId)).toEqual(['l1', 'l3']);
    expect(diffs[0]).toMatchObject({ actualQuantity: 8, diff: -2, diffValue: -260 });
    expect(diffs[1]).toMatchObject({ actualQuantity: 6, diff: 0, diffValue: 0 });
  });

  it('未カウント・不正な値の行は除外する', () => {
    expect(stocktakeDiffs(rows, {})).toEqual([]);
    expect(stocktakeDiffs(rows, { l1: NaN, l2: -1 })).toEqual([]);
  });

  it('差異金額は原価ベースで計算される', () => {
    const [diff] = stocktakeDiffs(rows, { l3: 9 });
    expect(diff.diff).toBe(3);
    expect(diff.diffValue).toBe(270); // 3 × 原価90
  });
});

describe('stocktakeTotals', () => {
  it('一致・棚卸増・棚卸減の件数と差異金額を集計する', () => {
    const rows = stocktakeRows(PRODUCTS, EMPTY_STOCKTAKE_FILTER);
    const totals = stocktakeTotals(stocktakeDiffs(rows, { l1: 8, l2: 4, l3: 9 }));
    expect(totals).toEqual({
      counted: 3,
      matched: 1, // l2
      over: 1, // l3 (+3 × 90 = +270)
      short: 1, // l1 (-2 × 130 = -260)
      diffValue: 10,
    });
  });

  it('カウントがなければすべて0', () => {
    expect(stocktakeTotals([])).toEqual({ counted: 0, matched: 0, over: 0, short: 0, diffValue: 0 });
  });
});

// ────────────────────────────────────────────────────────────
// stocktakeCsv
// ────────────────────────────────────────────────────────────
describe('stocktakeCsv', () => {
  const rows = stocktakeRows(PRODUCTS, EMPTY_STOCKTAKE_FILTER);

  it('ヘッダーとカウント結果を出力する', () => {
    const lines = stocktakeCsv(rows, { l1: 8 }, WAREHOUSES).split('\n');
    expect(lines[0]).toBe('商品名,SKU,ロットNo,賞味期限,倉庫,帳簿在庫,実数,差異,差異金額');
    expect(lines[1]).toBe('牛乳,ML-001,20260801,2026-08-01,販売倉庫,10,8,-2,-260');
  });

  it('未カウントの行は実数・差異を空欄で出す（カウント用紙として使える）', () => {
    const lines = stocktakeCsv(rows, {}, WAREHOUSES).split('\n');
    expect(lines[1]).toBe('牛乳,ML-001,20260801,2026-08-01,販売倉庫,10,,,');
    expect(lines[3]).toBe('食パン,BR-001,20260803,2026-08-03,販売倉庫,6,,,');
  });
});

// ────────────────────────────────────────────────────────────
// applyStocktake — 確定
// ────────────────────────────────────────────────────────────
describe('useInventory — applyStocktake', () => {
  function setup() {
    const { result } = renderHook(() => useInventory());
    act(() => {
      result.current.addProduct({ name: '棚卸テスト', sku: 'ST-001', categoryId: 'cat-dairy', minQuantity: 1, price: 200, costPrice: 100 });
    });
    const product = result.current.products.find(p => p.sku === 'ST-001')!;
    act(() => {
      result.current.addLot(product.id, { lotNo: 'ST-L1', quantity: 10 });
      result.current.addLot(product.id, { lotNo: 'ST-L2', quantity: 5 });
    });
    const lots = result.current.products.find(p => p.id === product.id)!.lots;
    return { result, productId: product.id, lot1: lots[0], lot2: lots[1] };
  }

  it('差異のあるロットだけ実数に更新される', () => {
    const { result, productId, lot1, lot2 } = setup();

    act(() => { result.current.applyStocktake({ [lot1.id]: 7, [lot2.id]: 5 }); });

    const lots = result.current.products.find(p => p.id === productId)!.lots;
    expect(lots.find(l => l.id === lot1.id)!.quantity).toBe(7);
    expect(lots.find(l => l.id === lot2.id)!.quantity).toBe(5);
  });

  it('差異が調整入庫・調整出庫として帳票に記録される', () => {
    const { result, lot1, lot2 } = setup();
    const before = result.current.ledger.length;

    act(() => { result.current.applyStocktake({ [lot1.id]: 7, [lot2.id]: 8 }); });

    expect(result.current.ledger.length).toBe(before + 2);
    const stocktakeTxns = result.current.ledger.filter(t => t.note === '棚卸');
    expect(stocktakeTxns).toHaveLength(2);

    const out = stocktakeTxns.find(t => t.lotNo === 'ST-L1')!;
    expect(out.type).toBe('調整出庫');
    expect(out.quantity).toBe(3);
    expect(out.fromWarehouseId).toBe(lot1.warehouseId);
    expect(out.toWarehouseId).toBeUndefined();

    const inbound = stocktakeTxns.find(t => t.lotNo === 'ST-L2')!;
    expect(inbound.type).toBe('調整入庫');
    expect(inbound.quantity).toBe(3);
    expect(inbound.toWarehouseId).toBe(lot2.warehouseId);
    expect(inbound.fromWarehouseId).toBeUndefined();
  });

  it('差異のないカウントは帳票に記録されず、確定件数にも数えない', () => {
    const { result, lot1, lot2 } = setup();
    const before = result.current.ledger.length;

    let applied = -1;
    act(() => { applied = result.current.applyStocktake({ [lot1.id]: 10, [lot2.id]: 5 }); });

    expect(applied).toBe(0);
    expect(result.current.ledger.length).toBe(before);
  });

  it('確定した件数を返す', () => {
    const { result, lot1, lot2 } = setup();

    let applied = -1;
    act(() => { applied = result.current.applyStocktake({ [lot1.id]: 1, [lot2.id]: 5, 'unknown-lot': 99 }); });

    expect(applied).toBe(1);
  });

  it('実数0のカウントも在庫0として反映される', () => {
    const { result, productId, lot1 } = setup();

    act(() => { result.current.applyStocktake({ [lot1.id]: 0 }); });

    const lots = result.current.products.find(p => p.id === productId)!.lots;
    expect(lots.find(l => l.id === lot1.id)!.quantity).toBe(0);
    expect(result.current.ledger[0]).toMatchObject({ type: '調整出庫', quantity: 10, note: '棚卸' });
  });
});
