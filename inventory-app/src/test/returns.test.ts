import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  returnedQuantities,
  returnableSaleQuantity,
  planSalesReturn,
  purchaseReturnDefaults,
  planPurchaseReturn,
  salesRows,
  salesTotals,
  customerUsage,
  salesDocumentLines,
  salesDocumentTotals,
  stockAnalysisRows,
  transactionDirection,
  taxAmount,
  totalQuantity,
  ALL_TRANSACTION_TYPES,
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { Customer, Product, StockTransaction, Supplier } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
];
const SUPPLIERS: Supplier[] = [
  { id: 'sup-a', name: '山田乳業', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true },
];

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 8, updatedAt: '',
  lots: [{ id: 'l1', lotNo: '20260703', expiryDate: '2026-07-03', quantity: 5, warehouseId: 'wh-sales', unitPrice: 120 }],
  ...over,
});

const sale = (over: Partial<StockTransaction> = {}): StockTransaction => ({
  id: 's1', date: '2026-06-10T03:00:00.000Z', type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
  lotNo: '20260703', quantity: 10, note: '', fromWarehouseId: 'wh-sales',
  unitPrice: 180, customerId: 'cus-a', costUnitPrice: 120, taxRate: 8,
  ...over,
});

const salesReturn = (quantity: number, over: Partial<StockTransaction> = {}): StockTransaction => ({
  ...sale(), id: `r${quantity}`, date: '2026-06-12T03:00:00.000Z', type: '売上返品', quantity,
  fromWarehouseId: undefined, toWarehouseId: 'wh-sales', returnOfTxnId: 's1', ...over,
});

describe('返品の区分', () => {
  it('売上返品は入庫、仕入返品は出庫として扱う', () => {
    expect(transactionDirection('売上返品')).toBe('in');
    expect(transactionDirection('仕入返品')).toBe('out');
    expect(ALL_TRANSACTION_TYPES).toEqual(expect.arrayContaining(['売上返品', '仕入返品']));
  });

  it('手で選べる入庫・出庫区分には含めない (元取引にひもづける専用画面からだけ記録する)', () => {
    expect(INBOUND_TYPES).not.toContain('売上返品');
    expect(OUTBOUND_TYPES).not.toContain('仕入返品' as never);
  });

  it('消費税はマイナスでも同じ額のプラスとちょうど符号違いになる', () => {
    expect(taxAmount(-150, 10)).toBe(-15);
    expect(taxAmount(-25, 10)).toBe(-taxAmount(25, 10)); // 2.5 → 3 / -2.5 → -3
  });
});

describe('returnedQuantities / returnableSaleQuantity', () => {
  it('元取引ごとに返品数を合計し、残りだけ返品できる', () => {
    const ledger = [salesReturn(3), salesReturn(2, { id: 'r2b' }), sale()];
    expect(returnedQuantities(ledger).get('s1')).toBe(5);
    expect(returnableSaleQuantity(ledger, 's1')).toBe(5);
    expect(returnableSaleQuantity(ledger, 'missing')).toBe(0);
  });
});

