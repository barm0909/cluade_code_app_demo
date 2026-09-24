import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useInventory,
  productKind,
  isMaterial,
  outboundTypesFor,
  transactionDirection,
  salesRows,
  stockAnalysisRows,
  stockAnalysisTotals,
  filterStockAnalysis,
  stockAnalysisCsv,
  totalQuantity,
  EMPTY_STOCK_ANALYSIS_FILTER,
} from '../useInventory';
import type { Product, StockTransaction } from '../useInventory';

// fetch モックなし = API に到達できない環境として、メモリ内の SAMPLE_DATA で動作する
// SAMPLE_DATA: 牛乳(id:1)・食パン(id:2)・チーズ(id:4) は販売品、値札ラベル(id:3, ロット l4 / 在庫500) は資材
afterEach(() => { vi.unstubAllGlobals(); });

describe('商品区分', () => {
  it('区分が未設定の商品は販売品として扱う', () => {
    expect(productKind({})).toBe('販売品');
    expect(productKind({ kind: '資材' })).toBe('資材');
    expect(isMaterial({})).toBe(false);
    expect(isMaterial({ kind: '資材' })).toBe(true);
  });

  it('販売品は売上出庫、資材は資材使用が既定で、互いの区分は選べない', () => {
    expect(outboundTypesFor({ kind: '販売品' })).toEqual(['売上出庫', '調整出庫', '廃棄']);
    expect(outboundTypesFor({ kind: '資材' })).toEqual(['資材使用', '調整出庫', '廃棄']);
  });

  it('資材使用は出庫として数える', () => {
    expect(transactionDirection('資材使用')).toBe('out');
  });
});

