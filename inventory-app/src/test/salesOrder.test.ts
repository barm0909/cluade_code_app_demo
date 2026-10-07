import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  salesOrderStatus,
  remainingShipment,
  isOverdueSalesOrder,
  salesOrderValidationError,
  salesOrderAllocations,
  salesOrderRows,
  salesOrderTotals,
  salesOrderCsv,
  salesOrderCountByCustomer,
  planSalesOrderShipment,
  salesOrderShipmentNote,
  salesRows,
  totalQuantity,
  EMPTY_SALES_ORDER_FILTER,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { Customer, Lot, Product, SalesOrder, SalesOrderInput, Warehouse } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

// テスト用の日付 (今日からのオフセット)
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const order = (over: Partial<SalesOrder> & { id: string }): SalesOrder => ({
  customerId: 'c1',
  productId: 'p1',
  expectedDate: d(1),
  quantity: 10,
  shippedQuantity: 0,
  unitPrice: 0,
  warehouseId: '',
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const lot = (over: Partial<Lot> & { id: string }): Lot => ({
  lotNo: over.id, quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID, ...over,
});

const product = (lots: Lot[] = [], over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'テスト商品', sku: 'T-001', categoryId: 'cat-dairy',
  lots, minQuantity: 0, price: 100, costPrice: 60, taxRate: 8, updatedAt: new Date().toISOString(),
  ...over,
});

const customer = (id: string, name: string): Customer => ({
  id, name, code: '', contact: '', phone: '', email: '', address: '', note: '', active: true,
});

const CUSTOMERS = [customer('c1', 'みどりストア'), customer('c2', 'さくらカフェ')];

const WAREHOUSES: Warehouse[] = [
  { id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

describe('salesOrderStatus / remainingShipment / isOverdueSalesOrder', () => {
  it('出荷済数量から状態を導出する', () => {
    expect(salesOrderStatus(order({ id: 'o', shippedQuantity: 0 }))).toBe('未出荷');
    expect(salesOrderStatus(order({ id: 'o', shippedQuantity: 4 }))).toBe('一部出荷');
    expect(salesOrderStatus(order({ id: 'o', shippedQuantity: 10 }))).toBe('出荷済');
    // 受注数量を出荷済より減らしたら出荷済扱い
    expect(salesOrderStatus(order({ id: 'o', quantity: 3, shippedQuantity: 4 }))).toBe('出荷済');
    expect(salesOrderStatus(order({ id: 'o', shippedQuantity: 4, canceledAt: '2026-01-02T00:00:00.000Z' }))).toBe('キャンセル');
  });

  it('受注残はキャンセル・出荷済で 0、マイナスにはならない', () => {
    expect(remainingShipment(order({ id: 'o', shippedQuantity: 4 }))).toBe(6);
    expect(remainingShipment(order({ id: 'o', quantity: 3, shippedQuantity: 4 }))).toBe(0);
    expect(remainingShipment(order({ id: 'o', canceledAt: '2026-01-02T00:00:00.000Z' }))).toBe(0);
  });

  it('出荷予定日を過ぎて受注残があるときだけ遅延', () => {
    expect(isOverdueSalesOrder(order({ id: 'o', expectedDate: d(-1) }))).toBe(true);
    expect(isOverdueSalesOrder(order({ id: 'o', expectedDate: d(0) }))).toBe(false);
    expect(isOverdueSalesOrder(order({ id: 'o', expectedDate: d(-1), shippedQuantity: 10 }))).toBe(false);
  });
});

describe('salesOrderValidationError', () => {
  const products = [product(), product([], { id: 'm1', name: 'ラベル', kind: '資材' })];
  const input: SalesOrderInput = { customerId: 'c1', productId: 'p1', expectedDate: d(1), quantity: 5, unitPrice: 100, warehouseId: '', note: '' };

  it('問題がなければ空文字を返す', () => {
    expect(salesOrderValidationError(input, products, CUSTOMERS)).toBe('');
  });

  it('商品・得意先・日付・数量・単価を確認する', () => {
    expect(salesOrderValidationError({ ...input, productId: 'nope' }, products, CUSTOMERS)).toBe('商品を選んでください');
    expect(salesOrderValidationError({ ...input, customerId: '' }, products, CUSTOMERS)).toBe('得意先を選んでください');
    expect(salesOrderValidationError({ ...input, customerId: 'gone' }, products, CUSTOMERS)).toBe('得意先を選んでください');
    expect(salesOrderValidationError({ ...input, expectedDate: '' }, products, CUSTOMERS)).toBe('出荷予定日を入力してください');
    expect(salesOrderValidationError({ ...input, quantity: 0 }, products, CUSTOMERS)).toBe('受注数量は1以上で入力してください');
    expect(salesOrderValidationError({ ...input, unitPrice: -1 }, products, CUSTOMERS)).toBe('受注単価は0以上で入力してください');
  });

  it('資材は受注できない（売らないため）', () => {
    expect(salesOrderValidationError({ ...input, productId: 'm1' }, products, CUSTOMERS)).toBe('資材は受注の対象にできません');
  });
});

describe('salesOrderAllocations', () => {
  it('出荷予定日の早い受注から在庫を割り当て、同じ在庫を二重に数えない', () => {
    const p = product([lot({ id: 'l1', quantity: 8 })]);
    const orders = [
      order({ id: 'late', expectedDate: d(3), quantity: 5 }),
      order({ id: 'early', expectedDate: d(1), quantity: 5 }),
    ];
    const result = salesOrderAllocations(orders, [p]);
    expect(result.get('early')).toEqual({ allocated: 5, shortage: 0 });
    expect(result.get('late')).toEqual({ allocated: 3, shortage: 2 });
  });

  it('同じ日なら先に登録した受注が優先', () => {
    const p = product([lot({ id: 'l1', quantity: 5 })]);
    const orders = [
      order({ id: 'second', quantity: 5, createdAt: '2026-01-02T00:00:00.000Z' }),
      order({ id: 'first', quantity: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = salesOrderAllocations(orders, [p]);
    expect(result.get('first')!.shortage).toBe(0);
    expect(result.get('second')!.shortage).toBe(5);
  });

  it('受注残だけを割り当てる（出荷済の分は在庫から引き済み）', () => {
    const p = product([lot({ id: 'l1', quantity: 4 })]);
    const result = salesOrderAllocations([order({ id: 'o', quantity: 10, shippedQuantity: 6 })], [p]);
    expect(result.get('o')).toEqual({ allocated: 4, shortage: 0 });
  });

  it('出荷元倉庫を指定した受注はその倉庫の在庫だけを見る', () => {
    const p = product([lot({ id: 'l1', quantity: 10, warehouseId: 'wh-hold' })]);
    const result = salesOrderAllocations([order({ id: 'o', quantity: 3, warehouseId: DEFAULT_WAREHOUSE_ID })], [p]);
    expect(result.get('o')).toEqual({ allocated: 0, shortage: 3 });
  });

  it('期限切れロットは引当に数えない（出荷の既定と同じ）', () => {
    const p = product([lot({ id: 'l1', quantity: 10, expiryDate: d(-1) })]);
    const result = salesOrderAllocations([order({ id: 'o', quantity: 3 })], [p]);
    expect(result.get('o')!.shortage).toBe(3);
  });

  it('出荷済・キャンセル・商品のない受注は結果に含めない', () => {
    const p = product([lot({ id: 'l1' })]);
    const result = salesOrderAllocations([
      order({ id: 'done', shippedQuantity: 10 }),
      order({ id: 'canceled', canceledAt: '2026-01-02T00:00:00.000Z' }),
      order({ id: 'orphan', productId: 'gone' }),
    ], [p]);
    expect(result.size).toBe(0);
  });

  it('元の商品のロットは変更しない', () => {
    const p = product([lot({ id: 'l1', quantity: 10 })]);
    salesOrderAllocations([order({ id: 'o', quantity: 6 })], [p]);
    expect(p.lots[0].quantity).toBe(10);
  });
});

describe('salesOrderRows / salesOrderTotals / salesOrderCsv', () => {
  const p1 = product([lot({ id: 'l1', quantity: 8 })]);
  const p2 = product([], { id: 'p2', name: '食パン', sku: 'BR-001', price: 150 });
  const orders = [
    order({ id: 'o1', expectedDate: d(2), quantity: 5, unitPrice: 90 }),
    order({ id: 'o2', expectedDate: d(-1), quantity: 6, customerId: 'c2', productId: 'p2' }),
    order({ id: 'o3', expectedDate: d(3), quantity: 4, shippedQuantity: 4, unitPrice: 95 }),
    order({ id: 'o4', expectedDate: d(1), quantity: 2, canceledAt: '2026-01-02T00:00:00.000Z' }),
  ];

  it('出荷予定日の早い順に並べ、得意先名・受注残・引当を付ける', () => {
    const rows = salesOrderRows(orders, [p1, p2], CUSTOMERS);
    expect(rows.map(r => r.order.id)).toEqual(['o2', 'o4', 'o1', 'o3']);
    const o2 = rows.find(r => r.order.id === 'o2')!;
    expect(o2.customerName).toBe('さくらカフェ');
    expect(o2.overdue).toBe(true);
    expect(o2.shortage).toBe(6);
    const o1 = rows.find(r => r.order.id === 'o1')!;
    expect(o1).toMatchObject({ remaining: 5, allocated: 5, shortage: 0, unitPrice: 90, estimatedPrice: false, remainingAmount: 450 });
  });

  it('受注単価が未入力なら販売定価で概算する', () => {
    const o2 = salesOrderRows(orders, [p1, p2], CUSTOMERS).find(r => r.order.id === 'o2')!;
    expect(o2).toMatchObject({ unitPrice: 150, estimatedPrice: true, remainingAmount: 900 });
  });

  it('絞り込んでも引当は全受注で計算する', () => {
    const competing = [
      order({ id: 'first', expectedDate: d(1), quantity: 8, customerId: 'c2' }),
      order({ id: 'second', expectedDate: d(2), quantity: 3 }),
    ];
    const rows = salesOrderRows(competing, [p1], CUSTOMERS, { ...EMPTY_SALES_ORDER_FILTER, customerId: 'c1' });
    expect(rows.map(r => r.order.id)).toEqual(['second']);
    expect(rows[0].shortage).toBe(3);
  });

  it('キーワード・状態・得意先・出荷予定日で絞り込む', () => {
    const ids = (f: Partial<typeof EMPTY_SALES_ORDER_FILTER>) =>
      salesOrderRows(orders, [p1, p2], CUSTOMERS, { ...EMPTY_SALES_ORDER_FILTER, ...f }).map(r => r.order.id);
    expect(ids({ keyword: 'さくら' })).toEqual(['o2']);
    expect(ids({ keyword: 'br-001' })).toEqual(['o2']);
    expect(ids({ status: '出荷済' })).toEqual(['o3']);
    expect(ids({ customerId: 'c2' })).toEqual(['o2']);
    expect(ids({ from: d(2), to: d(3) })).toEqual(['o1', 'o3']);
  });

  it('商品マスタにない商品の受注は表示しない', () => {
    expect(salesOrderRows([order({ id: 'x', productId: 'gone' })], [p1], CUSTOMERS)).toEqual([]);
  });

  it('合計はキャンセルを除いて数え、不足・遅延の件数も出す', () => {
    const totals = salesOrderTotals(salesOrderRows(orders, [p1, p2], CUSTOMERS));
    expect(totals).toEqual({
      count: 4, ordered: 15, shipped: 4, remaining: 11, remainingAmount: 450 + 900,
      overdue: 1, short: 1, canceled: 1,
    });
  });

  it('CSV は見出し + 行の数だけ出し、出荷元未指定は「全倉庫」', () => {
    const lines = salesOrderCsv(salesOrderRows(orders, [p1, p2], CUSTOMERS), WAREHOUSES).split('\n');
    expect(lines[0]).toBe('出荷予定日,得意先,商品名,SKU,出荷元倉庫,受注単価(税抜),受注数量,出荷済,受注残,引当可能,在庫不足,受注残金額(税抜),状態,概算,備考');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(`${d(-1)},さくらカフェ,食パン,BR-001,全倉庫,150,6,0,6,0,6,900,未出荷,概算,`);
  });
});

describe('salesOrderCountByCustomer', () => {
  it('キャンセル・出荷済も含めて得意先ごとに数える', () => {
    const counts = salesOrderCountByCustomer([
      order({ id: 'a' }),
      order({ id: 'b', canceledAt: '2026-01-02T00:00:00.000Z' }),
      order({ id: 'c', customerId: 'c2', shippedQuantity: 10 }),
    ]);
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c2')).toBe(1);
  });
});

describe('planSalesOrderShipment', () => {
  it('受注残を超える数量は受注残に丸める（過出荷しない）', () => {
    const p = product([lot({ id: 'l1', quantity: 20 })]);
    const plan = planSalesOrderShipment(order({ id: 'o', quantity: 10, shippedQuantity: 7 }), p, { quantity: 9 });
    expect(plan.allocated).toBe(3);
    expect(plan.shortage).toBe(0);
  });

  it('受注の出荷元倉庫から FEFO で引き当てる', () => {
    const p = product([
      lot({ id: 'hold', quantity: 10, warehouseId: 'wh-hold', expiryDate: d(1) }),
      lot({ id: 'late', quantity: 10, expiryDate: d(9) }),
      lot({ id: 'soon', quantity: 2, expiryDate: d(2) }),
    ]);
    const plan = planSalesOrderShipment(order({ id: 'o', warehouseId: DEFAULT_WAREHOUSE_ID }), p, { quantity: 5 });
    expect(plan.allocations.map(a => [a.lotId, a.quantity])).toEqual([['soon', 2], ['late', 3]]);
  });

  it('在庫が足りなければ不足数を返す', () => {
    const p = product([lot({ id: 'l1', quantity: 2 })]);
    expect(planSalesOrderShipment(order({ id: 'o' }), p, { quantity: 5 }).shortage).toBe(3);
  });

  it('既定の備考は得意先名入り', () => {
    expect(salesOrderShipmentNote('みどりストア')).toBe('受注出荷（みどりストア）');
    expect(salesOrderShipmentNote('')).toBe('受注出荷');
  });
});

// ---- ミューテーション (API に届かないのでサンプルデータで動く) ----
// サンプル: 牛乳 (id 1) は l1 10 + l2 10、得意先 cus-midori 等、受注 so1〜so3

const INPUT: SalesOrderInput = {
  customerId: 'cus-sakura', productId: '1', expectedDate: d(3), quantity: 5, unitPrice: 190, warehouseId: '', note: 'テスト',
};

describe('useInventory — 受注', () => {
  it('サンプルの受注を持って始まる', () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.salesOrders.map(o => o.id)).toEqual(['so1', 'so2', 'so3']);
  });

  it('登録しても在庫・帳票は動かない', () => {
    const { result } = renderHook(() => useInventory());
    const before = totalQuantity(result.current.products.find(p => p.id === '1')!);

    act(() => { result.current.addSalesOrder(INPUT); });

    const created = result.current.salesOrders.find(o => o.note === 'テスト')!;
    expect(created).toMatchObject({ ...INPUT, shippedQuantity: 0 });
    expect(totalQuantity(result.current.products.find(p => p.id === '1')!)).toBe(before);
    expect(result.current.ledger).toHaveLength(0);
  });

  it('入力チェックに引っかかる登録・更新は何も起こさない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addSalesOrder({ ...INPUT, productId: '3' }); }); // 資材
    act(() => { result.current.addSalesOrder({ ...INPUT, quantity: 0 }); });
    act(() => { result.current.updateSalesOrder('so1', { ...INPUT, customerId: '' }); });

    expect(result.current.salesOrders).toHaveLength(3);
    expect(result.current.salesOrders.find(o => o.id === 'so1')!.customerId).toBe('cus-midori');
  });

  it('出荷すると FEFO で売上出庫し、受注単価・得意先つきで帳票に残る', () => {
    const { result } = renderHook(() => useInventory());

    let shipped: ReturnType<typeof result.current.shipSalesOrder> = null;
    act(() => { shipped = result.current.shipSalesOrder('so1', { quantity: 12 }); });

    expect(shipped!.plan.allocated).toBe(12);
    expect(shipped!.remaining).toBe(0);
    const so1 = result.current.salesOrders.find(o => o.id === 'so1')!;
    expect(so1.shippedQuantity).toBe(12);
    expect(salesOrderStatus(so1)).toBe('出荷済');

    // 期限の近い l1 (10) から先に、残りを l2 から
    const milk = result.current.products.find(p => p.id === '1')!;
    expect(milk.lots.map(l => l.quantity)).toEqual([0, 8]);
    const txns = result.current.ledger;
    expect(txns).toHaveLength(2);
    for (const t of txns) {
      expect(t).toMatchObject({ type: '売上出庫', unitPrice: 190, customerId: 'cus-midori', note: '受注出荷（みどりストア）', taxRate: 8 });
    }
    expect(txns.map(t => t.costUnitPrice).sort()).toEqual([118, 120]);

    // 売上管理にもそのまま並ぶ
    const sales = salesRows(txns, result.current.products, result.current.customers);
    expect(sales.reduce((s, r) => s + r.amount, 0)).toBe(190 * 12);
  });

  it('分割出荷では出荷した分だけ受注残が減る', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.shipSalesOrder('so1', { quantity: 5, note: '午前便' }); });

    const so1 = result.current.salesOrders.find(o => o.id === 'so1')!;
    expect(so1.shippedQuantity).toBe(5);
    expect(salesOrderStatus(so1)).toBe('一部出荷');
    expect(result.current.ledger[0].note).toBe('午前便');
  });

  it('受注残を超える数量は受注残までしか出荷しない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.shipSalesOrder('so3', { quantity: 99 }); });
    expect(result.current.salesOrders.find(o => o.id === 'so3')!.shippedQuantity).toBe(3);
    expect(result.current.ledger.reduce((s, t) => s + t.quantity, 0)).toBe(3);
  });

  it('在庫が足りなければ引けた分だけ出荷し、1つも引けなければ何もしない', () => {
    const { result } = renderHook(() => useInventory());

    // 食パンは在庫 3 しかないが受注は 10
    let shipped: ReturnType<typeof result.current.shipSalesOrder> = null;
    act(() => { shipped = result.current.shipSalesOrder('so2', { quantity: 10 }); });
    expect(shipped!.plan.allocated).toBe(3);
    expect(shipped!.plan.shortage).toBe(7);
    expect(shipped!.remaining).toBe(7);

    act(() => { shipped = result.current.shipSalesOrder('so2', { quantity: 7 }); });
    expect(shipped).toBeNull();
    expect(result.current.salesOrders.find(o => o.id === 'so2')!.shippedQuantity).toBe(3);
  });

  it('キャンセルした受注は出荷・編集できない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.cancelSalesOrder('so1'); });
    act(() => { result.current.shipSalesOrder('so1', { quantity: 1 }); });
    act(() => { result.current.updateSalesOrder('so1', INPUT); });

    const so1 = result.current.salesOrders.find(o => o.id === 'so1')!;
    expect(salesOrderStatus(so1)).toBe('キャンセル');
    expect(so1.customerId).toBe('cus-midori');
    expect(result.current.ledger).toHaveLength(0);
  });

  it('編集しても出荷済数量は変わらない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.shipSalesOrder('so1', { quantity: 5 }); });
    act(() => { result.current.updateSalesOrder('so1', { ...INPUT, customerId: 'cus-midori', quantity: 20 }); });
    expect(result.current.salesOrders.find(o => o.id === 'so1')).toMatchObject({ quantity: 20, shippedQuantity: 5 });
  });

  it('削除すると受注そのものが消える', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.deleteSalesOrder('so2'); });
    expect(result.current.salesOrders.map(o => o.id)).toEqual(['so1', 'so3']);
  });

  it('商品を削除するとその商品の受注も消える', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.deleteProduct('1'); });
    expect(result.current.salesOrders.map(o => o.id)).toEqual(['so2', 'so3']);
  });

  it('受注のある得意先は削除できない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.deleteCustomer('cus-kita'); });
    expect(result.current.customers.map(c => c.id)).toContain('cus-kita');

    act(() => { result.current.deleteSalesOrder('so3'); });
    act(() => { result.current.deleteCustomer('cus-kita'); });
    expect(result.current.customers.map(c => c.id)).not.toContain('cus-kita');
  });

  it('出荷待ちの受注が出荷元にしている倉庫は削除できない', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addWarehouse('臨時倉庫', '#000000'); });
    const temp = result.current.warehouses.find(w => w.name === '臨時倉庫')!;
    act(() => { result.current.addSalesOrder({ ...INPUT, warehouseId: temp.id }); });

    act(() => { result.current.deleteWarehouse(temp.id); });
    expect(result.current.warehouses.map(w => w.id)).toContain(temp.id);

    const created = result.current.salesOrders.find(o => o.warehouseId === temp.id)!;
    act(() => { result.current.cancelSalesOrder(created.id); });
    act(() => { result.current.deleteWarehouse(temp.id); });
    expect(result.current.warehouses.map(w => w.id)).not.toContain(temp.id);
  });

  it('リセットでサンプルの受注に戻る', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.deleteSalesOrder('so1'); });
    act(() => { result.current.resetToSample(); });
    expect(result.current.salesOrders.map(o => o.id)).toEqual(['so1', 'so2', 'so3']);
  });
});

describe('useInventory — 受注の永続化', () => {
  it('サーバーの受注を読み込み、変更のたびに保存し直す', async () => {
    const server = stubApi({
      products: [product([lot({ id: 'l1', quantity: 10, unitPrice: 70 })])],
      customers: [customer('c1', 'みどりストア')],
      salesOrders: [order({ id: 'o1', quantity: 4, unitPrice: 120 })],
    });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.salesOrders.map(o => o.id)).toEqual(['o1']));

    act(() => { result.current.shipSalesOrder('o1', { quantity: 4 }); });

    await waitFor(() => {
      expect(server.salesOrders[0].shippedQuantity).toBe(4);
      const saved = server.ledger.find(t => t.type === '売上出庫')!;
      expect(saved).toMatchObject({ unitPrice: 120, customerId: 'c1', costUnitPrice: 70, quantity: 4 });
    });
  });

  it('受注を持たない旧サーバーからは空で始まる', async () => {
    const server = stubApi();
    delete (server as Partial<typeof server>).salesOrders;
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.salesOrders).toEqual([]));
  });
});