describe('planSalesReturn', () => {
  it('同じロットNo・倉庫・賞味期限のロットがあればそこへ戻す', () => {
    const plan = planSalesReturn([product()], [sale()], { saleTxnId: 's1', quantity: 4, warehouseId: 'wh-sales' });
    expect(plan.error).toBe('');
    expect(plan.existingLot?.id).toBe('l1');
    expect(plan.quantity).toBe(4);
    expect(plan.amount).toBe(720);
    expect(plan.unitCost).toBe(120);
  });

  it('別の倉庫やロットが消えているときは、期限を引き継いだ新しいロットにする', () => {
    const toDefect = planSalesReturn([product()], [sale()], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-defect' });
    expect(toDefect.existingLot).toBeUndefined();
    expect(toDefect.expiryDate).toBe('2026-07-03');
    // ロットが全部なくなっていても、ロットNo (YYYYMMDD) から期限を復元する
    const gone = planSalesReturn([product({ lots: [] })], [sale()], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-sales' });
    expect(gone.expiryDate).toBe('2026-07-03');
    const odd = planSalesReturn([product({ lots: [] })], [sale({ lotNo: 'ABC' })], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-sales' });
    expect(odd.expiryDate).toBeUndefined();
  });

  it('返品できる数量を超えないよう丸め、できないときは理由を返す', () => {
    const ledger = [salesReturn(8), sale()];
    expect(planSalesReturn([product()], ledger, { saleTxnId: 's1', quantity: 5, warehouseId: 'wh-sales' }).quantity).toBe(2);
    expect(planSalesReturn([product()], [salesReturn(10), sale()], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-sales' }).error).toContain('すべて返品済み');
    expect(planSalesReturn([product()], [sale()], { saleTxnId: 's1', quantity: 0, warehouseId: 'wh-sales' }).error).toContain('数量');
    expect(planSalesReturn([product()], [sale()], { saleTxnId: 's1', quantity: 1, warehouseId: '' }).error).toContain('倉庫');
    expect(planSalesReturn([], [sale()], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-sales' }).error).toContain('削除');
    expect(planSalesReturn([product()], [], { saleTxnId: 's1', quantity: 1, warehouseId: 'wh-sales' }).error).toContain('見つかりません');
  });
});

describe('売上返品と集計', () => {
  const ledger = [salesReturn(3), sale()];

  it('salesRows は返品をマイナスの売上として並べる', () => {
    const rows = salesRows(ledger, [product()], CUSTOMERS);
    const ret = rows.find(r => r.isReturn)!;
    expect(ret).toMatchObject({ quantity: -3, amount: -540, tax: -43, cost: -360, profit: -180, returnOfTxnId: 's1', warehouseId: 'wh-sales' });
    expect(ret.profitRate).toBeCloseTo(1 / 3);
  });

  it('salesTotals は返品を差し引き、返品の件数と金額も返す', () => {
    const totals = salesTotals(salesRows(ledger, [product()], CUSTOMERS));
    expect(totals.quantity).toBe(7);
    expect(totals.amount).toBe(1260);
    expect(totals.tax).toBe(144 - 43);
    expect(totals.returnCount).toBe(1);
    expect(totals.returnAmount).toBe(540);
  });

  it('得意先の売上実績は返品を件数に数えず、金額だけ差し引く', () => {
    const usage = customerUsage(salesRows(ledger, [product()], CUSTOMERS)).get('cus-a')!;
    expect(usage.saleCount).toBe(1);
    expect(usage.amount).toBe(1260);
    expect(usage.lastSaleAt).toBe('2026-06-10T03:00:00.000Z');
  });

  it('請求書の候補では返品を別のマイナス行にし、納品書では載せない', () => {
    const sales = salesRows(ledger, [product()], CUSTOMERS);
    const lines = salesDocumentLines(sales, 'cus-a', '', '');
    expect(lines.map(l => [l.quantity, l.amount, l.isReturn])).toEqual([[10, 1800, false], [-3, -540, true]]);
    expect(salesDocumentTotals(lines).amountWithTax).toBe(1260 + Math.round(1260 * 0.08));
    expect(salesDocumentLines(sales, 'cus-a', '', '', new Map(), { includeReturns: false })).toHaveLength(1);
  });

  it('在庫分析の出庫数・売上数から返品を差し引き、仕入返品は数えない', () => {
    const today = new Date('2026-06-20T03:00:00.000Z');
    const purchaseReturn: StockTransaction = { ...sale(), id: 'pr', type: '仕入返品', quantity: 4, customerId: undefined, supplierId: 'sup-a' };
    const [row] = stockAnalysisRows([product()], [purchaseReturn, ...ledger], { days: 30, today });
    expect(row.outboundQuantity).toBe(7);
    expect(row.salesQuantity).toBe(7);
    // 返品の方が多くてもマイナスにはしない
    const [over] = stockAnalysisRows([product()], [salesReturn(10)], { days: 30, today });
    expect(over.outboundQuantity).toBe(0);
  });
});

describe('仕入返品の計画', () => {
  const inbound: StockTransaction = {
    id: 'in1', date: '2026-06-01T03:00:00.000Z', type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
    lotNo: '20260703', quantity: 5, note: '', toWarehouseId: 'wh-sales', unitPrice: 120, supplierId: 'sup-a',
  };

  it('初期値はそのロットを入荷したときの仕入先とロットの原価', () => {
    const p = product();
    expect(purchaseReturnDefaults(p, p.lots[0], [inbound])).toEqual({ supplierId: 'sup-a', inboundTxnId: 'in1', unitPrice: 120 });
    expect(purchaseReturnDefaults(p, p.lots[0], [])).toEqual({ supplierId: '', inboundTxnId: '', unitPrice: 120 });
  });

  it('数量はロットの在庫まで。仕入先は必須', () => {
    const base = { productId: 'p1', lotId: 'l1', quantity: 9, supplierId: 'sup-a', unitPrice: 120 };
    const plan = planPurchaseReturn([product()], SUPPLIERS, base);
    expect(plan.quantity).toBe(5);
    expect(plan.amount).toBe(600);
    expect(plan.error).toBe('');
    expect(planPurchaseReturn([product()], SUPPLIERS, { ...base, supplierId: '' }).error).toContain('仕入先');
    expect(planPurchaseReturn([product()], SUPPLIERS, { ...base, quantity: 0 }).error).toContain('数量');
    expect(planPurchaseReturn([product()], SUPPLIERS, { ...base, lotId: 'x' }).error).toContain('見つかりません');
  });
});

describe('useInventory — returnSale', () => {
  // サンプルの牛乳 (id '1') を12個売る → ロット l1 (10) と l2 (2) から出庫される
  const setup = () => {
    const hook = renderHook(() => useInventory());
    act(() => { hook.result.current.recordSale({ productId: '1', quantity: 12, unitPrice: 180, customerId: 'cus-midori' }); });
    return hook;
  };
  const milk = (r: { current: ReturnType<typeof useInventory> }) => r.current.products.find(p => p.id === '1')!;

  it('元のロットへ在庫を戻し、元の売上の条件を写した売上返品を1件記録する', () => {
    const { result } = setup();
    const saleRow = result.current.ledger.find(t => t.type === '売上出庫' && t.quantity === 2)!;
    const before = totalQuantity(milk(result));
    act(() => { result.current.returnSale({ saleTxnId: saleRow.id, quantity: 2, warehouseId: DEFAULT_WAREHOUSE_ID }); });

    expect(totalQuantity(milk(result))).toBe(before + 2);
    const lot = milk(result).lots.find(l => l.lotNo === saleRow.lotNo && l.warehouseId === DEFAULT_WAREHOUSE_ID)!;
    expect(lot.quantity).toBe(10); // 10 - 2 + 2
    const ret = result.current.ledger[0];
    expect(ret).toMatchObject({
      type: '売上返品', quantity: 2, lotNo: saleRow.lotNo, toWarehouseId: DEFAULT_WAREHOUSE_ID,
      unitPrice: 180, customerId: 'cus-midori', costUnitPrice: saleRow.costUnitPrice, taxRate: 8,
      returnOfTxnId: saleRow.id, note: '売上返品（みどりストア）',
    });
  });

  it('別の倉庫へ戻すと同じロットNoの新しいロットを作り、原価を引き継ぐ', () => {
    const { result } = setup();
    const saleRow = result.current.ledger.find(t => t.type === '売上出庫' && t.quantity === 10)!;
    act(() => { result.current.returnSale({ saleTxnId: saleRow.id, quantity: 3, warehouseId: 'wh-defect', note: '破損' }); });
    const lot = milk(result).lots.find(l => l.warehouseId === 'wh-defect')!;
    expect(lot).toMatchObject({ lotNo: saleRow.lotNo, quantity: 3, unitPrice: saleRow.costUnitPrice });
    expect(lot.expiryDate).toBeTruthy();
    expect(result.current.ledger[0].note).toBe('破損');
  });

  it('返品できる数量を超えては戻せない', () => {
    const { result } = setup();
    const saleRow = result.current.ledger.find(t => t.type === '売上出庫' && t.quantity === 2)!;
    act(() => { result.current.returnSale({ saleTxnId: saleRow.id, quantity: 2, warehouseId: DEFAULT_WAREHOUSE_ID }); });
    const ledgerLength = result.current.ledger.length;
    let again: ReturnType<typeof result.current.returnSale> = null;
    act(() => { again = result.current.returnSale({ saleTxnId: saleRow.id, quantity: 1, warehouseId: DEFAULT_WAREHOUSE_ID }); });
    expect(again).toBeNull();
    expect(result.current.ledger).toHaveLength(ledgerLength);
  });
});

describe('useInventory — returnToSupplier', () => {
  it('ロットの在庫を減らし、仕入先と返品単価つきの仕入返品を1件記録する', () => {
    const { result } = renderHook(() => useInventory());
    act(() => {
      result.current.returnToSupplier({ productId: '1', lotId: 'l1', quantity: 4, supplierId: 'sup-yamada', unitPrice: 118 });
    });
    const lot = result.current.products.find(p => p.id === '1')!.lots.find(l => l.id === 'l1')!;
    expect(lot.quantity).toBe(6);
    expect(result.current.ledger[0]).toMatchObject({
      type: '仕入返品', quantity: 4, fromWarehouseId: DEFAULT_WAREHOUSE_ID, supplierId: 'sup-yamada', unitPrice: 118,
      note: '仕入返品（山田乳業）',
    });
  });

  it('仕入先がないと返品しない', () => {
    const { result } = renderHook(() => useInventory());
    let plan: ReturnType<typeof result.current.returnToSupplier> = null;
    act(() => { plan = result.current.returnToSupplier({ productId: '1', lotId: 'l1', quantity: 1, supplierId: '', unitPrice: 0 }); });
    expect(plan).toBeNull();
    expect(result.current.ledger).toEqual([]);
  });

  it('入荷の記録があれば、それを元取引として記録する', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.products).toEqual([]));
    act(() => { result.current.resetToSample(); });
    const plan = result.current.inboundPlans.find(p => p.supplierId)!;
    let lotNo = '';
    act(() => { lotNo = result.current.receiveInboundPlan(plan.id, { quantity: 1 })!.lotNo; });
    const inboundTxn = result.current.ledger.find(t => t.type === '入荷')!;
    const lot = result.current.products.find(p => p.id === plan.productId)!.lots.find(l => l.lotNo === lotNo && l.warehouseId === plan.warehouseId)!;
    act(() => {
      result.current.returnToSupplier({ productId: plan.productId, lotId: lot.id, quantity: 1, supplierId: plan.supplierId, unitPrice: 0 });
    });
    expect(result.current.ledger[0]).toMatchObject({ type: '仕入返品', returnOfTxnId: inboundTxn.id });
    expect(result.current.ledger[0].unitPrice).toBeUndefined();
    await waitFor(() => expect(server.ledger[0]?.type).toBe('仕入返品'));
  });
});
