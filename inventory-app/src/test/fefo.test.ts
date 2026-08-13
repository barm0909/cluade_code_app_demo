import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInventory, planFefoShipment, fefoLotOrder, totalQuantity, DEFAULT_WAREHOUSE_ID } from '../useInventory';
import type { Lot, Product } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

// テスト用の日付 (今日からのオフセット)。SAMPLE_DATA と同じ作り方
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const lot = (over: Partial<Lot> & { id: string; quantity: number }): Lot => ({
  lotNo: over.id,
  warehouseId: DEFAULT_WAREHOUSE_ID,
  ...over,
});

const product = (lots: Lot[]): Product => ({
  id: 'p1', name: 'テスト商品', sku: 'T-001', categoryId: 'cat-dairy',
  lots, minQuantity: 0, price: 100, costPrice: 60, updatedAt: new Date().toISOString(),
});

// ────────────────────────────────────────────────────────────
// 引当計画 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('planFefoShipment — 引当順', () => {
  it('賞味期限の近いロットから引き当てる', () => {
    const p = product([
      lot({ id: 'late', quantity: 10, expiryDate: d(30) }),
      lot({ id: 'soon', quantity: 10, expiryDate: d(3) }),
    ]);

    const plan = planFefoShipment(p, 4);

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].lotId).toBe('soon');
    expect(plan.allocations[0].quantity).toBe(4);
    expect(plan.allocated).toBe(4);
    expect(plan.shortage).toBe(0);
  });

  it('1ロットで足りないときは次のロットへ繰り越す', () => {
    const p = product([
      lot({ id: 'soon', quantity: 10, expiryDate: d(3) }),
      lot({ id: 'mid', quantity: 10, expiryDate: d(10) }),
      lot({ id: 'late', quantity: 10, expiryDate: d(30) }),
    ]);

    const plan = planFefoShipment(p, 15);

    expect(plan.allocations.map(a => [a.lotId, a.quantity])).toEqual([['soon', 10], ['mid', 5]]);
    expect(plan.allocated).toBe(15);
    expect(plan.shortage).toBe(0);
  });

  it('賞味期限のないロットは最後に引き当てる', () => {
    const p = product([
      lot({ id: 'none', quantity: 10 }),
      lot({ id: 'far', quantity: 3, expiryDate: d(365) }),
    ]);

    const plan = planFefoShipment(p, 5);

    expect(plan.allocations.map(a => [a.lotId, a.quantity])).toEqual([['far', 3], ['none', 2]]);
  });

  it('在庫0のロットは引当対象にならない', () => {
    const p = product([
      lot({ id: 'empty', quantity: 0, expiryDate: d(1) }),
      lot({ id: 'stocked', quantity: 5, expiryDate: d(10) }),
    ]);

    const plan = planFefoShipment(p, 2);

    expect(plan.allocations.map(a => a.lotId)).toEqual(['stocked']);
  });

  it('引当後の残数が分かるよう引当前の在庫数を返す', () => {
    const p = product([lot({ id: 'a', quantity: 10, expiryDate: d(3) })]);

    const [alloc] = planFefoShipment(p, 4).allocations;

    expect(alloc.availableQuantity).toBe(10);
    expect(alloc.availableQuantity - alloc.quantity).toBe(6);
  });

  it('同じ賞味期限のロットはロットNo順で安定して並ぶ', () => {
    const p = product([
      lot({ id: 'b', lotNo: '20260102', quantity: 1, expiryDate: d(5) }),
      lot({ id: 'a', lotNo: '20260101', quantity: 1, expiryDate: d(5) }),
    ]);

    expect(fefoLotOrder(p).map(l => l.id)).toEqual(['a', 'b']);
  });
});

describe('planFefoShipment — 期限切れロット', () => {
  it('既定では期限切れロットを引き当てず skippedExpired に数える', () => {
    const p = product([
      lot({ id: 'expired', quantity: 5, expiryDate: d(-2) }),
      lot({ id: 'fresh', quantity: 5, expiryDate: d(10) }),
    ]);

    const plan = planFefoShipment(p, 3);

    expect(plan.allocations.map(a => a.lotId)).toEqual(['fresh']);
    expect(plan.skippedExpired).toBe(5);
  });

  it('includeExpired を指定すると期限切れロットから先に引き当てる', () => {
    const p = product([
      lot({ id: 'expired', quantity: 5, expiryDate: d(-2) }),
      lot({ id: 'fresh', quantity: 5, expiryDate: d(10) }),
    ]);

    const plan = planFefoShipment(p, 7, { includeExpired: true });

    expect(plan.allocations.map(a => [a.lotId, a.quantity])).toEqual([['expired', 5], ['fresh', 2]]);
    expect(plan.skippedExpired).toBe(0);
  });
});

