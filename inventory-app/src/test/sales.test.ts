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
  taxAmount,
  withTax,
  saleAmounts,
  productTaxRate,
  defaultTaxRateForCategory,
  taxRateLabel,
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
    expect(salesTotals([])).toEqual({
      count: 0, quantity: 0, amount: 0, tax: 0, amountWithTax: 0, cost: 0, profit: 0, profitRate: 0, averageUnitPrice: 0,
      byTaxRate: [
        { taxRate: 8, amount: 0, tax: 0, amountWithTax: 0 },
        { taxRate: 10, amount: 0, tax: 0, amountWithTax: 0 },
      ],
    });
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
    expect(lines[0]).toBe('日時,商品名,SKU,ロットNo,倉庫,得意先,数量,売上単価(税抜),売上金額(税抜),税率,消費税,売上金額(税込),原価単価,原価金額,粗利,粗利率,概算,備考');
    // t3: 4×140=560 → 8% で消費税 45 (44.8 を四捨五入)、税込 605
    expect(lines[1]).toContain(',560,8%,45,605,');
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
    expect(lines[0]).toBe('得意先,補足,件数,数量,売上金額(税抜),消費税,売上金額(税込),原価,粗利,粗利率,構成比');
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

// ────────────────────────────────────────────────────────────
// 消費税 (単価は税抜、税率は商品ごと、明細1行ごとに四捨五入)
// ────────────────────────────────────────────────────────────
describe('消費税の計算', () => {
  it('税抜金額 × 税率を1円未満四捨五入する', () => {
    expect(taxAmount(105, 8)).toBe(8); // 8.4 → 8
    expect(taxAmount(1062, 8)).toBe(85); // 84.96 → 85
    expect(taxAmount(5, 10)).toBe(1); // 0.5 → 1
    expect(taxAmount(0, 10)).toBe(0);
    expect(withTax(198, 8)).toBe(214); // 15.84 → 16
    expect(withTax(1000, 10)).toBe(1100);
  });

  it('税率未設定の商品は軽減税率 8% として扱う', () => {
    expect(productTaxRate(PRODUCTS[0])).toBe(8);
    expect(productTaxRate({ taxRate: 10 })).toBe(10);
    expect(taxRateLabel(8)).toBe('8%（軽減）');
    expect(taxRateLabel(10)).toBe('10%');
  });

  it('saleAmounts は引当 (帳票の1行) ごとに四捨五入して足し上げる', () => {
    // 105円×1個 を2ロットから → 8.4→8 が2行で 16 (まとめて計算すると 16.8→17 になる)
    expect(saleAmounts([1, 1], 105, 8)).toEqual({ amount: 210, tax: 16, amountWithTax: 226 });
    expect(saleAmounts([2], 105, 8)).toEqual({ amount: 210, tax: 17, amountWithTax: 227 });
    expect(saleAmounts([], 105, 8)).toEqual({ amount: 0, tax: 0, amountWithTax: 0 });
  });

  it('新しい商品の税率はカテゴリ内で一番多い税率を初期値にする', () => {
    const products: Product[] = [
      { ...PRODUCTS[0], id: 'a', categoryId: 'cat-label', taxRate: 10 },
      { ...PRODUCTS[0], id: 'b', categoryId: 'cat-label', taxRate: 10 },
      { ...PRODUCTS[0], id: 'c', categoryId: 'cat-label', taxRate: 8 },
      { ...PRODUCTS[0], id: 'd', categoryId: 'cat-dairy', taxRate: 8 },
    ];
    expect(defaultTaxRateForCategory(products, 'cat-label')).toBe(10);
    expect(defaultTaxRateForCategory(products, 'cat-dairy')).toBe(8);
    expect(defaultTaxRateForCategory(products, 'cat-empty')).toBe(8); // 商品がなければ既定値
  });
});

