import { describe, it, expect } from 'vitest';
import {
  EMPTY_COST_HISTORY_FILTER,
  costHistoryCsv,
  costHistoryRows,
  costHistoryTotals,
  filterCostHistory,
} from '../useInventory';
import type { StockTransaction, Supplier } from '../useInventory';

const SUPPLIERS: Supplier[] = [
  { id: 'sup-yamada', name: '山田乳業', code: 'S-001', contact: '', phone: '', email: '', address: '', leadTimeDays: 2, note: '', active: true },
  { id: 'sup-asahi', name: '朝日ベーカリー', code: 'S-002', contact: '', phone: '', email: '', address: '', leadTimeDays: 1, note: '', active: true },
];

const txn = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id' | 'date' | 'type'>): StockTransaction => ({
  productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'A1', quantity: 10, note: '', ...over,
});

// ────────────────────────────────────────────────────────────
// costHistoryRows — 帳票から仕入単価の記録だけを取り出す
// ────────────────────────────────────────────────────────────

describe('costHistoryRows', () => {
  it('区分が「入荷」かつ仕入単価が入っている記録だけを新しい順に返す', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 118, supplierId: 'sup-yamada' }),
      txn({ id: 't2', date: '2026-08-10T00:00:00.000Z', type: '入荷', unitPrice: 120, supplierId: 'sup-yamada' }),
      txn({ id: 't3', date: '2026-08-05T00:00:00.000Z', type: '調整入庫', unitPrice: 100, supplierId: 'sup-yamada' }),
      txn({ id: 't4', date: '2026-08-06T00:00:00.000Z', type: '入荷' }), // unitPrice なし (仕入予定でない入荷)
    ];

    const rows = costHistoryRows(ledger, SUPPLIERS);
    expect(rows.map(r => r.txnId)).toEqual(['t2', 't1']);
  });

  it('仕入単価が0 (未入力) の記録は除外する', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 0, supplierId: 'sup-yamada' }),
    ];
    expect(costHistoryRows(ledger, SUPPLIERS)).toEqual([]);
  });

  it('仕入先名をマスタから解決し、金額 (単価×数量) を計算する', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', quantity: 12, unitPrice: 120, supplierId: 'sup-yamada' }),
    ];
    const [row] = costHistoryRows(ledger, SUPPLIERS);
    expect(row).toMatchObject({ supplierId: 'sup-yamada', supplierName: '山田乳業', unitPrice: 120, quantity: 12, amount: 1440 });
  });

  it('マスタにない仕入先idは空文字の名前になる', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 120, supplierId: 'gone' }),
    ];
    expect(costHistoryRows(ledger, SUPPLIERS)[0]).toMatchObject({ supplierId: 'gone', supplierName: '' });
  });

  it('同一商品×同一仕入先の直前の単価を previousUnitPrice として持つ', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 118, supplierId: 'sup-yamada' }),
      txn({ id: 't2', date: '2026-08-10T00:00:00.000Z', type: '入荷', unitPrice: 120, supplierId: 'sup-yamada' }),
      txn({ id: 't3', date: '2026-08-20T00:00:00.000Z', type: '入荷', unitPrice: 125, supplierId: 'sup-yamada' }),
    ];
    const rows = costHistoryRows(ledger, SUPPLIERS);
    // 新しい順: t3 (前回118→120→125 の120), t2, t1
    expect(rows.find(r => r.txnId === 't3')?.previousUnitPrice).toBe(120);
    expect(rows.find(r => r.txnId === 't2')?.previousUnitPrice).toBe(118);
    expect(rows.find(r => r.txnId === 't1')?.previousUnitPrice).toBeUndefined();
  });

  it('仕入先や商品が異なれば前回比を混同しない', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 118, supplierId: 'sup-yamada' }),
      txn({ id: 't2', date: '2026-08-02T00:00:00.000Z', type: '入荷', unitPrice: 200, supplierId: 'sup-asahi' }),
      txn({ id: 't3', date: '2026-08-03T00:00:00.000Z', type: '入荷', unitPrice: 300, supplierId: 'sup-yamada', productId: 'p2', productName: '食パン', productSku: 'BR-001' }),
    ];
    const rows = costHistoryRows(ledger, SUPPLIERS);
    expect(rows.find(r => r.txnId === 't2')?.previousUnitPrice).toBeUndefined();
    expect(rows.find(r => r.txnId === 't3')?.previousUnitPrice).toBeUndefined();
  });

  it('記録がなければ空配列を返す', () => {
    expect(costHistoryRows([], SUPPLIERS)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// filterCostHistory — キーワード・仕入先・期間での絞り込み
// ────────────────────────────────────────────────────────────

describe('filterCostHistory', () => {
  const ledger: StockTransaction[] = [
    txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', unitPrice: 118, supplierId: 'sup-yamada' }),
    txn({ id: 't2', date: '2026-08-10T00:00:00.000Z', type: '入荷', unitPrice: 210, supplierId: 'sup-asahi', productId: 'p2', productName: '食パン', productSku: 'BR-001' }),
  ];
  const rows = costHistoryRows(ledger, SUPPLIERS);

  it('商品名・SKU・仕入先名の部分一致で絞る', () => {
    expect(filterCostHistory(rows, { ...EMPTY_COST_HISTORY_FILTER, keyword: '食パン' }).map(r => r.txnId)).toEqual(['t2']);
    expect(filterCostHistory(rows, { ...EMPTY_COST_HISTORY_FILTER, keyword: '山田' }).map(r => r.txnId)).toEqual(['t1']);
  });

  it('仕入先で絞る', () => {
    expect(filterCostHistory(rows, { ...EMPTY_COST_HISTORY_FILTER, supplierId: 'sup-asahi' }).map(r => r.txnId)).toEqual(['t2']);
  });

  it('日付範囲で絞る', () => {
    expect(filterCostHistory(rows, { ...EMPTY_COST_HISTORY_FILTER, from: '2026-08-05' }).map(r => r.txnId)).toEqual(['t2']);
    expect(filterCostHistory(rows, { ...EMPTY_COST_HISTORY_FILTER, to: '2026-08-05' }).map(r => r.txnId)).toEqual(['t1']);
  });

  it('条件が空なら全件返す', () => {
    expect(filterCostHistory(rows, EMPTY_COST_HISTORY_FILTER)).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
// costHistoryTotals / costHistoryCsv
// ────────────────────────────────────────────────────────────

describe('costHistoryTotals', () => {
  it('件数・数量加重平均単価・金額合計を出す', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T00:00:00.000Z', type: '入荷', quantity: 10, unitPrice: 100, supplierId: 'sup-yamada' }),
      txn({ id: 't2', date: '2026-08-02T00:00:00.000Z', type: '入荷', quantity: 10, unitPrice: 200, supplierId: 'sup-yamada' }),
    ];
    const totals = costHistoryTotals(costHistoryRows(ledger, SUPPLIERS));
    expect(totals).toEqual({ count: 2, averageUnitPrice: 150, amount: 3000 });
  });

  it('空なら0を返す', () => {
    expect(costHistoryTotals([])).toEqual({ count: 0, averageUnitPrice: 0, amount: 0 });
  });
});

describe('costHistoryCsv', () => {
  it('見出しと行を出力する (前回比なしは空欄)', () => {
    const ledger: StockTransaction[] = [
      txn({ id: 't1', date: '2026-08-01T01:00:00.000Z', type: '入荷', quantity: 10, unitPrice: 118, supplierId: 'sup-yamada' }),
    ];
    const lines = costHistoryCsv(costHistoryRows(ledger, SUPPLIERS)).split('\n');
    expect(lines[0]).toBe('日時,商品名,SKU,ロットNo,仕入先,仕入単価,前回単価,数量,金額');
    expect(lines[1]).toContain('牛乳,ML-001,A1,山田乳業,118,,10,1180');
  });
});
