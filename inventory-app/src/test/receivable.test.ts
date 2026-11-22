import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  receivableRows,
  invoicePaymentStatus,
  filterReceivables,
  customerReceivables,
  receivableTotals,
  planPayment,
  buildPaymentItems,
  paymentValidationError,
  paymentReceipts,
  paidDocumentIds,
  receivableCsv,
  customerReceivableCsv,
  paymentCsv,
  salesRows,
  salesDocumentLines,
  issuedSalesDocumentNos,
  DEFAULT_RECEIVABLE_FILTER,
  EMPTY_SALES_DOCUMENT_ISSUER,
  SALE_NOTE,
} from '../useInventory';
import type { Customer, PaymentInput, PaymentItem, Product, SalesDocumentItem, StockTransaction, TaxRate } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const TODAY = '2026-08-15';

/** 請求書 (1明細) を直接作る。amount は税抜、billed は amount + 消費税 */
const invoice = (
  documentId: string,
  over: Partial<SalesDocumentItem> & { amount?: number; taxRate?: TaxRate } = {},
): SalesDocumentItem => ({
  id: `${documentId}-1`,
  documentId,
  kind: '請求書',
  documentNo: `I-${documentId}`,
  issuedAt: '2026-07-01T00:00:00.000Z',
  issueDate: '2026-07-01',
  customerId: 'cus-a',
  customerName: 'みどりストア',
  customerAddress: '',
  customerContact: '',
  periodFrom: '2026-06-01',
  periodTo: '2026-06-30',
  dueDate: '2026-07-31',
  issuerName: '', issuerAddress: '', issuerPhone: '', issuerContact: '', issuerRegistrationNo: '', issuerBankAccount: '',
  lineNo: 1,
  deliveryDate: '2026-06-10',
  productName: '牛乳',
  productSku: 'ML-001',
  quantity: 1,
  unitPrice: over.amount ?? 1000,
  amount: 1000,
  taxRate: 10,
  txnIds: [],
  ...over,
});

