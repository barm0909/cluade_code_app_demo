import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  inboundPlanStatus,
  remainingInbound,
  isOverdueInboundPlan,
  inboundPlanRows,
  inboundPlanTotals,
  inboundPlanCsv,
  planReceipt,
  totalQuantity,
  EMPTY_INBOUND_PLAN_FILTER,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { InboundPlan, InboundPlanInput, Lot, Product, Supplier, Warehouse } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

// テスト用の日付 (今日からのオフセット)
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const plan = (over: Partial<InboundPlan> & { id: string }): InboundPlan => ({
  productId: 'p1',
  expectedDate: d(1),
  quantity: 10,
  receivedQuantity: 0,
  warehouseId: DEFAULT_WAREHOUSE_ID,
  lotNo: '20260101',
  supplierId: 'sup-yamada',
  unitPrice: 0,
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const product = (lots: Lot[] = [], over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'テスト商品', sku: 'T-001', categoryId: 'cat-dairy',
  lots, minQuantity: 0, price: 100, costPrice: 60, updatedAt: new Date().toISOString(),
  ...over,
});

const WAREHOUSES: Warehouse[] = [
  { id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const supplier = (id: string, name: string): Supplier => ({
  id, name, code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true,
});

const SUPPLIERS: Supplier[] = [supplier('sup-yamada', '山田商店'), supplier('sup-asahi', '朝日ベーカリー')];

// ────────────────────────────────────────────────────────────
// 状態の導出 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('inboundPlanStatus / remainingInbound', () => {
  it('入荷実績0は未入荷', () => {
    const p = plan({ id: '1' });
    expect(inboundPlanStatus(p)).toBe('未入荷');
    expect(remainingInbound(p)).toBe(10);
  });

  it('予定数量に満たない入荷は一部入荷', () => {
    const p = plan({ id: '1', receivedQuantity: 4 });
    expect(inboundPlanStatus(p)).toBe('一部入荷');
    expect(remainingInbound(p)).toBe(6);
  });

  it('予定数量に達したら入荷済', () => {
    const p = plan({ id: '1', receivedQuantity: 10 });
    expect(inboundPlanStatus(p)).toBe('入荷済');
    expect(remainingInbound(p)).toBe(0);
  });

  it('キャンセル済みは入荷実績にかかわらずキャンセル・残0', () => {
    const p = plan({ id: '1', receivedQuantity: 4, canceledAt: '2026-01-02T00:00:00.000Z' });
    expect(inboundPlanStatus(p)).toBe('キャンセル');
    expect(remainingInbound(p)).toBe(0);
  });
});

describe('isOverdueInboundPlan', () => {
  it('予定日を過ぎて残数があれば遅延', () => {
    expect(isOverdueInboundPlan(plan({ id: '1', expectedDate: d(-1) }))).toBe(true);
  });

  it('予定日が今日なら遅延ではない', () => {
    expect(isOverdueInboundPlan(plan({ id: '1', expectedDate: d(0) }))).toBe(false);
  });

  it('残数がなければ予定日を過ぎていても遅延ではない', () => {
    expect(isOverdueInboundPlan(plan({ id: '1', expectedDate: d(-5), receivedQuantity: 10 }))).toBe(false);
    expect(isOverdueInboundPlan(plan({ id: '1', expectedDate: d(-5), canceledAt: 'x' }))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 一覧の絞り込み・集計・CSV
// ────────────────────────────────────────────────────────────
describe('inboundPlanRows', () => {
  const products = [product([], { id: 'p1', name: '牛乳', sku: 'ML-001' }), product([], { id: 'p2', name: '食パン', sku: 'BR-001' })];

  it('入荷予定日の早い順に並び、商品名・状態・残数が付く', () => {
    const rows = inboundPlanRows([
      plan({ id: 'b', expectedDate: d(5) }),
      plan({ id: 'a', expectedDate: d(1), receivedQuantity: 3 }),
    ], products);

    expect(rows.map(r => r.plan.id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ productName: '牛乳', productSku: 'ML-001', status: '一部入荷', remaining: 7 });
  });

  it('商品マスタにない商品の予定は表示しない', () => {
    const rows = inboundPlanRows([plan({ id: '1', productId: 'missing' })], products);
    expect(rows).toEqual([]);
  });

  it('キーワードは商品名・SKU・ロットNo・仕入先名に効く', () => {
    const plans = [
      plan({ id: '1', productId: 'p1', supplierId: 'sup-yamada' }),
      plan({ id: '2', productId: 'p2', supplierId: 'sup-asahi', lotNo: '20991231' }),
    ];
    const ids = (keyword: string) =>
      inboundPlanRows(plans, products, { ...EMPTY_INBOUND_PLAN_FILTER, keyword }, SUPPLIERS).map(r => r.plan.id);

    expect(ids('食パン')).toEqual(['2']);
    expect(ids('ML-001')).toEqual(['1']);
    expect(ids('20991231')).toEqual(['2']);
    expect(ids('朝日')).toEqual(['2']);
  });

  it('仕入先名はマスタから解決され、マスタにない仕入先は空欄になる', () => {
    const rows = inboundPlanRows([
      plan({ id: '1', supplierId: 'sup-yamada' }),
      plan({ id: '2', supplierId: '' }),
      plan({ id: '3', supplierId: 'sup-deleted' }),
    ], products, EMPTY_INBOUND_PLAN_FILTER, SUPPLIERS);

    expect(rows.map(r => r.supplierName)).toEqual(['山田商店', '', '']);
  });

  it('状態・倉庫・仕入先・予定日で絞り込める', () => {
    const plans = [
      plan({ id: 'pending', expectedDate: d(1) }),
      plan({ id: 'partial', expectedDate: d(3), receivedQuantity: 5, warehouseId: 'wh-hold', supplierId: 'sup-asahi' }),
      plan({ id: 'canceled', expectedDate: d(5), canceledAt: 'x' }),
    ];
    const ids = (filter: Partial<typeof EMPTY_INBOUND_PLAN_FILTER>) =>
      inboundPlanRows(plans, products, { ...EMPTY_INBOUND_PLAN_FILTER, ...filter }, SUPPLIERS).map(r => r.plan.id);

    expect(ids({ status: '一部入荷' })).toEqual(['partial']);
    expect(ids({ status: 'キャンセル' })).toEqual(['canceled']);
    expect(ids({ warehouseId: 'wh-hold' })).toEqual(['partial']);
    expect(ids({ supplierId: 'sup-asahi' })).toEqual(['partial']);
    expect(ids({ from: d(3) })).toEqual(['partial', 'canceled']);
    expect(ids({ to: d(3) })).toEqual(['pending', 'partial']);
  });
});

describe('inboundPlanTotals', () => {
  it('キャンセルは数量の集計に入れず件数だけ数える', () => {
    const products = [product()];
    const rows = inboundPlanRows([
      plan({ id: '1', quantity: 10, receivedQuantity: 4 }),
      plan({ id: '2', quantity: 5, expectedDate: d(-2) }),
      plan({ id: '3', quantity: 100, canceledAt: 'x' }),
    ], products);

    expect(inboundPlanTotals(rows)).toEqual({
      count: 3, planned: 15, received: 4, remaining: 11, overdue: 1, canceled: 1,
    });
  });
});

describe('inboundPlanCsv', () => {
  it('ヘッダーと1予定1行を出力する', () => {
    const rows = inboundPlanRows([plan({ id: '1', expectedDate: '2026-03-01', quantity: 10, receivedQuantity: 4, expiryDate: '2026-04-01', unitPrice: 110, note: 'メモ' })], [product()], EMPTY_INBOUND_PLAN_FILTER, SUPPLIERS);
    const lines = inboundPlanCsv(rows, WAREHOUSES).split('\n');

    expect(lines[0]).toBe('入荷予定日,商品名,SKU,ロットNo,賞味期限,入荷先倉庫,仕入先,仕入単価,予定数量,入荷済,残数,状態,備考');
    expect(lines[1]).toBe('2026-03-01,テスト商品,T-001,20260101,2026-04-01,販売倉庫,山田商店,110,10,4,6,一部入荷,メモ');
  });
});

// ────────────────────────────────────────────────────────────
// 入荷の引当先 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('planReceipt', () => {
  it('予定の内容を既定値にして新しいロットを作る', () => {
    const p = plan({ id: '1', lotNo: '20260401', expiryDate: '2026-04-01', warehouseId: 'wh-hold' });
    const target = planReceipt(p, product(), { quantity: 4 });

    expect(target).toMatchObject({ quantity: 4, lotNo: '20260401', expiryDate: '2026-04-01', warehouseId: 'wh-hold' });
    expect(target.existingLot).toBeUndefined();
  });

  it('ロットNo・倉庫・賞味期限が同じロットがあれば加算先になる', () => {
    const existing: Lot = { id: 'l1', lotNo: '20260401', expiryDate: '2026-04-01', quantity: 6, warehouseId: DEFAULT_WAREHOUSE_ID };
    const p = plan({ id: '1', lotNo: '20260401', expiryDate: '2026-04-01' });

    expect(planReceipt(p, product([existing]), { quantity: 4 }).existingLot?.id).toBe('l1');
    // 倉庫が違えば別ロット
    expect(planReceipt(p, product([existing]), { quantity: 4, warehouseId: 'wh-hold' }).existingLot).toBeUndefined();
    // 賞味期限が違えば別ロット
    expect(planReceipt(p, product([existing]), { quantity: 4, expiryDate: '2026-05-01' }).existingLot).toBeUndefined();
  });

  it('数量は残数を超えない (過入荷は受け付けない)', () => {
    const p = plan({ id: '1', quantity: 10, receivedQuantity: 7 });
    expect(planReceipt(p, product(), { quantity: 100 }).quantity).toBe(3);
    expect(planReceipt(p, product(), { quantity: -5 }).quantity).toBe(0);
  });

  it('ロットNoが空なら賞味期限から自動生成する', () => {
    const p = plan({ id: '1', lotNo: '' });
    expect(planReceipt(p, product(), { quantity: 1, expiryDate: '2026-04-01' }).lotNo).toBe('20260401');
  });
});

// ────────────────────────────────────────────────────────────
// フックのミューテーション
// ────────────────────────────────────────────────────────────
const INPUT: InboundPlanInput = {
  productId: '1', // SAMPLE_DATA の牛乳
  expectedDate: '2026-03-01',
  quantity: 12,
  warehouseId: DEFAULT_WAREHOUSE_ID,
  lotNo: '20260401',
  expiryDate: '2026-04-01',
  supplierId: 'sup-yamada', // DEFAULT_SUPPLIERS の山田乳業
  unitPrice: 125,
  note: '定期便',
};

describe('useInventory — 入荷予定の作成・編集', () => {
  it('addInboundPlan で未入荷の予定が追加される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.inboundPlans.length;

    act(() => { result.current.addInboundPlan(INPUT); });

    const added = result.current.inboundPlans.at(-1)!;
    expect(result.current.inboundPlans.length).toBe(before + 1);
    expect(added).toMatchObject({ ...INPUT, receivedQuantity: 0 });
    expect(inboundPlanStatus(added)).toBe('未入荷');
  });

  it('updateInboundPlan は入荷実績を変えずに内容だけ更新する', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;
    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 5 }); });

    act(() => { result.current.updateInboundPlan(target.id, { ...INPUT, quantity: 20, supplierId: 'sup-asahi' }); });

    const updated = result.current.inboundPlans.find(p => p.id === target.id)!;
    expect(updated).toMatchObject({ quantity: 20, supplierId: 'sup-asahi', receivedQuantity: 5 });
  });

  it('cancelInboundPlan でキャンセルになり、以後は編集できない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;

    act(() => { result.current.cancelInboundPlan(target.id); });
    expect(inboundPlanStatus(result.current.inboundPlans.find(p => p.id === target.id)!)).toBe('キャンセル');

    act(() => { result.current.updateInboundPlan(target.id, { ...INPUT, supplierId: 'sup-asahi' }); });
    expect(result.current.inboundPlans.find(p => p.id === target.id)!.supplierId).toBe('sup-yamada');
  });

  it('deleteInboundPlan で予定が消える', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;

    act(() => { result.current.deleteInboundPlan(target.id); });

    expect(result.current.inboundPlans.find(p => p.id === target.id)).toBeUndefined();
  });

  it('商品を削除するとその商品の入荷予定も消える', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    expect(result.current.inboundPlans.some(p => p.productId === '1')).toBe(true);

    act(() => { result.current.deleteProduct('1'); });

    expect(result.current.inboundPlans.some(p => p.productId === '1')).toBe(false);
  });
});

