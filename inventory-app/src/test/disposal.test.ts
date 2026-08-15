import { describe, it, expect } from 'vitest';
import {
  disposalCsv,
  disposalPeriodStart,
  disposalRows,
  disposalTotals,
  disposalTransactions,
  planDisposal,
} from '../useInventory';
import type { Product, StockTransaction } from '../useInventory';

// 期限は「今日から何日後か」で組み立てる (isExpired が実時刻を見るため)
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

// 牛乳: 期限切れ(4個)・3日後(10個)・在庫0の期限切れ
// 食パン: 10日後(3個)
// ラベル: 期限なし(500個)
const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 200, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: 'A1', expiryDate: d(-2), quantity: 4, warehouseId: 'wh-hold' },
      { id: 'l2', lotNo: 'A2', expiryDate: d(3), quantity: 10, warehouseId: 'wh-sales' },
      { id: 'l3', lotNo: 'A3', expiryDate: d(-5), quantity: 0, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l4', lotNo: 'B1', expiryDate: d(10), quantity: 3, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p3', name: '値札ラベル', sku: 'LB-R01', categoryId: 'cat-label', minQuantity: 100, price: 5, costPrice: 2,
    lots: [
      { id: 'l5', lotNo: 'C1', quantity: 500, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const txn = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id' | 'date' | 'type'>): StockTransaction => ({
  productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'A1', quantity: 1, note: '', ...over,
});

// ────────────────────────────────────────────────────────────
// planDisposal — 廃棄プレビュー
// ────────────────────────────────────────────────────────────

describe('planDisposal', () => {
  it('選んだロットを全量廃棄する計画を作る', () => {
    const plan = planDisposal(PRODUCTS, ['l1']);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      productId: 'p1', productName: '牛乳', lotId: 'l1', lotNo: 'A1',
      warehouseId: 'wh-hold', quantity: 4, costPrice: 130, costValue: 520, expired: true,
    });
    expect(plan.quantity).toBe(4);
    expect(plan.costValue).toBe(520);
    expect(plan.expiredCount).toBe(1);
    expect(plan.notExpiredCount).toBe(0);
  });

  it('複数ロットの数量と金額を合計する', () => {
    const plan = planDisposal(PRODUCTS, ['l1', 'l4']);
    expect(plan.quantity).toBe(7); // 4 + 3
    expect(plan.costValue).toBe(4 * 130 + 3 * 90);
  });

  it('期限内・期限なしのロットは notExpired として数える', () => {
    const plan = planDisposal(PRODUCTS, ['l1', 'l2', 'l5']);
    expect(plan.expiredCount).toBe(1); // l1 のみ
    expect(plan.notExpiredCount).toBe(2); // l2 (3日後) と l5 (期限なし)
  });

  it('在庫0のロットと存在しないIDは黙って除外する', () => {
    const plan = planDisposal(PRODUCTS, ['l3', 'unknown']);
    expect(plan.targets).toEqual([]);
    expect(plan.quantity).toBe(0);
    expect(plan.costValue).toBe(0);
  });

  it('期限の早い順に並べ、期限なしを最後に回す', () => {
    const plan = planDisposal(PRODUCTS, ['l5', 'l4', 'l2', 'l1']);
    expect(plan.targets.map(t => t.lotNo)).toEqual(['A1', 'A2', 'B1', 'C1']);
  });

  it('何も選ばなければ空の計画を返す', () => {
    const plan = planDisposal(PRODUCTS, []);
    expect(plan).toEqual({ targets: [], quantity: 0, costValue: 0, expiredCount: 0, notExpiredCount: 0 });
  });
});

// ────────────────────────────────────────────────────────────
// disposalPeriodStart — 集計期間
// ────────────────────────────────────────────────────────────

describe('disposalPeriodStart', () => {
  const day = new Date(2026, 7, 15); // 2026-08-15 (ローカル)

  it('今月はその月の1日を返す', () => {
    expect(disposalPeriodStart('今月', day)).toBe('2026-08-01');
  });

  it('今年はその年の1月1日を返す', () => {
    expect(disposalPeriodStart('今年', day)).toBe('2026-01-01');
  });

  it('全期間は空文字 (絞らない) を返す', () => {
    expect(disposalPeriodStart('全期間', day)).toBe('');
  });
});