const payment = (over: Partial<PaymentItem> & { id: string }): PaymentItem => ({
  receiptId: over.id,
  customerId: 'cus-a',
  paymentDate: '2026-08-01',
  method: '振込',
  documentId: '',
  documentNo: '',
  amount: 0,
  fee: 0,
  note: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

// inv1: 期限 7/31 (超過), 1100 / inv2: 期限 8/31, 2200 / inv3: 期限なし, 550 / 別得意先 inv4
const ITEMS: SalesDocumentItem[] = [
  invoice('inv2', { dueDate: '2026-08-31', amount: 2000, unitPrice: 2000 }),
  invoice('inv1'),
  invoice('inv3', { dueDate: '', amount: 500, unitPrice: 500 }),
  invoice('inv4', { customerId: 'cus-b', customerName: 'さくらカフェ', dueDate: '2026-07-20' }),
  // 納品書は請求ではないので対象外
  invoice('dn1', { kind: '納品書', documentNo: 'D-dn1', dueDate: '' }),
];

const paymentInput = (over: Partial<PaymentInput> = {}): PaymentInput => ({
  customerId: 'cus-a',
  paymentDate: TODAY,
  method: '振込',
  amount: 1000,
  fee: 0,
  documentIds: ['inv1', 'inv2', 'inv3'],
  note: '',
  ...over,
});

describe('receivableRows', () => {
  it('請求書ごとに請求額・消込額・残高・状況を出し、納品書は含めない', () => {
    const rows = receivableRows(ITEMS, [
      payment({ id: 'r1', documentId: 'inv1', documentNo: 'I-inv1', amount: 1100, paymentDate: '2026-07-30' }),
      payment({ id: 'r2', documentId: 'inv2', documentNo: 'I-inv2', amount: 1000, fee: 200, paymentDate: '2026-08-10' }),
      payment({ id: 'r3', amount: 999 }), // 未消込は請求書の残高に影響しない
    ], TODAY);
    expect(rows.map(r => r.documentId)).toEqual(['inv4', 'inv1', 'inv2', 'inv3']); // 期限の早い順、期限なしは最後
    const byId = new Map(rows.map(r => [r.documentId, r]));
    expect(byId.get('inv1')).toMatchObject({ billed: 1100, paid: 1100, remaining: 0, status: '入金済', overdueDays: 0, lastPaymentDate: '2026-07-30' });
    expect(byId.get('inv2')).toMatchObject({ billed: 2200, paid: 1200, remaining: 1000, status: '一部入金', overdueDays: 0 });
    expect(byId.get('inv3')).toMatchObject({ billed: 550, paid: 0, status: '未入金', overdueDays: 0 });
    expect(byId.get('inv4')).toMatchObject({ remaining: 1100, status: '未入金', overdueDays: 26 });
  });

  it('お支払期限を過ぎて残高のある請求書だけを期限超過にする', () => {
    const rows = receivableRows([invoice('inv1')], [], '2026-08-01');
    expect(rows[0].overdueDays).toBe(1);
    expect(receivableRows([invoice('inv1')], [], '2026-07-31')[0].overdueDays).toBe(0);
  });

  it('請求額が 0 以下 (返品だけの請求書) は回収するものがないので入金済', () => {
    expect(invoicePaymentStatus(0, 0)).toBe('入金済');
    expect(invoicePaymentStatus(-500, 0)).toBe('入金済');
    expect(invoicePaymentStatus(1000, 0)).toBe('未入金');
    expect(invoicePaymentStatus(1000, 1)).toBe('一部入金');
  });

  it('入金が充てられている請求書の id (取消できないもの)', () => {
    expect([...paidDocumentIds([payment({ id: 'r1', documentId: 'inv1', amount: 1 }), payment({ id: 'r2', amount: 1 })])]).toEqual(['inv1']);
  });
});

describe('filterReceivables', () => {
  const rows = receivableRows(ITEMS, [payment({ id: 'r1', documentId: 'inv1', amount: 1100 })], TODAY);

  it('既定は未回収 (未入金・一部入金) だけ', () => {
    expect(filterReceivables(rows, DEFAULT_RECEIVABLE_FILTER).map(r => r.documentId)).toEqual(['inv4', 'inv2', 'inv3']);
  });

  it('状況・得意先・キーワードで絞り込める', () => {
    const f = { ...DEFAULT_RECEIVABLE_FILTER };
    expect(filterReceivables(rows, { ...f, status: '入金済' }).map(r => r.documentId)).toEqual(['inv1']);
    expect(filterReceivables(rows, { ...f, status: '期限超過' }).map(r => r.documentId)).toEqual(['inv4']);
    expect(filterReceivables(rows, { ...f, status: '' })).toHaveLength(4);
    expect(filterReceivables(rows, { ...f, status: '', customerId: 'cus-b' }).map(r => r.documentId)).toEqual(['inv4']);
    expect(filterReceivables(rows, { ...f, status: '', keyword: 'さくら' }).map(r => r.documentId)).toEqual(['inv4']);
    expect(filterReceivables(rows, { ...f, status: '', keyword: 'i-inv3' }).map(r => r.documentId)).toEqual(['inv3']);
  });
});

describe('paymentValidationError', () => {
  it('得意先・入金日・入金額 (1円以上の整数)・手数料 (0円以上の整数) を求める', () => {
    expect(paymentValidationError(paymentInput())).toBe('');
    expect(paymentValidationError(paymentInput({ customerId: '' }))).toBe('得意先を選んでください');
    expect(paymentValidationError(paymentInput({ paymentDate: '' }))).toBe('入金日を入力してください');
    expect(paymentValidationError(paymentInput({ amount: 0 }))).toMatch(/入金額/);
    expect(paymentValidationError(paymentInput({ amount: 10.5 }))).toMatch(/入金額/);
    expect(paymentValidationError(paymentInput({ fee: -1 }))).toMatch(/振込手数料/);
  });
});

describe('planPayment', () => {
  const rows = receivableRows(ITEMS, [], TODAY);

  it('選んだ請求書へお支払期限の早い順に残高いっぱいまで充てる', () => {
    const plan = planPayment(rows, paymentInput({ amount: 2000 }));
    expect(plan.error).toBe('');
    expect(plan.allocations.map(a => [a.documentId, a.applied, a.remainingAfter])).toEqual([
      ['inv1', 1100, 0],
      ['inv2', 900, 1300],
    ]);
    expect(plan.unappliedAmount).toBe(0);
  });

  it('選ばなかった請求書・他の得意先の請求書には充てない', () => {
    const plan = planPayment(rows, paymentInput({ amount: 600, documentIds: ['inv3', 'inv4'] }));
    expect(plan.allocations.map(a => [a.documentId, a.applied])).toEqual([['inv3', 550]]);
    expect(plan.unappliedAmount).toBe(50);
  });

  it('充てきれない分は未消込として残す', () => {
    const plan = planPayment(rows, paymentInput({ amount: 5000 }));
    expect(plan.allocations.reduce((s, a) => s + a.applied, 0)).toBe(3850);
    expect(plan.unappliedAmount).toBe(1150);
    expect(plan.unappliedFee).toBe(0);
  });

  it('振込手数料は入金と合わせて消込に充て、先に充てた請求書から割り当てる', () => {
    const plan = planPayment(rows, paymentInput({ amount: 1100 - 440 + 2200, fee: 440 }));
    expect(plan.allocations.map(a => [a.documentId, a.amount, a.fee, a.applied])).toEqual([
      ['inv1', 660, 440, 1100],
      ['inv2', 2200, 0, 2200],
    ]);
    expect(plan.total).toBe(3300);
  });

  it('請求書を選ばなければ全額 (手数料も) 未消込', () => {
    const plan = planPayment(rows, paymentInput({ amount: 1000, fee: 100, documentIds: [] }));
    expect(plan.allocations).toEqual([]);
    expect([plan.unappliedAmount, plan.unappliedFee]).toEqual([1000, 100]);
  });

  it('入力に誤りがあれば何も充てない', () => {
    const plan = planPayment(rows, paymentInput({ customerId: '' }));
    expect(plan.error).toBe('得意先を選んでください');
    expect(plan.allocations).toEqual([]);
  });
});

describe('buildPaymentItems / paymentReceipts', () => {
  const rows = receivableRows(ITEMS, [], TODAY);

  it('充てた請求書ごとに1行、未消込があれば最後に請求書なしの1行を作る', () => {
    const input = paymentInput({ amount: 1500, fee: 100, documentIds: ['inv1'], note: ' 7月分 ' });
    const items = buildPaymentItems(planPayment(rows, input), input, 'rc1', '2026-08-15T00:00:00.000Z');
    expect(items).toEqual([
      expect.objectContaining({ id: 'rc1-1', receiptId: 'rc1', documentId: 'inv1', documentNo: 'I-inv1', amount: 1000, fee: 100, note: '7月分' }),
      expect.objectContaining({ id: 'rc1-2', receiptId: 'rc1', documentId: '', documentNo: '', amount: 500, fee: 0 }),
    ]);
    // 消込額の合計 = 入金額 + 手数料
    expect(items.reduce((s, i) => s + i.amount + i.fee, 0)).toBe(1600);
    expect(items.reduce((s, i) => s + i.amount, 0)).toBe(1500);
  });

  it('1回の入金にまとめ直し、入金日の新しい順に並べて絞り込める', () => {
    const input = paymentInput({ amount: 1500, documentIds: ['inv1'] });
    const payments = [
      ...buildPaymentItems(planPayment(rows, input), input, 'rc1', '2026-08-15T00:00:00.000Z'),
      payment({ id: 'old', customerId: 'cus-b', paymentDate: '2026-07-01', amount: 300, note: '前受' }),
    ];
    const receipts = paymentReceipts(payments, CUSTOMERS);
    expect(receipts.map(r => r.receiptId)).toEqual(['rc1', 'old']);
    expect(receipts[0]).toMatchObject({
      customerName: 'みどりストア', amount: 1500, fee: 0, unapplied: 400,
      applied: [{ documentId: 'inv1', documentNo: 'I-inv1', amount: 1100 }],
    });
    expect(paymentReceipts(payments, CUSTOMERS, { keyword: 'I-INV1', customerId: '', from: '', to: '' }).map(r => r.receiptId)).toEqual(['rc1']);
    expect(paymentReceipts(payments, CUSTOMERS, { keyword: '前受', customerId: '', from: '', to: '' }).map(r => r.receiptId)).toEqual(['old']);
    expect(paymentReceipts(payments, CUSTOMERS, { keyword: '', customerId: 'cus-b', from: '', to: '' }).map(r => r.receiptId)).toEqual(['old']);
    expect(paymentReceipts(payments, CUSTOMERS, { keyword: '', customerId: '', from: '2026-08-01', to: '' }).map(r => r.receiptId)).toEqual(['rc1']);
  });
});

describe('customerReceivables / receivableTotals', () => {
  const PRODUCTS: Product[] = [
    { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 8, updatedAt: '', lots: [] },
  ];
  const sale = (id: string, customerId: string | undefined, quantity: number): StockTransaction => ({
    id, date: '2026-08-10T03:00:00.000Z', type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
    lotNo: 'L1', quantity, note: SALE_NOTE, unitPrice: 100, customerId, costUnitPrice: 50, taxRate: 8,
  });
  const LEDGER = [sale('s1', 'cus-a', 10), sale('s2', 'cus-a', 5), sale('s3', undefined, 99), sale('s4', 'cus-b', 1)];
  const SALES = salesRows(LEDGER, PRODUCTS, CUSTOMERS);
  // s1 は請求済み (inv1 の明細に載っている)
  const items = ITEMS.map(i => i.documentId === 'inv1' ? { ...i, txnIds: ['s1'] } : i);
  const payments = [
    payment({ id: 'r1', documentId: 'inv2', documentNo: 'I-inv2', amount: 200, paymentDate: '2026-08-05' }),
    payment({ id: 'r2', amount: 300, paymentDate: '2026-07-20' }), // 未消込
  ];
  const rows = receivableRows(items, payments, TODAY);

  it('請求残高 + 未請求売上 − 未消込入金 を得意先ごとに出す (得意先なしの売上は除く)', () => {
    const list = customerReceivables(rows, SALES, items, payments, CUSTOMERS);
    expect(list.map(c => c.customerId)).toEqual(['cus-a', 'cus-b']);
    expect(list[0]).toMatchObject({
      customerName: 'みどりストア',
      invoiceBalance: 1100 + 2000 + 550, // inv1 + (2200 - 200) + inv3
      overdue: 1100, // inv1 (期限 7/31)
      openInvoices: 3,
      unbilled: 540, // s2: 500 + 消費税 40 (s1 は請求済み)
      unapplied: 300,
      balance: 3650 + 540 - 300,
      lastPaymentDate: '2026-08-05',
    });
    expect(list[1]).toMatchObject({ invoiceBalance: 1100, overdue: 1100, unbilled: 108, balance: 1208 });
  });

  it('何も残っていない得意先は出さない', () => {
    const paid = [payment({ id: 'x', customerId: 'cus-b', documentId: 'inv4', amount: 1100 })];
    const list = customerReceivables(receivableRows([invoice('inv4', { customerId: 'cus-b' })], paid, TODAY), [], [], paid, CUSTOMERS);
    expect(list).toEqual([]);
  });

  it('合計と今月の入金額 (手数料は含めない)', () => {
    const list = customerReceivables(rows, SALES, items, payments, CUSTOMERS);
    const totals = receivableTotals(rows, list, [...payments, payment({ id: 'r3', documentId: 'inv3', amount: 100, fee: 50, paymentDate: '2026-08-14' })], TODAY);
    expect(totals).toMatchObject({
      invoiceBalance: 3650 + 1100,
      openInvoices: 4,
      overdue: 2200,
      overdueInvoices: 2,
      unbilled: 648,
      unapplied: 300,
      balance: 3890 + 1208,
      receivedThisMonth: 300, // 8/5 の 200 + 8/14 の 100 (7月の入金と手数料は含めない)
    });
  });

  it('CSV', () => {
    const list = customerReceivables(rows, SALES, items, payments, CUSTOMERS);
    expect(customerReceivableCsv(list).split('\n')[1]).toBe('みどりストア,3650,1100,3,540,300,3890,2026-08-05');
    const inv = receivableCsv(rows).split('\n');
    expect(inv[0]).toBe('請求書番号,得意先,発行日,お支払期限,請求額（税込）,入金済額,残高,入金状況,期限超過日数,最終入金日');
    expect(inv).toContain('I-inv2,みどりストア,2026-07-01,2026-08-31,2200,200,2000,一部入金,0,2026-08-05');
    const pay = paymentCsv(paymentReceipts(payments, CUSTOMERS)).split('\n');
    expect(pay.slice(1)).toEqual([
      '2026-08-05,みどりストア,振込,I-inv2,200,0,200,',
      '2026-07-20,みどりストア,振込,未消込,300,0,300,',
    ]);
  });
});

describe('useInventory — recordPayment / deletePayment', () => {
  const today = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // サンプルの牛乳を みどりストア に 3個 (税抜 180円) 売って請求書を発行する
  const issueInvoice = (result: { current: ReturnType<typeof useInventory> }) => {
    act(() => { result.current.recordSale({ productId: '1', quantity: 3, unitPrice: 180, customerId: 'cus-midori' }); });
    const sales = salesRows(result.current.ledger, result.current.products, result.current.customers);
    const customer = result.current.customers.find(c => c.id === 'cus-midori')!;
    let documentId = '';
    act(() => {
      const doc = result.current.issueSalesDocument({
        kind: '請求書', issueDate: today(), customer, periodFrom: today(), periodTo: today(), dueDate: today(),
        issuer: EMPTY_SALES_DOCUMENT_ISSUER,
        lines: salesDocumentLines(sales, 'cus-midori', today(), today(), issuedSalesDocumentNos(result.current.salesDocumentItems, '請求書')),
      });
      documentId = doc!.documentId;
    });
    return documentId; // 請求額 540 + 消費税 43 = 583
  };
  const input = (documentId: string, amount: number): PaymentInput => ({
    customerId: 'cus-midori', paymentDate: today(), method: '振込', amount, fee: 0, documentIds: [documentId], note: '',
  });

  it('入金を請求書に充てて残高を減らし、在庫と帳票は動かさない', () => {
    const { result } = renderHook(() => useInventory());
    const documentId = issueInvoice(result);
    const ledgerBefore = result.current.ledger.length;
    const stockBefore = JSON.stringify(result.current.products);
    let plan: ReturnType<typeof result.current.recordPayment> = null;
    act(() => { plan = result.current.recordPayment(input(documentId, 500)); });
    expect(plan!.allocations[0]).toMatchObject({ documentId, applied: 500, remainingAfter: 83 });
    const row = receivableRows(result.current.salesDocumentItems, result.current.paymentItems)[0];
    expect(row).toMatchObject({ billed: 583, paid: 500, remaining: 83, status: '一部入金' });
    expect(result.current.ledger).toHaveLength(ledgerBefore);
    expect(JSON.stringify(result.current.products)).toBe(stockBefore);
  });

  it('保存直前の残高で充て直すので、二重に登録しても請求額を超えて消し込まない', () => {
    const { result } = renderHook(() => useInventory());
    const documentId = issueInvoice(result);
    act(() => { result.current.recordPayment(input(documentId, 583)); });
    let second: ReturnType<typeof result.current.recordPayment> = null;
    act(() => { second = result.current.recordPayment(input(documentId, 583)); });
    expect(second!.allocations).toEqual([]);
    expect(second!.unappliedAmount).toBe(583);
    expect(receivableRows(result.current.salesDocumentItems, result.current.paymentItems)[0].remaining).toBe(0);
  });

  it('入力に誤りがあれば登録しない', () => {
    const { result } = renderHook(() => useInventory());
    const documentId = issueInvoice(result);
    let plan: ReturnType<typeof result.current.recordPayment> = null;
    act(() => { plan = result.current.recordPayment(input(documentId, 0)); });
    expect(plan).toBeNull();
    expect(result.current.paymentItems).toEqual([]);
  });

  it('入金のある請求書は取り消せず、入金を削除すると取り消せる', () => {
    const { result } = renderHook(() => useInventory());
    const documentId = issueInvoice(result);
    act(() => { result.current.recordPayment(input(documentId, 100)); });
    let ok: boolean | undefined;
    act(() => { ok = result.current.deleteSalesDocument(documentId); });
    expect(ok).toBe(false);
    expect(result.current.salesDocumentItems).not.toEqual([]);

    const receiptId = result.current.paymentItems[0].receiptId;
    act(() => { result.current.deletePayment(receiptId); });
    expect(result.current.paymentItems).toEqual([]);
    expect(receivableRows(result.current.salesDocumentItems, result.current.paymentItems)[0].remaining).toBe(583);
    act(() => { ok = result.current.deleteSalesDocument(documentId); });
    expect(ok).toBe(true);
    expect(result.current.salesDocumentItems).toEqual([]);
  });

  it('入金の記録がある得意先は削除できない', () => {
    const { result } = renderHook(() => useInventory());
    // 売上のない得意先 (北町給食センター) に未消込の入金 (前受) だけ登録する
    act(() => { result.current.recordPayment({ ...input('', 1000), customerId: 'cus-kita', documentIds: [] }); });
    act(() => { result.current.deleteCustomer('cus-kita'); });
    expect(result.current.customers.some(c => c.id === 'cus-kita')).toBe(true);
  });

  it('リセットすると入金も空になる', () => {
    const { result } = renderHook(() => useInventory());
    const documentId = issueInvoice(result);
    act(() => { result.current.recordPayment(input(documentId, 100)); });
    act(() => { result.current.resetToSample(); });
    expect(result.current.paymentItems).toEqual([]);
  });

  it('入金を API に保存し、読み込み時に復元する', async () => {
    const saved = [payment({ id: 'r1', documentId: 'inv1', documentNo: 'I-inv1', amount: 1100 })];
    const server = stubApi({ salesDocumentItems: [invoice('inv1')], paymentItems: saved });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.paymentItems).toEqual(saved));
    act(() => { result.current.deletePayment('r1'); });
    await waitFor(() => expect(server.paymentItems).toEqual([]));
  });
});
