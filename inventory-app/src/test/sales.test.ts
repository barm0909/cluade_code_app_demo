import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useInventory,
  salesRows,
  filterSales,
  salesTotals,
  salesProductSummaries,
  salesCustomerSummaries,
  salesDailySummaries,
  salesCsv,
  salesSummaryCsv,
  planFefoShipment,
  totalQuantity,
  EMPTY_SALES_FILTER,
  NO_CUSTOMER,
  SALE_NOTE,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { Customer, Product, StockTransaction, Warehouse } from '../useInventory';

// fetch モックなし = API に到達できない環境として、メモリ内の SAMPLE_DATA で動作する
afterEach(() => { vi.unstubAllGlobals(); });

const WAREHOUSES: Warehouse[] = [
  { id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: 'C-001', contact: '', phone: '', email: '', address: '', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: 'C-002', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0,
    price: 200, costPrice: 130, updatedAt: '2026-01-01T00:00:00.000Z', lots: [],
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 0,
    price: 150, costPrice: 90, updatedAt: '2026-01-01T00:00:00.000Z', lots: [],
  },
];

const txn = (over: Partial<StockTransaction> & { id: string }): StockTransaction => ({
  date: '2026-06-10T01:00:00.000Z',
  type: '売上出庫',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: '20260610',
  quantity: 1,
  note: SALE_NOTE,
  fromWarehouseId: DEFAULT_WAREHOUSE_ID,
  ...over,
});

// 単価つきの売上2件 + 単価のない古い売上1件 + 売上以外の出庫2件
const LEDGER: StockTransaction[] = [
  txn({ id: 't3', date: '2026-06-12T02:00:00.000Z', productId: 'p2', productName: '食パン', productSku: 'BR-001', quantity: 4, unitPrice: 140, costUnitPrice: 88, customerId: 'cus-b' }),
  txn({ id: 't2', date: '2026-06-11T02:00:00.000Z', quantity: 3, unitPrice: 180, costUnitPrice: 120, customerId: 'cus-a' }),
  txn({ id: 't1', date: '2026-06-10T01:00:00.000Z', quantity: 10, unitPrice: 190, costUnitPrice: 118, customerId: 'cus-a' }),
  txn({ id: 't-old', date: '2026-06-09T01:00:00.000Z', quantity: 2, note: 'FEFO出庫' }), // 実売単価・原価・得意先なし
  txn({ id: 't-adj', date: '2026-06-08T01:00:00.000Z', type: '調整出庫', quantity: 5 }),
  txn({ id: 't-disposal', date: '2026-06-08T01:00:00.000Z', type: '廃棄', quantity: 1, unitPrice: 118 }),
];

const ROWS = salesRows(LEDGER, PRODUCTS, CUSTOMERS);