describe('planFefoShipment — 倉庫指定と在庫不足', () => {
  it('倉庫を指定するとその倉庫のロットだけを引き当てる', () => {
    const p = product([
      lot({ id: 'hold', quantity: 10, expiryDate: d(1), warehouseId: 'wh-hold' }),
      lot({ id: 'sales', quantity: 10, expiryDate: d(20) }),
    ]);

    const plan = planFefoShipment(p, 4, { warehouseId: DEFAULT_WAREHOUSE_ID });

    expect(plan.allocations.map(a => a.lotId)).toEqual(['sales']);
  });

  it('在庫が足りないときは引ける分だけ引き当て、残りを shortage で返す', () => {
    const p = product([lot({ id: 'a', quantity: 3, expiryDate: d(3) })]);

    const plan = planFefoShipment(p, 10);

    expect(plan.allocated).toBe(3);
    expect(plan.shortage).toBe(7);
  });

  it('引当できるロットが1つもなければ空の計画を返す', () => {
    const plan = planFefoShipment(product([]), 5);

    expect(plan.allocations).toEqual([]);
    expect(plan.allocated).toBe(0);
    expect(plan.shortage).toBe(5);
  });

  it('数量0や負数を渡しても引き当てない', () => {
    const p = product([lot({ id: 'a', quantity: 5, expiryDate: d(3) })]);

    expect(planFefoShipment(p, 0).allocations).toEqual([]);
    expect(planFefoShipment(p, -3).allocations).toEqual([]);
    expect(planFefoShipment(p, -3).shortage).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 出庫の実行 (フック)
// ────────────────────────────────────────────────────────────
// SAMPLE_DATA: 牛乳(id:1) = 3日後10 + 7日後10、チーズ(id:4) = 2日前2(保留倉庫) + 14日後4(販売倉庫)
describe('useInventory — shipFefo', () => {
  it('期限の近いロットから在庫を引き落とす', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('1', 12); });

    const milk = result.current.products.find(p => p.id === '1')!;
    expect(milk.lots.find(l => l.id === 'l1')!.quantity).toBe(0);
    expect(milk.lots.find(l => l.id === 'l2')!.quantity).toBe(8);
    expect(totalQuantity(milk)).toBe(8);
  });

  it('引き当てたロットごとに出庫を帳票へ記録する', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('1', 12); });

    const txns = result.current.ledger.filter(t => t.productId === '1');
    expect(txns).toHaveLength(2);
    expect(txns.every(t => t.type === '売上出庫')).toBe(true);
    expect(txns.every(t => t.note === 'FEFO出庫')).toBe(true);
    expect(txns.every(t => t.fromWarehouseId === DEFAULT_WAREHOUSE_ID)).toBe(true);
    expect(txns.map(t => t.quantity).sort((a, b) => a - b)).toEqual([2, 10]);
  });

  it('出庫区分を指定するとその区分で記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('1', 1, { type: '廃棄' }); });

    expect(result.current.ledger[0].type).toBe('廃棄');
  });

  it('既定では期限切れロットを残したまま新しいロットから出庫する', () => {
    const { result } = renderHook(() => useInventory());

    let skipped = 0;
    act(() => { skipped = result.current.shipFefo('4', 3).skippedExpired; });

    const cheese = result.current.products.find(p => p.id === '4')!;
    expect(cheese.lots.find(l => l.id === 'l5')!.quantity).toBe(2); // 期限切れロットは手つかず
    expect(cheese.lots.find(l => l.id === 'l6')!.quantity).toBe(1);
    expect(skipped).toBe(2);
  });

  it('includeExpired を指定すると期限切れロットから出庫する', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('4', 3, { includeExpired: true }); });

    const cheese = result.current.products.find(p => p.id === '4')!;
    expect(cheese.lots.find(l => l.id === 'l5')!.quantity).toBe(0);
    expect(cheese.lots.find(l => l.id === 'l6')!.quantity).toBe(3);
  });

  it('倉庫を指定するとその倉庫のロットだけから出庫する', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipFefo('4', 2, { warehouseId: DEFAULT_WAREHOUSE_ID, includeExpired: true }); });

    const cheese = result.current.products.find(p => p.id === '4')!;
    expect(cheese.lots.find(l => l.id === 'l5')!.quantity).toBe(2); // 保留倉庫は対象外
    expect(cheese.lots.find(l => l.id === 'l6')!.quantity).toBe(2);
  });

  it('在庫を超える数量は引ける分だけ出庫し、不足数を返す', () => {
    const { result } = renderHook(() => useInventory());

    let shortage = 0;
    act(() => { shortage = result.current.shipFefo('4', 10).shortage; });

    const cheese = result.current.products.find(p => p.id === '4')!;
    expect(totalQuantity(cheese)).toBe(2); // 期限切れの2だけが残る
    expect(shortage).toBe(6);
  });

  it('存在しない商品IDでは何も起きない', () => {
    const { result } = renderHook(() => useInventory());

    let plan!: ReturnType<typeof result.current.shipFefo>;
    act(() => { plan = result.current.shipFefo('missing', 5); });

    expect(plan.allocations).toEqual([]);
    expect(plan.shortage).toBe(5);
    expect(result.current.ledger).toHaveLength(0);
  });

  it('出庫結果が API に保存される', async () => {
    const server = stubApi({
      products: [product([
        lot({ id: 'soon', quantity: 4, expiryDate: d(2) }),
        lot({ id: 'late', quantity: 4, expiryDate: d(20) }),
      ])],
      categories: [{ id: 'cat-dairy', name: '乳製品' }],
    });
    const { result } = renderHook(() => useInventory());
    // サンプルデータも2ロットの商品を持つので、id で API の内容に入れ替わったことを確かめる
    await waitFor(() => expect(result.current.products.map(p => p.id)).toEqual(['p1']));

    act(() => { result.current.shipFefo('p1', 6); });

    await waitFor(() => {
      expect(server.products[0].lots.find(l => l.id === 'soon')!.quantity).toBe(0);
      expect(server.products[0].lots.find(l => l.id === 'late')!.quantity).toBe(2);
      expect(server.ledger).toHaveLength(2);
    });
  });
});