// ────────────────────────────────────────────────────────────
// disposalTransactions — 帳票から廃棄だけを取り出す
// ────────────────────────────────────────────────────────────

describe('disposalTransactions', () => {
  const ledger: StockTransaction[] = [
    txn({ id: 't1', date: '2026-08-10T01:00:00.000Z', type: '廃棄', quantity: 4 }),
    txn({ id: 't2', date: '2026-07-31T01:00:00.000Z', type: '廃棄', quantity: 2 }),
    txn({ id: 't3', date: '2026-08-11T01:00:00.000Z', type: '売上出庫', quantity: 5 }),
    txn({ id: 't4', date: '2026-08-12T01:00:00.000Z', type: '調整出庫', quantity: 1 }),
  ];

  it('廃棄以外の区分を除外する', () => {
    expect(disposalTransactions(ledger).map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('開始日を指定するとその日以降だけを返す', () => {
    expect(disposalTransactions(ledger, '2026-08-01').map(t => t.id)).toEqual(['t1']);
  });

  it('開始日が空なら全期間を返す', () => {
    expect(disposalTransactions(ledger, '')).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
// disposalRows / disposalTotals / disposalCsv — 商品別の廃棄ロス
// ────────────────────────────────────────────────────────────

describe('disposalRows', () => {
  const txns: StockTransaction[] = [
    txn({ id: 't1', date: '2026-08-10T01:00:00.000Z', type: '廃棄', quantity: 4 }),
    txn({ id: 't2', date: '2026-08-11T01:00:00.000Z', type: '廃棄', quantity: 1, lotNo: 'A2' }),
    txn({ id: 't3', date: '2026-08-12T01:00:00.000Z', type: '廃棄', quantity: 3, productId: 'p2', productName: '食パン', productSku: 'BR-001', lotNo: 'B1' }),
  ];

  it('商品ごとにまとめ、原価を掛けたロス金額を出す', () => {
    const rows = disposalRows(txns, PRODUCTS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      productId: 'p1', productName: '牛乳', productSku: 'ML-001', count: 2, quantity: 5, costValue: 5 * 130,
    });
    expect(rows[1]).toMatchObject({ productId: 'p2', count: 1, quantity: 3, costValue: 3 * 90 });
  });

  it('ロス金額の大きい順に並べる', () => {
    const rows = disposalRows(txns, PRODUCTS);
    expect(rows.map(r => r.productName)).toEqual(['牛乳', '食パン']);
  });

  it('マスタから消えた商品は原価0として数量だけ数える', () => {
    const rows = disposalRows([txn({ id: 't9', date: '2026-08-10T01:00:00.000Z', type: '廃棄', quantity: 7, productId: 'gone', productName: '廃番品', productSku: 'X-001' })], PRODUCTS);
    expect(rows[0]).toMatchObject({ productName: '廃番品', quantity: 7, costValue: 0 });
  });

  it('廃棄がなければ空配列を返す', () => {
    expect(disposalRows([], PRODUCTS)).toEqual([]);
  });

  it('disposalTotals が件数・数量・金額を合計する', () => {
    expect(disposalTotals(disposalRows(txns, PRODUCTS))).toEqual({ count: 3, quantity: 8, costValue: 5 * 130 + 3 * 90 });
  });

  it('disposalTotals は空でも0を返す', () => {
    expect(disposalTotals([])).toEqual({ count: 0, quantity: 0, costValue: 0 });
  });

  it('disposalCsv が見出しと行を出力する', () => {
    const lines = disposalCsv(disposalRows(txns, PRODUCTS)).split('\n');
    expect(lines[0]).toBe('商品名,SKU,廃棄件数,廃棄数量,廃棄金額（原価）');
    expect(lines[1]).toBe('牛乳,ML-001,2,5,650');
    expect(lines[2]).toBe('食パン,BR-001,1,3,270');
  });
});