// ────────────────────────────────────────────────────────────
// 売上明細の組み立て (純粋関数)
// ────────────────────────────────────────────────────────────
describe('salesRows', () => {
  it('帳票の売上出庫だけを新しい順に拾う（調整出庫・廃棄は売上ではない）', () => {
    expect(ROWS.map(r => r.txnId)).toEqual(['t3', 't2', 't1', 't-old']);
  });

  it('記録された実売単価と出庫時の原価から売上金額・粗利を出す', () => {
    const row = ROWS.find(r => r.txnId === 't1')!;
    expect(row.unitPrice).toBe(190);
    expect(row.amount).toBe(1900);
    expect(row.unitCost).toBe(118);
    expect(row.cost).toBe(1180);
    expect(row.profit).toBe(720);
    expect(row.profitRate).toBeCloseTo(720 / 1900);
    expect(row.estimatedPrice).toBe(false);
    expect(row.estimatedCost).toBe(false);
  });

  it('得意先は id でマスタから引き直す（改名しても過去の売上に追従する）', () => {
    expect(ROWS.find(r => r.txnId === 't2')!.customerName).toBe('みどりストア');
    expect(ROWS.find(r => r.txnId === 't3')!.customerName).toBe('さくらカフェ');
  });

  it('単価が記録されていない古い売上は販売定価・現在原価で概算する', () => {
    const row = ROWS.find(r => r.txnId === 't-old')!;
    expect(row.unitPrice).toBe(200); // 商品の販売定価
    expect(row.unitCost).toBe(130); // 商品の現在原価
    expect(row.estimatedPrice).toBe(true);
    expect(row.estimatedCost).toBe(true);
    expect(row.customerId).toBe('');
    expect(row.customerName).toBe('');
  });

  it('商品が削除されていても記録は残り、金額は0として扱う', () => {
    const rows = salesRows([txn({ id: 't-gone', productId: 'gone', quantity: 3 })], PRODUCTS, CUSTOMERS);
    expect(rows[0].productName).toBe('牛乳'); // 帳票に残っている当時の名前
    expect(rows[0].amount).toBe(0);
    expect(rows[0].cost).toBe(0);
  });

  it('売上金額が0のときの粗利率は0になる（0除算しない）', () => {
    const rows = salesRows([txn({ id: 't0', quantity: 2, unitPrice: 0, costUnitPrice: 0 })], PRODUCTS, CUSTOMERS);
    expect(rows[0].profitRate).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 絞り込み・合計
// ────────────────────────────────────────────────────────────
describe('filterSales', () => {
  it('条件なしでは全件を返す', () => {
    expect(filterSales(ROWS, EMPTY_SALES_FILTER)).toHaveLength(4);
  });

  it('キーワードは商品名・SKU・得意先名にあたる', () => {
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, keyword: '食パン' }).map(r => r.txnId)).toEqual(['t3']);
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, keyword: 'ml-001' })).toHaveLength(3);
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, keyword: 'みどり' }).map(r => r.txnId)).toEqual(['t2', 't1']);
  });

  it('得意先で絞り込める', () => {
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, customerId: 'cus-a' }).map(r => r.txnId)).toEqual(['t2', 't1']);
  });

  it('「得意先なし」だけを絞り込める', () => {
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, customerId: NO_CUSTOMER }).map(r => r.txnId)).toEqual(['t-old']);
  });

  it('倉庫と期間で絞り込める', () => {
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, warehouseId: 'wh-hold' })).toHaveLength(0);
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, from: '2026-06-11' }).map(r => r.txnId)).toEqual(['t3', 't2']);
    expect(filterSales(ROWS, { ...EMPTY_SALES_FILTER, to: '2026-06-10' }).map(r => r.txnId)).toEqual(['t1', 't-old']);
  });
});

describe('salesTotals', () => {
  it('売上高・原価・粗利・粗利率・平均単価を合計する', () => {
    const totals = salesTotals(ROWS.filter(r => r.txnId !== 't-old'));
    // t3: 4×140=560 (原価 352) / t2: 3×180=540 (原価 360) / t1: 10×190=1900 (原価 1180)
    expect(totals.count).toBe(3);
    expect(totals.quantity).toBe(17);
    expect(totals.amount).toBe(3000);
    expect(totals.cost).toBe(1892);
    expect(totals.profit).toBe(1108);
    expect(totals.profitRate).toBeCloseTo(1108 / 3000);
    expect(totals.averageUnitPrice).toBeCloseTo(3000 / 17);
  });

  it('0件なら全て0（粗利率も0）', () => {
    expect(salesTotals([])).toEqual({ count: 0, quantity: 0, amount: 0, cost: 0, profit: 0, profitRate: 0, averageUnitPrice: 0 });
  });
});

// ────────────────────────────────────────────────────────────
// 集計 (商品別・得意先別・日別)
// ────────────────────────────────────────────────────────────
describe('salesProductSummaries', () => {
  it('商品ごとに足し上げ、売上高の多い順に構成比をつける', () => {
    const rows = ROWS.filter(r => r.txnId !== 't-old');
    const summaries = salesProductSummaries(rows);
    expect(summaries.map(s => s.label)).toEqual(['牛乳', '食パン']);
    const milk = summaries[0];
    expect(milk.count).toBe(2);
    expect(milk.quantity).toBe(13);
    expect(milk.amount).toBe(2440);
    expect(milk.profit).toBe(2440 - 1540);
    expect(milk.share).toBeCloseTo(2440 / 3000);
    expect(summaries[1].sub).toBe('BR-001');
  });
});

