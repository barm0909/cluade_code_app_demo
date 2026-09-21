import { describe, it, expect } from 'vitest';
import {
  analysisPeriodStart,
  filterStockAnalysis,
  isStagnant,
  minQuantitySuggestions,
  planMinQuantities,
  stagnantRows,
  stockAnalysisCsv,
  stockAnalysisRows,
  stockAnalysisTotals,
} from '../useInventory';
import type { Category, InboundPlan, Product, StockTransaction, Supplier } from '../useInventory';

// 集計の基準日を固定する (実時刻に依存させない)。
// ローカル正午で組み立てるので、どのタイムゾーンでも localDateKey の結果が同じ日付になる。
const TODAY = new Date(2026, 8, 20, 12, 0, 0); // 2026-09-20
const daysAgo = (n: number) => new Date(2026, 8, 20 - n, 12, 0, 0).toISOString();

const CATEGORIES: Category[] = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
  { id: 'cat-label', name: 'ラベル' },
];

// 牛乳: 在庫30 (原価100 → 3,000円) / 直近90日で150個出庫
// 食パン: 在庫10 (原価50 → 500円) / 直近90日で50個出庫 (うち廃棄10)
// チーズ: 在庫5 (原価200 → 1,000円) / 出庫は200日前が最後 = 滞留
// ラベル: 在庫100 (原価2 → 200円) / 出庫実績が一度もない = 滞留
const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 200, costPrice: 100,
    lots: [{ id: 'l1', lotNo: 'A1', quantity: 30, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 20, price: 150, costPrice: 50,
    lots: [{ id: 'l2', lotNo: 'B1', quantity: 10, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'p3', name: 'チーズ', sku: 'CS-001', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 200,
    lots: [{ id: 'l3', lotNo: 'C1', quantity: 5, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'p4', name: '値札ラベル', sku: 'LB-R01', categoryId: 'cat-label', minQuantity: 50, price: 5, costPrice: 2,
    lots: [{ id: 'l4', lotNo: 'D1', quantity: 100, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

const txn = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id' | 'date' | 'type' | 'productId' | 'quantity'>): StockTransaction => ({
  productName: '', productSku: '', lotNo: '', note: '', ...over,
});

const LEDGER: StockTransaction[] = [
  txn({ id: 't1', date: daysAgo(10), type: '売上出庫', productId: 'p1', quantity: 90 }),
  txn({ id: 't2', date: daysAgo(40), type: '売上出庫', productId: 'p1', quantity: 60 }),
  // 入庫・移動は「どれだけ出たか」ではないので集計に混ぜない
  txn({ id: 't3', date: daysAgo(20), type: '入荷', productId: 'p1', quantity: 500 }),
  txn({ id: 't4', date: daysAgo(15), type: '移動', productId: 'p1', quantity: 200 }),
  txn({ id: 't5', date: daysAgo(5), type: '売上出庫', productId: 'p2', quantity: 40 }),
  txn({ id: 't6', date: daysAgo(3), type: '廃棄', productId: 'p2', quantity: 10 }),
  // 期間 (直近90日) の外。出庫数には入らないが「最終出庫日」としては拾う
  txn({ id: 't7', date: daysAgo(200), type: '売上出庫', productId: 'p3', quantity: 5 }),
];

const rowsOf = (ledger = LEDGER, days = 90) =>
  stockAnalysisRows(PRODUCTS, ledger, { days, today: TODAY });

const rowFor = (id: string, ledger = LEDGER, days = 90) => {
  const row = rowsOf(ledger, days).find(r => r.productId === id);
  if (!row) throw new Error(`row not found: ${id}`);
  return row;
};

// ────────────────────────────────────────────────────────────
// analysisPeriodStart — 集計期間の開始日
// ────────────────────────────────────────────────────────────
describe('analysisPeriodStart', () => {
  it('今日を含む直近N日の開始日を返す', () => {
    expect(analysisPeriodStart(1, TODAY)).toBe('2026-09-20');
    expect(analysisPeriodStart(30, TODAY)).toBe('2026-08-22');
    expect(analysisPeriodStart(90, TODAY)).toBe('2026-06-23');
  });

  it('月・年をまたいでも正しく戻る', () => {
    expect(analysisPeriodStart(365, TODAY)).toBe('2025-09-21');
  });
});

// ────────────────────────────────────────────────────────────
// stockAnalysisRows — 商品別の出庫実績と在庫の集計
// ────────────────────────────────────────────────────────────
describe('stockAnalysisRows', () => {
  it('出庫だけを数え、入庫・移動は集計しない', () => {
    const milk = rowFor('p1');
    expect(milk.outboundQuantity).toBe(150);
    expect(milk.salesQuantity).toBe(150);
    expect(milk.disposalQuantity).toBe(0);
    expect(milk.outboundValue).toBe(150 * 100);
  });

  it('売上出庫・調整出庫・廃棄をまとめて出庫として数え、内訳も持つ', () => {
    const bread = rowFor('p2');
    expect(bread.outboundQuantity).toBe(50);
    expect(bread.salesQuantity).toBe(40);
    expect(bread.disposalQuantity).toBe(10);
  });

  it('期間の外の出庫は数量に入れないが、最終出庫日としては拾う', () => {
    const cheese = rowFor('p3');
    expect(cheese.outboundQuantity).toBe(0);
    expect(cheese.lastOutboundAt).toBe(daysAgo(200));
    expect(cheese.stagnantDays).toBe(200);
  });

  it('出庫実績が一度もない商品は滞留日数が null になる', () => {
    const label = rowFor('p4');
    expect(label.lastOutboundAt).toBe('');
    expect(label.stagnantDays).toBeNull();
  });

  it('在庫金額はロットの実原価を優先する', () => {
    const withLotCost = PRODUCTS.map(p =>
      p.id === 'p1' ? { ...p, lots: p.lots.map(l => ({ ...l, unitPrice: 120 })) } : p);
    const rows = stockAnalysisRows(withLotCost, LEDGER, { days: 90, today: TODAY });
    expect(rows.find(r => r.productId === 'p1')!.stockValue).toBe(30 * 120);
  });

  it('1日あたり出庫数・在庫回転率・在庫日数を計算する', () => {
    const milk = rowFor('p1');
    expect(milk.dailyOutbound).toBeCloseTo(150 / 90, 5);
    expect(milk.turnoverRate).toBeCloseTo(5, 5); // 150個出庫 ÷ 在庫30
    expect(milk.daysOfStock).toBeCloseTo(18, 5); // 在庫30 ÷ 1.667個/日
  });

  it('出庫のない商品は在庫日数が null (減らないので日数を出せない)', () => {
    expect(rowFor('p4').daysOfStock).toBeNull();
    expect(rowFor('p4').turnoverRate).toBe(0);
  });

  it('出庫金額の構成比でA/B/Cランクを振る', () => {
    const rows = rowsOf();
    // 出庫金額: 牛乳15,000 / 食パン2,500 → 合計17,500
    expect(rows.map(r => [r.productId, r.rank])).toEqual([
      ['p1', 'A'],
      ['p2', 'B'],
      ['p3', 'C'],
      ['p4', 'C'],
    ]);
    expect(rows[0].share).toBeCloseTo(15000 / 17500, 5);
    expect(rows[1].cumulativeShare).toBeCloseTo(1, 5);
  });

  it('出庫金額の大きい順に並ぶ', () => {
    expect(rowsOf().map(r => r.productId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('境目をまたぐ商品は上のランクに含める', () => {
    // 1商品で全体の95%を占めるケース: 累計70%を超えるが、その商品自身は A
    const ledger: StockTransaction[] = [
      txn({ id: 'x1', date: daysAgo(1), type: '売上出庫', productId: 'p1', quantity: 190 }), // 19,000円
      txn({ id: 'x2', date: daysAgo(1), type: '売上出庫', productId: 'p2', quantity: 20 }), // 1,000円
    ];
    const rows = stockAnalysisRows(PRODUCTS, ledger, { days: 90, today: TODAY });
    expect(rows.find(r => r.productId === 'p1')!.rank).toBe('A');
    expect(rows.find(r => r.productId === 'p2')!.rank).toBe('C'); // 累計95%を超えた後なので C
  });

  it('出庫が1件もなければ全商品が C ランクになる', () => {
    const rows = stockAnalysisRows(PRODUCTS, [], { days: 90, today: TODAY });
    expect(rows.every(r => r.rank === 'C')).toBe(true);
    expect(rows.every(r => r.share === 0)).toBe(true);
  });

  it('期間を変えると集計対象の出庫も変わる', () => {
    expect(rowFor('p1', LEDGER, 30).outboundQuantity).toBe(90); // 40日前の60個が外れる
    expect(rowFor('p3', LEDGER, 365).outboundQuantity).toBe(5); // 200日前の出庫が入る
  });
});

// ────────────────────────────────────────────────────────────
// 滞留在庫
// ────────────────────────────────────────────────────────────
describe('isStagnant / stagnantRows', () => {
  it('しきい値以上動いていない在庫と、出庫実績のない在庫を滞留とみなす', () => {
    const rows = rowsOf();
    expect(isStagnant(rows.find(r => r.productId === 'p1')!, 60)).toBe(false); // 10日前に出庫
    expect(isStagnant(rows.find(r => r.productId === 'p3')!, 60)).toBe(true); // 200日前が最後
    expect(isStagnant(rows.find(r => r.productId === 'p4')!, 60)).toBe(true); // 出庫実績なし
  });

  it('在庫が残っていない商品は滞留に数えない', () => {
    const noStock = PRODUCTS.map(p => p.id === 'p3' ? { ...p, lots: [] } : p);
    const rows = stockAnalysisRows(noStock, LEDGER, { days: 90, today: TODAY });
    expect(isStagnant(rows.find(r => r.productId === 'p3')!, 60)).toBe(false);
  });

  it('しきい値を下げるほど滞留と判定される商品が増える', () => {
    const rows = rowsOf();
    expect(stagnantRows(rows, 60).map(r => r.productId)).toEqual(['p3', 'p4']);
    // 30日: 直近の出庫がない p2 (3日前) / p1 (10日前) はまだ入らない
    expect(stagnantRows(rows, 5).map(r => r.productId)).toEqual(['p1', 'p3', 'p4']);
  });

  it('金額の大きい順に並ぶ', () => {
    expect(stagnantRows(rowsOf(), 60).map(r => r.stockValue)).toEqual([1000, 200]);
  });
});

// ────────────────────────────────────────────────────────────
// stockAnalysisTotals — サマリカードの集計
// ────────────────────────────────────────────────────────────
describe('stockAnalysisTotals', () => {
  it('在庫金額・出庫金額・ランク別件数・滞留をまとめる', () => {
    const totals = stockAnalysisTotals(rowsOf(), { days: 90, stagnantDays: 60 });
    expect(totals.productCount).toBe(4);
    expect(totals.stockValue).toBe(3000 + 500 + 1000 + 200);
    expect(totals.outboundQuantity).toBe(200);
    expect(totals.outboundValue).toBe(17500);
    expect(totals.rankCounts).toEqual({ A: 1, B: 1, C: 2 });
    expect(totals.stagnantCount).toBe(2);
    expect(totals.stagnantValue).toBe(1200);
  });

  it('全体の在庫日数は在庫金額 ÷ 1日あたり出庫金額', () => {
    const totals = stockAnalysisTotals(rowsOf(), { days: 90 });
    expect(totals.daysOfStock).toBeCloseTo(4700 / (17500 / 90), 5);
  });

  it('出庫が1件もなければ在庫日数は null', () => {
    const rows = stockAnalysisRows(PRODUCTS, [], { days: 90, today: TODAY });
    expect(stockAnalysisTotals(rows, { days: 90 }).daysOfStock).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// filterStockAnalysis — 画面の絞り込み
// ────────────────────────────────────────────────────────────
describe('filterStockAnalysis', () => {
  const rows = rowsOf();

  it('キーワードは商品名・SKU の部分一致', () => {
    expect(filterStockAnalysis(rows, { keyword: '牛乳', categoryId: '', rank: '' }).map(r => r.productId)).toEqual(['p1']);
    expect(filterStockAnalysis(rows, { keyword: 'br-', categoryId: '', rank: '' }).map(r => r.productId)).toEqual(['p2']);
  });

  it('カテゴリとランクで絞り込める', () => {
    expect(filterStockAnalysis(rows, { keyword: '', categoryId: 'cat-dairy', rank: '' }).map(r => r.productId))
      .toEqual(['p1', 'p3']);
    expect(filterStockAnalysis(rows, { keyword: '', categoryId: '', rank: 'C' }).map(r => r.productId))
      .toEqual(['p3', 'p4']);
  });

  it('空の条件は絞り込まない', () => {
    expect(filterStockAnalysis(rows, { keyword: '', categoryId: '', rank: '' })).toHaveLength(4);
  });
});

// ────────────────────────────────────────────────────────────
// 発注点の見直し提案
// ────────────────────────────────────────────────────────────
const SUPPLIERS: Supplier[] = [
  { id: 's1', name: '山田乳業', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 3, note: '', active: true },
  { id: 's2', name: '旧パン屋', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 10, note: '', active: false },
];

const plan = (over: Partial<InboundPlan> & Pick<InboundPlan, 'id' | 'productId' | 'supplierId' | 'createdAt'>): InboundPlan => ({
  expectedDate: '2026-09-25', quantity: 10, receivedQuantity: 0, warehouseId: 'wh-sales',
  lotNo: '', unitPrice: 0, note: '', updatedAt: over.createdAt, ...over,
});

const PLANS: InboundPlan[] = [
  plan({ id: 'ip1', productId: 'p1', supplierId: 's1', createdAt: '2026-09-01T00:00:00.000Z' }),
  // 取引停止の仕入先。リードタイムは引き継がない
  plan({ id: 'ip2', productId: 'p2', supplierId: 's2', createdAt: '2026-09-02T00:00:00.000Z' }),
];

describe('minQuantitySuggestions', () => {
  const suggest = (safetyDays = 7) =>
    minQuantitySuggestions(rowsOf(), PRODUCTS, PLANS, SUPPLIERS, { safetyDays });

  it('1日あたり出庫数 ×（リードタイム + 安全在庫日数）を提案する', () => {
    const milk = suggest().find(s => s.productId === 'p1')!;
    expect(milk.leadTimeDays).toBe(3);
    expect(milk.supplierName).toBe('山田乳業');
    expect(milk.suggestedMinQuantity).toBe(17); // ceil(1.667 × (3 + 7))
    expect(milk.currentMinQuantity).toBe(5);
    expect(milk.diff).toBe(12);
  });

  it('取引停止の仕入先のリードタイムは引き継がない', () => {
    const bread = suggest().find(s => s.productId === 'p2')!;
    expect(bread.leadTimeDays).toBe(0);
    expect(bread.supplierName).toBe('');
    expect(bread.suggestedMinQuantity).toBe(4); // ceil(0.556 × 7)
    expect(bread.diff).toBe(-16);
  });

  it('安全在庫日数を増やすと提案値も増える', () => {
    expect(suggest(14).find(s => s.productId === 'p1')!.suggestedMinQuantity).toBe(29); // ceil(1.667 × 17)
  });

  it('期間内に出庫のなかった商品は提案しない（欠品を招くため）', () => {
    expect(suggest().map(s => s.productId)).not.toContain('p3');
    expect(suggest().map(s => s.productId)).not.toContain('p4');
  });

  it('現在の発注点と同じになる商品は提案に出さない', () => {
    const alreadyRight = PRODUCTS.map(p => p.id === 'p1' ? { ...p, minQuantity: 17 } : p);
    const rows = stockAnalysisRows(alreadyRight, LEDGER, { days: 90, today: TODAY });
    const suggestions = minQuantitySuggestions(rows, alreadyRight, PLANS, SUPPLIERS, { safetyDays: 7 });
    expect(suggestions.map(s => s.productId)).toEqual(['p2']);
  });

  it('ずれの大きい順に並ぶ', () => {
    expect(suggest().map(s => s.productId)).toEqual(['p2', 'p1']); // -16 → +12
  });
});

describe('planMinQuantities', () => {
  const suggestions = minQuantitySuggestions(rowsOf(), PRODUCTS, PLANS, SUPPLIERS, { safetyDays: 7 });

  it('選択された商品だけを更新対象にする', () => {
    const result = planMinQuantities(suggestions, ['p1']);
    expect(result.targets.map(t => t.productId)).toEqual(['p1']);
    expect(result.updates).toEqual([{ productId: 'p1', minQuantity: 17 }]);
    expect(result.raised).toBe(1);
    expect(result.lowered).toBe(0);
  });

  it('引き上げ・引き下げの件数を数える', () => {
    const result = planMinQuantities(suggestions, ['p1', 'p2']);
    expect(result.raised).toBe(1);
    expect(result.lowered).toBe(1);
  });

  it('何も選択されていなければ空になる', () => {
    expect(planMinQuantities(suggestions, []).updates).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// CSV
// ────────────────────────────────────────────────────────────
describe('stockAnalysisCsv', () => {
  it('ヘッダーと商品ごとの行を出す', () => {
    const lines = stockAnalysisCsv(rowsOf(), CATEGORIES).split('\n');
    expect(lines[0]).toBe(
      'ABCランク,商品名,SKU,カテゴリ,在庫数,在庫金額（原価）,期間出庫数,売上出庫数,廃棄数,'
      + '出庫金額（原価）,構成比,累計構成比,1日あたり出庫数,在庫回転率,在庫日数,最終出庫日,滞留日数',
    );
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('A,牛乳,ML-001,乳製品,30,3000,150,150,0,15000');
  });

  it('出庫実績のない商品は最終出庫日・滞留日数を空欄にする', () => {
    const line = stockAnalysisCsv(rowsOf(), CATEGORIES).split('\n')[4];
    expect(line.startsWith('C,値札ラベル,LB-R01,ラベル,100,200,0,0,0,0,')).toBe(true);
    expect(line.endsWith(',,')).toBe(true);
  });
});