describe('salesRows / salesTotals — 消費税', () => {
  const products: Product[] = [
    { ...PRODUCTS[0], taxRate: 8 },
    { ...PRODUCTS[1], id: 'p3', name: '値札ラベル', sku: 'LB-R01', price: 5, costPrice: 2, taxRate: 10 },
  ];
  const ledger: StockTransaction[] = [
    txn({ id: 's-label', productId: 'p3', productName: '値札ラベル', productSku: 'LB-R01', quantity: 101, unitPrice: 5, costUnitPrice: 2, taxRate: 10 }),
    txn({ id: 's-milk', quantity: 3, unitPrice: 198, costUnitPrice: 118, taxRate: 8 }),
    txn({ id: 's-old', quantity: 1, unitPrice: 200, costUnitPrice: 118 }), // 消費税の導入前の記録 (税率なし)
  ];
  const rows = salesRows(ledger, products, CUSTOMERS);
  const byId = (id: string) => rows.find(r => r.txnId === id)!;

  it('明細1行ごとに消費税と税込金額を持つ', () => {
    // 5×101=505 → 10% で 50.5 → 51
    expect(byId('s-label')).toMatchObject({ amount: 505, taxRate: 10, tax: 51, amountWithTax: 556 });
    // 198×3=594 → 8% で 47.52 → 48
    expect(byId('s-milk')).toMatchObject({ amount: 594, taxRate: 8, tax: 48, amountWithTax: 642 });
  });

  it('粗利は税抜の売上金額から計算する (消費税は粗利に含めない)', () => {
    expect(byId('s-milk').profit).toBe(594 - 3 * 118);
  });

  it('帳票に税率がない古い売上は商品の現在の税率を使い、概算の印はつけない', () => {
    expect(byId('s-old')).toMatchObject({ taxRate: 8, tax: 16, estimatedPrice: false, estimatedCost: false });
  });

  it('帳票に記録された税率が商品の現在の税率より優先される', () => {
    const changed = products.map(p => p.id === 'p1' ? { ...p, taxRate: 10 as const } : p);
    const row = salesRows(ledger, changed, CUSTOMERS).find(r => r.txnId === 's-milk')!;
    expect(row.taxRate).toBe(8);
    expect(row.tax).toBe(48);
  });

  it('合計は明細ごとの消費税の足し上げで、税率別の内訳も出す', () => {
    const totals = salesTotals(rows);
    expect(totals.amount).toBe(505 + 594 + 200);
    expect(totals.tax).toBe(51 + 48 + 16);
    expect(totals.amountWithTax).toBe(totals.amount + totals.tax);
    expect(totals.byTaxRate).toEqual([
      { taxRate: 8, amount: 794, tax: 64, amountWithTax: 858 },
      { taxRate: 10, amount: 505, tax: 51, amountWithTax: 556 },
    ]);
  });

  it('集計にも消費税・税込金額が乗る (構成比は税抜の売上高で計算)', () => {
    const milk = salesProductSummaries(rows).find(s => s.key === 'p1')!;
    expect(milk).toMatchObject({ amount: 794, tax: 64, amountWithTax: 858 });
    expect(milk.share).toBeCloseTo(794 / 1299);
  });
});

// SAMPLE_DATA: 牛乳(id:1) は軽減税率 8%、値札ラベル(id:3) は標準税率 10%
describe('useInventory — 売上出庫に税率を残す', () => {
  it('売上登録は引き当てたロットごとの帳票に出庫時点の税率を書く', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 12, unitPrice: 180, customerId: '' }); });
    act(() => { result.current.recordSale({ productId: '3', quantity: 10, unitPrice: 5, customerId: '' }); });

    const milk = result.current.ledger.filter(t => t.productId === '1');
    expect(milk).toHaveLength(2);
    expect(milk.every(t => t.taxRate === 8)).toBe(true);
    expect(result.current.ledger.find(t => t.productId === '3')!.taxRate).toBe(10);
  });

  it('ロット行の売上出庫にも税率が残り、それ以外の出庫には残らない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.adjustLotQuantity('1', 'l1', -1, '売上出庫', { unitPrice: 198 }); });
    act(() => { result.current.adjustLotQuantity('1', 'l1', -1, '調整出庫'); });

    const [adj, sale] = result.current.ledger;
    expect(sale.type).toBe('売上出庫');
    expect(sale.taxRate).toBe(8);
    expect(adj.type).toBe('調整出庫');
    expect(adj.taxRate).toBeUndefined();
  });

  it('あとで商品の税率を変えても、過去の売上の消費税は変わらない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 1, unitPrice: 1000, customerId: '' }); });
    const milk = result.current.products.find(p => p.id === '1')!;
    act(() => { result.current.updateProduct('1', { ...milk, taxRate: 10 }); });

    const row = salesRows(result.current.ledger, result.current.products, result.current.customers)[0];
    expect(row.taxRate).toBe(8);
    expect(row.tax).toBe(80);
  });

  it('プレビュー (saleAmounts) と記録された売上の消費税が一致する', () => {
    const { result } = renderHook(() => useInventory());
    const milk = result.current.products.find(p => p.id === '1')!;
    // 105円で12個 → l1 から10個 (1050→84)、l2 から2個 (210→16.8→17)
    const plan = planFefoShipment(milk, 12);
    const preview = saleAmounts(plan.allocations.map(a => a.quantity), 105, productTaxRate(milk));

    act(() => { result.current.recordSale({ productId: '1', quantity: 12, unitPrice: 105, customerId: '' }); });

    const totals = salesTotals(salesRows(result.current.ledger, result.current.products, result.current.customers));
    expect(preview).toEqual({ amount: 1260, tax: 101, amountWithTax: 1361 });
    expect(totals.tax).toBe(preview.tax);
    expect(totals.amountWithTax).toBe(preview.amountWithTax);
  });
});