describe('useInventory — 入荷 (receiveInboundPlan)', () => {
  it('新しいロットが作られ、入荷済数量と帳票が更新される', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;
    const before = totalQuantity(result.current.products.find(p => p.id === '1')!);

    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 12 }); });

    const productAfter = result.current.products.find(p => p.id === '1')!;
    const lot = productAfter.lots.find(l => l.lotNo === '20260401')!;
    expect(lot).toMatchObject({ quantity: 12, expiryDate: '2026-04-01', warehouseId: DEFAULT_WAREHOUSE_ID });
    expect(totalQuantity(productAfter)).toBe(before + 12);

    const updated = result.current.inboundPlans.find(p => p.id === target.id)!;
    expect(updated.receivedQuantity).toBe(12);
    expect(inboundPlanStatus(updated)).toBe('入荷済');

    expect(result.current.ledger[0]).toMatchObject({
      type: '入荷', productId: '1', lotNo: '20260401', quantity: 12,
      note: '入荷予定（山田乳業）', toWarehouseId: DEFAULT_WAREHOUSE_ID,
      unitPrice: 125, supplierId: 'sup-yamada',
    });
  });

  it('分割入荷では同じロットに加算され、帳票は入荷ごとに残る', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;

    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 5 }); });
    expect(inboundPlanStatus(result.current.inboundPlans.find(p => p.id === target.id)!)).toBe('一部入荷');

    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 7 }); });

    const lots = result.current.products.find(p => p.id === '1')!.lots.filter(l => l.lotNo === '20260401');
    expect(lots).toHaveLength(1);
    expect(lots[0].quantity).toBe(12);
    expect(result.current.inboundPlans.find(p => p.id === target.id)!.receivedQuantity).toBe(12);
    expect(result.current.ledger.filter(t => t.lotNo === '20260401')).toHaveLength(2);
  });

  it('残数を超える入荷は残数までに丸められる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;

    let received = 0;
    act(() => { received = result.current.receiveInboundPlan(target.id, { quantity: 100 })?.quantity ?? 0; });

    expect(received).toBe(12);
    expect(result.current.inboundPlans.find(p => p.id === target.id)!.receivedQuantity).toBe(12);
  });

  it('入荷時に倉庫・ロットNo・賞味期限・備考を上書きできる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;

    act(() => {
      result.current.receiveInboundPlan(target.id, {
        quantity: 3, warehouseId: 'wh-hold', lotNo: '20260505', expiryDate: '2026-05-05', note: '検品待ち',
      });
    });

    const lot = result.current.products.find(p => p.id === '1')!.lots.find(l => l.lotNo === '20260505')!;
    expect(lot).toMatchObject({ quantity: 3, expiryDate: '2026-05-05', warehouseId: 'wh-hold' });
    expect(result.current.ledger[0]).toMatchObject({ type: '入荷', note: '検品待ち', toWarehouseId: 'wh-hold' });
  });

  it('キャンセル済み・入荷済みの予定は入荷できない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan(INPUT); });
    const target = result.current.inboundPlans.at(-1)!;
    act(() => { result.current.cancelInboundPlan(target.id); });

    let res: unknown = 'not-called';
    act(() => { res = result.current.receiveInboundPlan(target.id, { quantity: 1 }); });

    expect(res).toBeNull();
    expect(result.current.ledger).toHaveLength(0);
  });

  it('既存ロットと同じロットNo・倉庫・賞味期限なら既存ロットに加算する', () => {
    const { result } = renderHook(() => useInventory());
    const milk = result.current.products.find(p => p.id === '1')!;
    const existing = milk.lots[0];

    act(() => {
      result.current.addInboundPlan({
        ...INPUT, lotNo: existing.lotNo, expiryDate: existing.expiryDate, quantity: 6,
        warehouseId: existing.warehouseId,
      });
    });
    const target = result.current.inboundPlans.at(-1)!;
    const lotCountBefore = result.current.products.find(p => p.id === '1')!.lots.length;

    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 6 }); });

    const after = result.current.products.find(p => p.id === '1')!;
    expect(after.lots).toHaveLength(lotCountBefore);
    expect(after.lots.find(l => l.id === existing.id)!.quantity).toBe(existing.quantity + 6);
  });
});

