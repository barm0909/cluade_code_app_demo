import { describe, it, expect } from 'vitest';
import {
  chronologicalLedger,
  isSameLotTraceKey,
  lotStockQuantity,
  lotStockRows,
  lotTraceCandidates,
  lotTraceCsv,
  traceLot,
} from '../useInventory';
import type { Product, StockTransaction, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const at = (local: string) => new Date(local).toISOString();

const txn = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id'>): StockTransaction => ({
  date: at('2026-06-20T10:00:00'),
  type: '入荷',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: '20260701',
  quantity: 10,
  note: '',
  ...over,
});

// 帳票は新しい記録が先頭に積まれる (addTransactions が prepend する) ので、
// テストデータも「新しい順」で並べる。
// 牛乳 20260701: 入荷20 → 保留倉庫へ5移動 → 売上出庫8 → 廃棄2
const LEDGER: StockTransaction[] = [
  txn({ id: 't5', date: at('2026-06-24T09:00:00'), type: '廃棄', quantity: 2, fromWarehouseId: 'wh-hold', note: '一括廃棄' }),
  txn({ id: 't4', date: at('2026-06-23T15:00:00'), type: '売上出庫', quantity: 8, fromWarehouseId: 'wh-sales', note: 'FEFO出庫' }),
  txn({ id: 't3', date: at('2026-06-22T11:00:00'), type: '移動', quantity: 5, fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold', note: '倉庫移動' }),
  // 同じロットNoを持つ別商品 (ロットNoは賞味期限から作るので商品をまたいで重複しうる)
  txn({ id: 'x1', date: at('2026-06-21T10:00:00'), type: '入荷', productId: 'p2', productName: 'チーズ', productSku: 'CS-001', quantity: 7, toWarehouseId: 'wh-sales' }),
  txn({ id: 't1', date: at('2026-06-20T10:00:00'), type: '入荷', quantity: 20, toWarehouseId: 'wh-sales', note: 'ロット追加' }),
];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: '20260701', expiryDate: '2026-07-01', quantity: 9, warehouseId: 'wh-sales' },
      { id: 'l2', lotNo: '20260701', expiryDate: '2026-07-01', quantity: 3, warehouseId: 'wh-hold' },
      { id: 'l3', lotNo: '20260710', expiryDate: '2026-07-10', quantity: 6, warehouseId: 'wh-sales' },
    ],
    updatedAt: at('2026-06-24T09:00:00'),
  },
  {
    id: 'p2', name: 'チーズ', sku: 'CS-001', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 220,
    lots: [
      { id: 'l4', lotNo: '20260701', expiryDate: '2026-07-01', quantity: 7, warehouseId: 'wh-sales' },
    ],
    updatedAt: at('2026-06-21T10:00:00'),
  },
];

const KEY = { productId: 'p1', lotNo: '20260701' };
const ids = (txns: StockTransaction[]) => txns.map(t => t.id);

