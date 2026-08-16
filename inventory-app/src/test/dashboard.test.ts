import { describe, it, expect } from 'vitest';
import {
  categorySummaries,
  dashboardTotals,
  expiringLotRows,
  lowStockCsv,
  lowStockRows,
  warehouseSummaries,
} from '../useInventory';
import type { Category, Product, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
  { id: 'wh-defect', name: '不良倉庫', color: '#f44336' },
];

const CATEGORIES: Category[] = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
  { id: 'cat-label', name: 'ラベル' },
];

// 期限は「今日から何日後か」で組み立てる (daysUntilExpiry が実時刻を見るため)
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

// 牛乳: 在庫14 (発注点5) / 期限切れ1・3日後1
// 食パン: 在庫3 (発注点5 → 不足2) / 10日後
// ラベル: 在庫0 (発注点100 → 欠品・不足100) / 期限なし
const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 200, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: 'A1', expiryDate: d(-2), quantity: 4, warehouseId: 'wh-hold' },
      { id: 'l2', lotNo: 'A2', expiryDate: d(3), quantity: 10, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l3', lotNo: 'B1', expiryDate: d(10), quantity: 3, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p3', name: '値札ラベル', sku: 'LB-R01', categoryId: 'cat-label', minQuantity: 100, price: 5, costPrice: 2,
    lots: [
      { id: 'l4', lotNo: 'C1', quantity: 0, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

// l2 (牛乳, 数量10, wh-sales) にだけ実原価を持たせた変種。商品の costPrice (130) と異なる値にして
// 集計がロット単位で切り替わっていることを確認するために使う
const withL2UnitPrice = (unitPrice: number): Product[] => PRODUCTS.map(p =>
  p.id === 'p1' ? { ...p, lots: p.lots.map(l => l.id === 'l2' ? { ...l, unitPrice } : l) } : p);

// ────────────────────────────────────────────────────────────
// dashboardTotals — サマリカードの集計
// ────────────────────────────────────────────────────────────
describe('dashboardTotals', () => {
  it('在庫数・在庫金額を原価と売価の両方で集計する', () => {
    const t = dashboardTotals(PRODUCTS);
    expect(t.productCount).toBe(3);
    expect(t.lotCount).toBe(4);
    expect(t.quantity).toBe(17); // 14 + 3 + 0
    expect(t.costValue).toBe(14 * 130 + 3 * 90);
    expect(t.retailValue).toBe(14 * 200 + 3 * 150);
  });

  it('発注点以下を要発注、在庫0を欠品として数える (欠品は要発注の内数)', () => {
    const t = dashboardTotals(PRODUCTS);
    expect(t.lowStock).toBe(2); // 食パン (3 <= 5) と ラベル (0 <= 100)
    expect(t.outOfStock).toBe(1); // ラベル
  });

  it('既定では7日以内を期限間近として数える', () => {
    const t = dashboardTotals(PRODUCTS);
    expect(t.expiredLots).toBe(1); // 牛乳 A1
    expect(t.expiringLots).toBe(1); // 牛乳 A2 (3日後)
  });

  it('しきい値を広げると期限間近の対象が増える', () => {
    expect(dashboardTotals(PRODUCTS, 14).expiringLots).toBe(2); // A2 と 食パン B1 (10日後)
  });

  it('在庫0のロットは期限アラートの対象にしない', () => {
    const emptyExpired: Product[] = [{
      ...PRODUCTS[0],
      lots: [{ id: 'x1', lotNo: 'X1', expiryDate: d(-5), quantity: 0, warehouseId: 'wh-sales' }],
    }];
    expect(dashboardTotals(emptyExpired).expiredLots).toBe(0);
  });

  it('商品が0件でもゼロ埋めの集計を返す', () => {
    expect(dashboardTotals([])).toEqual({
      productCount: 0, lotCount: 0, quantity: 0, costValue: 0, retailValue: 0,
      expiredLots: 0, expiringLots: 0, lowStock: 0, outOfStock: 0,
    });
  });

  it('ロットが実原価を持っていれば、商品の原価ではなくそちらを使う', () => {
    const t = dashboardTotals(withL2UnitPrice(150));
    expect(t.costValue).toBe(4 * 130 + 10 * 150 + 3 * 90); // l1はフォールバック、l2だけ150円
  });
});

// ────────────────────────────────────────────────────────────
// lowStockRows — 要発注リスト
// ────────────────────────────────────────────────────────────
describe('lowStockRows', () => {
  it('在庫数が発注点以下の商品だけを不足数の大きい順に返す', () => {
    const rows = lowStockRows(PRODUCTS);
    expect(rows.map(r => r.productId)).toEqual(['p3', 'p2']);
    expect(rows[0]).toMatchObject({
      productName: '値札ラベル', quantity: 0, minQuantity: 100, shortage: 100, restockCost: 200,
    });
    expect(rows[1]).toMatchObject({ productName: '食パン', quantity: 3, shortage: 2, restockCost: 180 });
  });

  it('発注点ちょうどの商品も不足数0で含める', () => {
    const rows = lowStockRows([{ ...PRODUCTS[1], lots: [{ id: 'l3', lotNo: 'B1', quantity: 5, warehouseId: 'wh-sales' }] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shortage: 0, restockCost: 0 });
  });

  it('不足数が同じときは商品名順に並ぶ', () => {
    const same: Product[] = [
      { ...PRODUCTS[1], id: 'z', name: 'ヨーグルト', sku: 'YG-001' },
      { ...PRODUCTS[1], id: 'a', name: 'あんぱん', sku: 'AN-001' },
    ];
    expect(lowStockRows(same).map(r => r.productName)).toEqual(['あんぱん', 'ヨーグルト']);
  });
});

// ────────────────────────────────────────────────────────────
// expiringLotRows — 期限アラート
// ────────────────────────────────────────────────────────────
describe('expiringLotRows', () => {
  it('期限切れとしきい値以内のロットを期限の早い順に返す', () => {
    const rows = expiringLotRows(PRODUCTS);
    expect(rows.map(r => r.lotId)).toEqual(['l1', 'l2']);
    expect(rows[0]).toMatchObject({
      productName: '牛乳', lotNo: 'A1', quantity: 4, warehouseId: 'wh-hold', costValue: 520,
    });
    expect(rows[0].days).toBeLessThan(0);
    expect(rows[1].days).toBe(3);
  });

  it('しきい値を広げると対象が増える', () => {
    expect(expiringLotRows(PRODUCTS, 14).map(r => r.lotId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('期限のないロット・在庫0のロットは対象外', () => {
    const rows = expiringLotRows(PRODUCTS, 3650);
    expect(rows.map(r => r.lotId)).not.toContain('l4'); // 期限なし・在庫0
  });

  it('ロットの実原価があればそれを使って在庫金額を計算する', () => {
    const rows = expiringLotRows(withL2UnitPrice(150));
    expect(rows.find(r => r.lotId === 'l2')).toMatchObject({ costValue: 10 * 150 });
  });
});

// ────────────────────────────────────────────────────────────
// warehouseSummaries / categorySummaries — 倉庫別・カテゴリ別サマリ
// ────────────────────────────────────────────────────────────
describe('warehouseSummaries', () => {
  it('倉庫ごとに商品数・ロット数・在庫金額を集計する', () => {
    const rows = warehouseSummaries(PRODUCTS, WAREHOUSES);
    expect(rows.map(r => r.id)).toEqual(['wh-sales', 'wh-hold', 'wh-defect']);
    expect(rows[0]).toMatchObject({
      name: '販売倉庫', productCount: 3, lotCount: 3, quantity: 13, costValue: 10 * 130 + 3 * 90,
    });
    expect(rows[1]).toMatchObject({ name: '保留倉庫', productCount: 1, lotCount: 1, quantity: 4, costValue: 520 });
  });

  it('ロットのない倉庫は0件の行として残る', () => {
    const defect = warehouseSummaries(PRODUCTS, WAREHOUSES)[2];
    expect(defect).toMatchObject({ name: '不良倉庫', productCount: 0, quantity: 0, costValue: 0, share: 0 });
  });

  it('構成比は原価金額の割合で、合計が1になる', () => {
    const rows = warehouseSummaries(PRODUCTS, WAREHOUSES);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
    expect(rows[1].share).toBeCloseTo(520 / (520 + 1300 + 270));
  });

  it('在庫金額が0なら構成比はすべて0', () => {
    const rows = warehouseSummaries([PRODUCTS[2]], WAREHOUSES);
    expect(rows.every(r => r.share === 0)).toBe(true);
  });

  it('同じ商品でもロットごとに実原価が違えば倉庫の在庫金額に反映される', () => {
    const rows = warehouseSummaries(withL2UnitPrice(150), WAREHOUSES);
    const sales = rows.find(r => r.id === 'wh-sales')!;
    expect(sales.costValue).toBe(10 * 150 + 3 * 90); // l2(150) + l3(フォールバック90)
  });
});

describe('categorySummaries', () => {
  it('カテゴリごとに集計する', () => {
    const rows = categorySummaries(PRODUCTS, CATEGORIES);
    expect(rows.map(r => r.name)).toEqual(['乳製品', 'パン', 'ラベル']);
    expect(rows[0]).toMatchObject({ productCount: 1, lotCount: 2, quantity: 14, costValue: 1820, retailValue: 2800 });
    expect(rows[2]).toMatchObject({ productCount: 1, quantity: 0, costValue: 0 });
  });

  it('ロットの実原価があればそれを使って集計する', () => {
    const rows = categorySummaries(withL2UnitPrice(150), CATEGORIES);
    expect(rows.find(r => r.name === '乳製品')).toMatchObject({ costValue: 4 * 130 + 10 * 150 });
  });
});

// ────────────────────────────────────────────────────────────
// lowStockCsv — 要発注リストの CSV
// ────────────────────────────────────────────────────────────
describe('lowStockCsv', () => {
  it('ヘッダーと各行を出力し、カテゴリ名を解決する', () => {
    const csv = lowStockCsv(lowStockRows(PRODUCTS), CATEGORIES);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('商品名,SKU,カテゴリ,在庫数,発注点,不足数,発注見込金額');
    expect(lines[1]).toBe('値札ラベル,LB-R01,ラベル,0,100,100,200');
    expect(lines[2]).toBe('食パン,BR-001,パン,3,5,2,180');
  });

  it('カンマを含む商品名は引用符で囲む', () => {
    const rows = lowStockRows([{ ...PRODUCTS[1], name: '食パン,6枚切' }]);
    expect(lowStockCsv(rows, CATEGORIES).split('\n')[1]).toContain('"食パン,6枚切"');
  });

  it('該当商品がなければヘッダーだけを返す', () => {
    expect(lowStockCsv([], CATEGORIES).split('\n')).toHaveLength(1);
  });
});