describe('useInventory — 入荷予定の永続化', () => {
  it('作成・入荷が /api/inbound-plans に保存される', async () => {
    const server = stubApi({
      products: [product([], { id: 'p1' })],
      warehouses: WAREHOUSES,
      categories: [{ id: 'cat-dairy', name: '乳製品' }],
    });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    act(() => { result.current.addInboundPlan({ ...INPUT, productId: 'p1' }); });
    await waitFor(() => expect(server.inboundPlans).toHaveLength(1));

    const target = result.current.inboundPlans[0];
    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 4 }); });

    await waitFor(() => expect(server.inboundPlans[0].receivedQuantity).toBe(4));
    expect(server.products[0].lots.find(l => l.lotNo === '20260401')?.quantity).toBe(4);
    expect(server.ledger[0]).toMatchObject({ type: '入荷', quantity: 4 });
  });

  it('入荷予定を返さない旧サーバーからのレスポンスでも空で動作する', async () => {
    stubApi({ products: [product([], { id: 'p1' })], warehouses: WAREHOUSES });
    const { result } = renderHook(() => useInventory());

    await waitFor(() => expect(result.current.products).toHaveLength(1));
    expect(result.current.inboundPlans).toEqual([]);
  });
});

describe('useInventory — 倉庫の削除制限', () => {
  it('入荷待ちの予定が入荷先にしている倉庫は削除できない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addInboundPlan({ ...INPUT, warehouseId: 'wh-defect' }); });
    const target = result.current.inboundPlans.at(-1)!;

    act(() => { result.current.deleteWarehouse('wh-defect'); });
    expect(result.current.warehouses.some(w => w.id === 'wh-defect')).toBe(true);

    // キャンセルすれば残数が消えるので削除できる
    act(() => { result.current.cancelInboundPlan(target.id); });
    act(() => { result.current.deleteWarehouse('wh-defect'); });
    expect(result.current.warehouses.some(w => w.id === 'wh-defect')).toBe(false);
  });
});