describe('chronologicalLedger', () => {
  it('新しい順の帳票を古い順に並べ直す', () => {
    expect(ids(chronologicalLedger(LEDGER))).toEqual(['t1', 'x1', 't3', 't4', 't5']);
  });

  it('同じ日時でまとめて記録された分は記録した順のまま保つ', () => {
    // ロット編集の 移動 + 調整出庫 のように、1回の操作で同じ日時の2件が prepend されるケース
    const batched: StockTransaction[] = [
      txn({ id: 'b1', date: at('2026-06-25T10:00:00'), type: '移動', quantity: 5, fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold' }),
      txn({ id: 'b2', date: at('2026-06-25T10:00:00'), type: '調整出庫', quantity: 2, fromWarehouseId: 'wh-hold' }),
      txn({ id: 'b0', date: at('2026-06-20T10:00:00'), type: '入荷', quantity: 20, toWarehouseId: 'wh-sales' }),
    ];
    expect(ids(chronologicalLedger(batched))).toEqual(['b0', 'b1', 'b2']);
  });

  it('空配列でも落ちない', () => {
    expect(chronologicalLedger([])).toEqual([]);
  });
});

describe('traceLot', () => {
  it('入荷→移動→出庫を古い順に並べ、残数の推移を持たせる', () => {
    const trace = traceLot(LEDGER, '20260701', { productId: 'p1' });
    expect(ids(trace.events.map(e => e.txn))).toEqual(['t1', 't3', 't4', 't5']);
    expect(trace.events.map(e => e.balance)).toEqual([20, 20, 12, 10]);
    expect(trace.events.map(e => e.direction)).toEqual(['in', 'move', 'out', 'out']);
  });

  it('入庫合計・出庫合計・帳票上の残数を集計する', () => {
    const trace = traceLot(LEDGER, '20260701', { productId: 'p1' });
    expect(trace.inbound).toBe(20);
    expect(trace.outbound).toBe(10);
    expect(trace.balance).toBe(10);
    expect(trace.moveCount).toBe(1);
  });

  it('出庫を区分ごとに内訳へ分ける', () => {
    const { outboundBreakdown, inboundBreakdown } = traceLot(LEDGER, '20260701', { productId: 'p1' });
    expect(outboundBreakdown).toEqual([
      { type: '売上出庫', count: 1, quantity: 8 },
      { type: '廃棄', count: 1, quantity: 2 },
    ]);
    expect(inboundBreakdown).toEqual([{ type: '入荷', count: 1, quantity: 20 }]);
  });

  it('商品を指定すると同じロットNoの別商品の記録は混ざらない', () => {
    const milk = traceLot(LEDGER, '20260701', { productId: 'p1' });
    const cheese = traceLot(LEDGER, '20260701', { productId: 'p2' });
    expect(milk.events).toHaveLength(4);
    expect(cheese.events).toHaveLength(1);
    expect(cheese.productName).toBe('チーズ');
    expect(cheese.balance).toBe(7);
  });

  it('商品を指定しないと同じロットNoの記録をすべて追う', () => {
    const trace = traceLot(LEDGER, '20260701');
    expect(trace.events).toHaveLength(5);
    expect(trace.inbound).toBe(27);
  });

  it('経由した倉庫を初めて現れた順に返す', () => {
    expect(traceLot(LEDGER, '20260701', { productId: 'p1' }).warehouseIds).toEqual(['wh-sales', 'wh-hold']);
  });

  it('最初と最後に動いた日時を返す', () => {
    const trace = traceLot(LEDGER, '20260701', { productId: 'p1' });
    expect(trace.firstDate).toBe(at('2026-06-20T10:00:00'));
    expect(trace.lastDate).toBe(at('2026-06-24T09:00:00'));
  });

  it('商品名は最後に記録された時点のものを使う (記録後の改名を追わない)', () => {
    const renamed: StockTransaction[] = [
      txn({ id: 'r2', date: at('2026-06-23T10:00:00'), type: '売上出庫', quantity: 3, productName: '牛乳（低脂肪）', fromWarehouseId: 'wh-sales' }),
      txn({ id: 'r1', date: at('2026-06-20T10:00:00'), type: '入荷', quantity: 10, productName: '牛乳', toWarehouseId: 'wh-sales' }),
    ];
    expect(traceLot(renamed, '20260701', { productId: 'p1' }).productName).toBe('牛乳（低脂肪）');
  });

  it('記録が1件もなければ空の追跡結果を返す', () => {
    const trace = traceLot(LEDGER, '99999999', { productId: 'p1' });
    expect(trace.events).toEqual([]);
    expect(trace.inbound).toBe(0);
    expect(trace.outbound).toBe(0);
    expect(trace.balance).toBe(0);
    expect(trace.firstDate).toBe('');
    expect(trace.productId).toBe('p1');
    expect(trace.lotNo).toBe('99999999');
  });
});

describe('lotStockRows / lotStockQuantity', () => {
  it('同じロットNoが複数倉庫に分かれていても在庫数の多い順にすべて返す', () => {
    const rows = lotStockRows(PRODUCTS, KEY);
    expect(rows.map(r => [r.warehouseId, r.quantity])).toEqual([['wh-sales', 9], ['wh-hold', 3]]);
    expect(lotStockQuantity(PRODUCTS, KEY)).toBe(12);
  });

  it('別のロットNo・別の商品の在庫は含めない', () => {
    expect(lotStockQuantity(PRODUCTS, { productId: 'p1', lotNo: '20260710' })).toBe(6);
    expect(lotStockQuantity(PRODUCTS, { productId: 'p2', lotNo: '20260701' })).toBe(7);
  });

  it('削除された商品・在庫のないロットは空を返す', () => {
    expect(lotStockRows(PRODUCTS, { productId: 'gone', lotNo: '20260701' })).toEqual([]);
    expect(lotStockQuantity(PRODUCTS, { productId: 'p1', lotNo: '20260901' })).toBe(0);
  });

  it('出しきって空になったロットは「残っている在庫」に含めない', () => {
    const emptied: Product[] = [{
      ...PRODUCTS[0],
      lots: [
        { id: 'l1', lotNo: '20260701', quantity: 0, warehouseId: 'wh-sales' },
        { id: 'l2', lotNo: '20260701', quantity: 3, warehouseId: 'wh-hold' },
      ],
    }];
    expect(lotStockRows(emptied, KEY).map(r => r.warehouseId)).toEqual(['wh-hold']);
    expect(lotStockQuantity(emptied, KEY)).toBe(3);
  });
});

describe('lotTraceCandidates', () => {
  it('在庫のあるロットと帳票にしか残っていないロットの両方を候補にする', () => {
    const gone: StockTransaction[] = [
      txn({ id: 'g1', date: at('2026-06-19T10:00:00'), type: '廃棄', lotNo: '20260610', quantity: 4, fromWarehouseId: 'wh-sales' }),
    ];
    const rows = lotTraceCandidates(PRODUCTS, [...LEDGER, ...gone]);
    const disposed = rows.find(r => r.lotNo === '20260610');
    expect(disposed).toMatchObject({ productId: 'p1', stockQuantity: 0, eventCount: 1 });
    expect(rows.map(r => r.lotNo)).toContain('20260710');
  });

  it('同じロットNoが複数倉庫に分かれていても1行にまとめ、在庫数を合計する', () => {
    const rows = lotTraceCandidates(PRODUCTS, LEDGER);
    const milk = rows.filter(r => r.productId === 'p1' && r.lotNo === '20260701');
    expect(milk).toHaveLength(1);
    expect(milk[0]).toMatchObject({ stockQuantity: 12, eventCount: 4, expiryDate: '2026-07-01' });
  });

  it('同じロットNoでも商品が違えば別の候補になる', () => {
    const rows = lotTraceCandidates(PRODUCTS, LEDGER).filter(r => r.lotNo === '20260701');
    expect(rows.map(r => r.productId).sort()).toEqual(['p1', 'p2']);
  });

  it('キーワードで商品名・SKU・ロットNoを部分一致で絞る', () => {
    expect(lotTraceCandidates(PRODUCTS, LEDGER, 'チーズ').map(r => r.productId)).toEqual(['p2']);
    expect(lotTraceCandidates(PRODUCTS, LEDGER, 'ml-001').every(r => r.productId === 'p1')).toBe(true);
    expect(lotTraceCandidates(PRODUCTS, LEDGER, '20260710').map(r => r.lotNo)).toEqual(['20260710']);
    expect(lotTraceCandidates(PRODUCTS, LEDGER, '  20260710  ').map(r => r.lotNo)).toEqual(['20260710']);
  });

  it('最後に動いた日時の新しい順に並ぶ (記録のないロットは最後)', () => {
    const rows = lotTraceCandidates(PRODUCTS, LEDGER);
    expect(rows.map(r => `${r.productId}:${r.lotNo}`)).toEqual(['p1:20260701', 'p2:20260701', 'p1:20260710']);
  });

  it('商品マスタから消えた商品は帳票に残った名前で追跡できる', () => {
    const rows = lotTraceCandidates([], LEDGER);
    expect(rows.find(r => r.productId === 'p1')).toMatchObject({ productName: '牛乳', productSku: 'ML-001', stockQuantity: 0 });
  });
});

describe('lotTraceCsv', () => {
  it('ヘッダーと履歴を古い順に出力し、倉庫は名前に解決する', () => {
    const csv = lotTraceCsv(traceLot(LEDGER, '20260701', { productId: 'p1' }), WAREHOUSES);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('日時,区分,商品名,SKU,ロットNo,数量,移動元倉庫,移動先倉庫,残数,備考');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('入荷,牛乳,ML-001,20260701,20,,販売倉庫,20,ロット追加');
    expect(lines[3]).toContain('売上出庫,牛乳,ML-001,20260701,-8,販売倉庫,,12,FEFO出庫');
  });

  it('記録がなければヘッダーだけを返す', () => {
    expect(lotTraceCsv(traceLot([], '20260701'), WAREHOUSES).split('\n')).toHaveLength(1);
  });
});

describe('isSameLotTraceKey', () => {
  it('商品IDとロットNoの両方が一致するときだけ true', () => {
    expect(isSameLotTraceKey(KEY, { productId: 'p1', lotNo: '20260701' })).toBe(true);
    expect(isSameLotTraceKey(KEY, { productId: 'p2', lotNo: '20260701' })).toBe(false);
    expect(isSameLotTraceKey(KEY, { productId: 'p1', lotNo: '20260710' })).toBe(false);
    expect(isSameLotTraceKey(KEY, null)).toBe(false);
    expect(isSameLotTraceKey(null, null)).toBe(false);
  });
});