describe('salesCustomerSummaries', () => {
  it('得意先ごとに足し上げ、得意先なしの売上は1つにまとめる', () => {
    const summaries = salesCustomerSummaries(ROWS);
    expect(summaries.map(s => s.label)).toEqual(['みどりストア', 'さくらカフェ', '得意先なし']);
    expect(summaries[0].amount).toBe(2440);
    expect(summaries.find(s => s.key === '')!.count).toBe(1);
  });

  it('マスタから消えた得意先の売上も残す', () => {
    const summaries = salesCustomerSummaries(salesRows([txn({ id: 'x', customerId: 'gone', unitPrice: 100 })], PRODUCTS, CUSTOMERS));
    expect(summaries[0].label).toBe('（削除された得意先）');
  });
});

describe('salesDailySummaries', () => {
  it('日別は売上高順ではなく新しい日付順に並べる', () => {
    const summaries = salesDailySummaries(ROWS);
    expect(summaries.map(s => s.key)).toEqual([...summaries.map(s => s.key)].sort().reverse());
    expect(summaries).toHaveLength(4);
  });
});

// ────────────────────────────────────────────────────────────
// CSV
// ────────────────────────────────────────────────────────────
describe('salesCsv / salesSummaryCsv', () => {
  it('明細CSVは見出し + 絞り込み後の行を出す', () => {
    const lines = salesCsv(ROWS.slice(0, 1), WAREHOUSES).split('\n');
    expect(lines[0]).toBe('日時,商品名,SKU,ロットNo,倉庫,得意先,数量,売上単価,売上金額,原価単価,原価金額,粗利,粗利率,概算,備考');
    expect(lines[1]).toContain('食パン');
    expect(lines[1]).toContain('販売倉庫');
    expect(lines[1]).toContain('さくらカフェ');
    expect(lines).toHaveLength(2);
  });

  it('概算の行には印がつく', () => {
    const line = salesCsv(ROWS.filter(r => r.txnId === 't-old'), WAREHOUSES).split('\n')[1];
    expect(line).toContain('概算');
  });

  it('集計CSVは切り口の名前を1列目の見出しにする', () => {
    const lines = salesSummaryCsv(salesCustomerSummaries(ROWS), '得意先').split('\n');
    expect(lines[0]).toBe('得意先,補足,件数,数量,売上金額,原価,粗利,粗利率,構成比');
    expect(lines).toHaveLength(4);
  });
});

// ────────────────────────────────────────────────────────────
// 引当プレビュー (原価つき)
// ────────────────────────────────────────────────────────────
describe('planFefoShipment — 原価', () => {
  it('ロットの原価 (未設定なら商品の原価) を引当ごとに持たせ、合計も返す', () => {
    const day = (offset: number) => {
      const dt = new Date();
      dt.setDate(dt.getDate() + offset);
      return dt.toISOString().slice(0, 10);
    };
    const product: Product = {
      ...PRODUCTS[0],
      lots: [
        { id: 'l1', lotNo: '20260601', expiryDate: day(3), quantity: 2, warehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 118 },
        { id: 'l2', lotNo: '20260701', expiryDate: day(10), quantity: 5, warehouseId: DEFAULT_WAREHOUSE_ID },
      ],
    };
    const plan = planFefoShipment(product, 4);
    expect(plan.allocations.map(a => a.unitCost)).toEqual([118, 130]);
    expect(plan.cost).toBe(2 * 118 + 2 * 130);
  });
});