describe('useInventory — 資材の出庫', () => {
  it('FEFO出庫の区分を指定しなければ資材は資材使用になり、単価・得意先・税率は残さない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('3', 30); });

    const txn = result.current.ledger[0];
    expect(txn.type).toBe('資材使用');
    expect(txn.quantity).toBe(30);
    expect(txn.unitPrice).toBeUndefined();
    expect(txn.customerId).toBeUndefined();
    expect(txn.taxRate).toBeUndefined();
    expect(totalQuantity(result.current.products.find(p => p.id === '3')!)).toBe(470);
  });

  it('販売品は区分を指定しなければ従来どおり売上出庫', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.shipFefo('1', 1); });
    expect(result.current.ledger[0].type).toBe('売上出庫');
  });

  it('資材を売上出庫しようとすると、売上にせず調整出庫として記録する', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('3', 5, { type: '売上出庫', unitPrice: 5, customerId: 'cus-midori' }); });
    act(() => { result.current.adjustLotQuantity('3', 'l4', -5, '売上出庫', { unitPrice: 5 }); });

    const [lotTxn, fefoTxn] = result.current.ledger;
    for (const t of [lotTxn, fefoTxn]) {
      expect(t.type).toBe('調整出庫');
      expect(t.unitPrice).toBeUndefined();
      expect(t.customerId).toBeUndefined();
    }
    expect(salesRows(result.current.ledger, result.current.products, result.current.customers)).toHaveLength(0);
  });

  it('販売品を資材使用で出庫しようとすると調整出庫として記録する', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.adjustLotQuantity('1', 'l1', -1, '資材使用'); });
    expect(result.current.ledger[0].type).toBe('調整出庫');
  });

  it('ロット行の出庫で資材使用を選べば資材使用で記録する', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.adjustLotQuantity('3', 'l4', -20, '資材使用'); });
    expect(result.current.ledger[0].type).toBe('資材使用');
    expect(result.current.products.find(p => p.id === '3')!.lots[0].quantity).toBe(480);
  });

  it('資材は売上登録できない (在庫も帳票も動かさず、全量を不足として返す)', () => {
    const { result } = renderHook(() => useInventory());

    let plan = { allocated: -1, shortage: -1 };
    act(() => { plan = result.current.recordSale({ productId: '3', quantity: 10, unitPrice: 5, customerId: '' }); });

    expect(plan).toMatchObject({ allocated: 0, shortage: 10 });
    expect(result.current.ledger).toHaveLength(0);
    expect(totalQuantity(result.current.products.find(p => p.id === '3')!)).toBe(500);
  });

  it('商品マスタで区分を切り替えられる', () => {
    const { result } = renderHook(() => useInventory());
    const milk = result.current.products.find(p => p.id === '1')!;

    act(() => { result.current.updateProduct('1', { ...milk, kind: '資材' }); });

    expect(isMaterial(result.current.products.find(p => p.id === '1')!)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 在庫分析: ABCランクは販売品だけで付ける
// ────────────────────────────────────────────────────────────
const TODAY = new Date(2026, 8, 20, 12, 0, 0); // 2026-09-20
const daysAgo = (n: number) => new Date(2026, 8, 20 - n, 12, 0, 0).toISOString();

const product = (over: Partial<Product> & Pick<Product, 'id' | 'name' | 'costPrice'>): Product => ({
  sku: over.id, categoryId: 'cat', minQuantity: 0, price: 0, updatedAt: '2026-09-01T00:00:00.000Z',
  lots: [{ id: `l-${over.id}`, lotNo: '1', quantity: 10, warehouseId: 'wh-sales' }],
  ...over,
});

const txn = (over: Pick<StockTransaction, 'id' | 'type' | 'productId' | 'quantity'>): StockTransaction => ({
  date: daysAgo(5), productName: '', productSku: '', lotNo: '', note: '', ...over,
});

// ラベル(資材) は出庫金額が一番大きいが、ランクの対象外
const PRODUCTS: Product[] = [
  product({ id: 'milk', name: '牛乳', costPrice: 100 }),
  product({ id: 'bread', name: '食パン', costPrice: 50 }),
  product({ id: 'label', name: '値札ラベル', costPrice: 2, kind: '資材' }),
];
const LEDGER: StockTransaction[] = [
  txn({ id: 't1', type: '売上出庫', productId: 'milk', quantity: 80 }), // 8,000円
  txn({ id: 't2', type: '売上出庫', productId: 'bread', quantity: 40 }), // 2,000円
  txn({ id: 't3', type: '資材使用', productId: 'label', quantity: 10000 }), // 20,000円
];

describe('stockAnalysisRows — 資材', () => {
  const rows = stockAnalysisRows(PRODUCTS, LEDGER, { days: 90, today: TODAY });
  const row = (id: string) => rows.find(r => r.productId === id)!;

  it('資材はランクなし (null) で、販売品のあとに並ぶ', () => {
    expect(rows.map(r => r.productId)).toEqual(['milk', 'bread', 'label']);
    expect(row('label')).toMatchObject({ kind: '資材', rank: null, share: 0, cumulativeShare: 0 });
  });

  it('構成比の分母に資材を入れない', () => {
    expect(row('milk').share).toBeCloseTo(0.8);
    expect(row('bread').cumulativeShare).toBeCloseTo(1);
    expect(row('milk').rank).toBe('A');
    expect(row('bread').rank).toBe('B'); // 手前までの累計が 80% (< 90%)。資材を分母に入れると 20% で A になってしまう
  });

  it('資材使用は出庫数・出庫ペースに数える (滞留・発注点の提案に使う)', () => {
    expect(row('label').outboundQuantity).toBe(10000);
    expect(row('label').salesQuantity).toBe(0);
    expect(row('label').lastOutboundAt).toBe(daysAgo(5));
  });

  it('集計のランク数に資材を入れず、資材の数を別に数える', () => {
    const totals = stockAnalysisTotals(rows, { days: 90 });
    expect(totals.rankCounts).toEqual({ A: 1, B: 1, C: 0 });
    expect(totals.materialCount).toBe(1);
    expect(totals.productCount).toBe(3);
  });

  it('ランクで絞り込むと資材は外れる', () => {
    expect(filterStockAnalysis(rows, { ...EMPTY_STOCK_ANALYSIS_FILTER, rank: 'B' }).map(r => r.productId)).toEqual(['bread']);
  });

  it('CSV では資材のランクを「対象外」、区分を「資材」にする', () => {
    const line = stockAnalysisCsv(rows, []).split('\n')[3];
    expect(line.startsWith('対象外,資材,値札ラベル,')).toBe(true);
  });
});