// ────────────────────────────────────────────────────────────
// 売上の記録 (フック)
// ────────────────────────────────────────────────────────────
// SAMPLE_DATA: 牛乳(id:1) = l1(10個/原価118) + l2(10個/原価120)、販売定価198
describe('useInventory — recordSale', () => {
  it('FEFO で在庫を引き落とし、売上出庫として帳票に残す', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 12, unitPrice: 180, customerId: 'cus-midori' }); });

    const milk = result.current.products.find(p => p.id === '1')!;
    expect(totalQuantity(milk)).toBe(8);

    const txns = result.current.ledger.filter(t => t.productId === '1');
    expect(txns).toHaveLength(2);
    expect(txns.every(t => t.type === '売上出庫')).toBe(true);
    expect(txns.every(t => t.note === SALE_NOTE)).toBe(true);
    expect(txns.every(t => t.unitPrice === 180)).toBe(true);
    expect(txns.every(t => t.customerId === 'cus-midori')).toBe(true);
    // 原価は「引き当てたロットの原価」なので、ロットごとに違う値が残る
    expect(txns.map(t => t.costUnitPrice).sort((a, b) => a! - b!)).toEqual([118, 120]);
  });

  it('売上高・原価・粗利が帳票から組み立て直せる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 12, unitPrice: 180, customerId: '' }); });

    const totals = salesTotals(salesRows(result.current.ledger, result.current.products, result.current.customers));
    expect(totals.amount).toBe(12 * 180);
    expect(totals.cost).toBe(10 * 118 + 2 * 120);
    expect(totals.profit).toBe(12 * 180 - (10 * 118 + 2 * 120));
  });

  it('備考を入れるとその備考で記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 1, unitPrice: 198, customerId: '', note: '店頭販売' }); });

    expect(result.current.ledger[0].note).toBe('店頭販売');
  });

  it('単価0は「未入力」として帳票に書かない（集計では販売定価で概算される）', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 1, unitPrice: 0, customerId: '' }); });

    const txn0 = result.current.ledger[0];
    expect(txn0.unitPrice).toBeUndefined();
    expect(txn0.costUnitPrice).toBe(118); // 原価は分かるので残る
    const row = salesRows(result.current.ledger, result.current.products, result.current.customers)[0];
    expect(row.unitPrice).toBe(198); // 商品の販売定価
    expect(row.estimatedPrice).toBe(true);
    expect(row.estimatedCost).toBe(false);
  });

  it('在庫が足りないときは引ける分だけ売上にする', () => {
    const { result } = renderHook(() => useInventory());

    let shortage = 0;
    act(() => { shortage = result.current.recordSale({ productId: '1', quantity: 25, unitPrice: 198, customerId: '' }).shortage; });

    expect(shortage).toBe(5);
    expect(totalQuantity(result.current.products.find(p => p.id === '1')!)).toBe(0);
    expect(salesTotals(salesRows(result.current.ledger, result.current.products, result.current.customers)).quantity).toBe(20);
  });
});

describe('useInventory — 売上以外の出庫', () => {
  it('廃棄や調整出庫には実売単価・得意先・原価を付けない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('1', 1, { type: '調整出庫', unitPrice: 500, customerId: 'cus-midori' }); });

    const txn0 = result.current.ledger[0];
    expect(txn0.type).toBe('調整出庫');
    expect(txn0.unitPrice).toBeUndefined();
    expect(txn0.customerId).toBeUndefined();
    expect(txn0.costUnitPrice).toBeUndefined();
    expect(salesRows(result.current.ledger, result.current.products, result.current.customers)).toHaveLength(0);
  });

  it('ロット行からの売上出庫でも実売単価と得意先を記録できる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.adjustLotQuantity('1', 'l1', -2, '売上出庫', { unitPrice: 150, customerId: 'cus-sakura' }); });

    const txn0 = result.current.ledger[0];
    expect(txn0.type).toBe('売上出庫');
    expect(txn0.quantity).toBe(2);
    expect(txn0.unitPrice).toBe(150);
    expect(txn0.customerId).toBe('cus-sakura');
    expect(txn0.costUnitPrice).toBe(118); // l1 の原価
  });

  it('ロット行からの入庫・調整出庫には売上の項目を付けない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.adjustLotQuantity('1', 'l1', -2, '調整出庫'); });

    expect(result.current.ledger[0].costUnitPrice).toBeUndefined();
    expect(result.current.ledger[0].unitPrice).toBeUndefined();
  });
});
