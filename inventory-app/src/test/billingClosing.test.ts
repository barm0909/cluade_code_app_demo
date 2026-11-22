import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  isClosingDate,
  latestClosingDate,
  latestClosingDateAmong,
  billingPeriod,
  paymentDueDate,
  closingDayLabel,
  paymentTermsLabel,
  customerBillingTermsLabel,
  normalizeCustomerInput,
  balanceForward,
  invoiceGrandTotal,
  closingCandidates,
  closingInvoiceInput,
  prepareSalesDocuments,
  draftSalesDocuments,
  salesDocuments,
  salesRows,
  EMPTY_CUSTOMER,
  EMPTY_SALES_DOCUMENT_ISSUER,
  SALE_NOTE,
} from '../useInventory';
import type { Customer, IssueSalesDocumentInput, PaymentItem, Product, SalesDocumentItem, StockTransaction } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

const customer = (over: Partial<Customer> & { id: string; name: string }): Customer => ({
  code: '', contact: '', phone: '', email: '', address: '', note: '', active: true,
  closingDay: 31, paymentMonths: 1, paymentDay: 31, ...over,
});

const CUSTOMERS: Customer[] = [
  customer({ id: 'cus-20', name: 'みどりストア', closingDay: 20, paymentMonths: 1, paymentDay: 10 }),
  customer({ id: 'cus-end', name: '北町給食センター', closingDay: 31 }),
  customer({ id: 'cus-once', name: 'さくらカフェ', closingDay: 0 }),
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 10, updatedAt: '', lots: [] },
];

// どのタイムゾーンでも同じローカル日付になるよう UTC の 03:00 にする
const sale = (id: string, customerId: string, day: string, quantity = 1, type: StockTransaction['type'] = '売上出庫'): StockTransaction => ({
  id, date: `${day}T03:00:00.000Z`, type, productId: 'p1', productName: '牛乳', productSku: 'ML-001',
  lotNo: 'L1', quantity, note: SALE_NOTE, unitPrice: 100, customerId, costUnitPrice: 50, taxRate: 10,
});

const payment = (over: Partial<PaymentItem> & { id: string }): PaymentItem => ({
  receiptId: over.id, customerId: 'cus-20', paymentDate: '2026-11-01', method: '振込',
  documentId: '', documentNo: '', amount: 0, fee: 0, note: '', createdAt: '2026-11-01T00:00:00.000Z', ...over,
});

const issue = (input: IssueSalesDocumentInput, existing: SalesDocumentItem[], payments: PaymentItem[] = []) =>
  prepareSalesDocuments([input], existing, payments, () => `doc-${existing.length}`, '2026-10-21T00:00:00.000Z');

describe('締め日・支払条件の日付計算', () => {
  it('締め日にあたるかを判定する (末日は月の最終日、都度請求は常に違う)', () => {
    expect(isClosingDate('2026-11-20', 20)).toBe(true);
    expect(isClosingDate('2026-11-21', 20)).toBe(false);
    expect(isClosingDate('2026-11-30', 31)).toBe(true);
    expect(isClosingDate('2026-02-28', 31)).toBe(true);
    expect(isClosingDate('2028-02-29', 31)).toBe(true);
    expect(isClosingDate('2028-02-28', 31)).toBe(false);
    expect(isClosingDate('2026-11-30', 0)).toBe(false);
  });

  it('今日以前で直近の締め日', () => {
    expect(latestClosingDate(20, '2026-11-22')).toBe('2026-11-20');
    expect(latestClosingDate(20, '2026-11-19')).toBe('2026-10-20');
    expect(latestClosingDate(31, '2026-11-22')).toBe('2026-10-31');
    expect(latestClosingDate(31, '2026-03-15')).toBe('2026-02-28');
    expect(latestClosingDate(31, '2026-01-10')).toBe('2025-12-31');
    expect(latestClosingDate(0, '2026-11-22')).toBe('');
    // 取引中の得意先の締め日のうち最も新しいもの
    expect(latestClosingDateAmong(CUSTOMERS, '2026-11-22')).toBe('2026-11-20');
    expect(latestClosingDateAmong([CUSTOMERS[2]], '2026-11-22')).toBe('');
  });

  it('対象期間は前月の締め日の翌日〜締め日', () => {
    expect(billingPeriod(20, '2026-11-20')).toEqual({ from: '2026-10-21', to: '2026-11-20' });
    expect(billingPeriod(20, '2026-01-20')).toEqual({ from: '2025-12-21', to: '2026-01-20' });
    expect(billingPeriod(31, '2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(billingPeriod(31, '2026-02-28')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('お支払期限は締め日の◯か月後の◯日 (末日・月の日数を超える日は月末)', () => {
    expect(paymentDueDate({ paymentMonths: 1, paymentDay: 10 }, '2026-11-20')).toBe('2026-12-10');
    expect(paymentDueDate({ paymentMonths: 1, paymentDay: 31 }, '2026-12-31')).toBe('2027-01-31');
    expect(paymentDueDate({ paymentMonths: 2, paymentDay: 31 }, '2026-12-31')).toBe('2027-02-28');
    expect(paymentDueDate({ paymentMonths: 0, paymentDay: 31 }, '2026-11-20')).toBe('2026-11-30');
    // 未設定は翌月末
    expect(paymentDueDate({}, '2026-11-30')).toBe('2026-12-31');
  });

  it('表示用のラベル', () => {
    expect(closingDayLabel(20)).toBe('20日締め');
    expect(closingDayLabel(31)).toBe('末日締め');
    expect(closingDayLabel(0)).toBe('都度請求');
    expect(paymentTermsLabel(2, 10)).toBe('翌々月10日払い');
    expect(customerBillingTermsLabel(CUSTOMERS[0])).toBe('20日締め・翌月10日払い');
    expect(customerBillingTermsLabel({})).toBe('末日締め・翌月末払い');
  });

  it('得意先の入力を整えるとき、未設定・不正な値は「末日締め・翌月末払い」にする', () => {
    const { closingDay: _c, paymentMonths: _m, paymentDay: _d, ...legacy } = EMPTY_CUSTOMER;
    expect(normalizeCustomerInput({ ...legacy, name: 'A' })).toMatchObject({ closingDay: 31, paymentMonths: 1, paymentDay: 31 });
    expect(normalizeCustomerInput({ ...EMPTY_CUSTOMER, name: 'A', closingDay: 7 as never, paymentMonths: 5 as never, paymentDay: 1 as never }))
      .toMatchObject({ closingDay: 31, paymentMonths: 1, paymentDay: 31 });
    expect(normalizeCustomerInput({ ...EMPTY_CUSTOMER, name: 'A', closingDay: 0, paymentMonths: 2, paymentDay: 10 }))
      .toMatchObject({ closingDay: 0, paymentMonths: 2, paymentDay: 10 });
  });
});

describe('closingCandidates', () => {
  const LEDGER = [
    sale('t-old', 'cus-20', '2026-10-05', 2), // 前回 (10/20 締め) の期間で請求漏れ
    sale('t1', 'cus-20', '2026-11-01', 3),
    sale('t2', 'cus-20', '2026-11-20', 1),
    sale('t-next', 'cus-20', '2026-11-21', 9), // 締め日より後は次回
    sale('t-ret', 'cus-20', '2026-11-10', 1, '売上返品'),
    sale('t-end', 'cus-end', '2026-11-15', 4),
    sale('t-once', 'cus-once', '2026-11-15', 4),
  ];
  const SALES = salesRows(LEDGER, PRODUCTS, CUSTOMERS);

  it('締め日にあたる得意先だけを、締め日までの未請求の売上 (前回以前の請求漏れと返品を含む) で組み立てる', () => {
    const list = closingCandidates('2026-11-20', CUSTOMERS, SALES, [], [], '2026-11-21');
    expect(list.map(c => c.customer.id)).toEqual(['cus-20']); // 末日締め・都度請求は対象外
    const c = list[0];
    expect([c.periodFrom, c.periodTo, c.dueDate]).toEqual(['2026-10-21', '2026-11-20', '2026-12-10']);
    expect(c.lines.flatMap(l => l.txnIds).sort()).toEqual(['t-old', 't-ret', 't1', 't2']);
    expect(c.earlierLines).toBe(1);
    // (2 + 3 + 1 - 1) × 100 = 500、消費税 50
    expect(c.totals.amountWithTax).toBe(550);
    expect(c.balance).toEqual({ previousBilled: 0, received: 0, carryOver: 0 });
    expect(c.grandTotal).toBe(550);
    expect(c.issuedNo).toBe('');
  });

  it('すでに請求書に載った売上は除き、同じ締め日の請求書があれば書類番号を返す', () => {
    const first = closingCandidates('2026-11-20', CUSTOMERS, SALES, [], [], '2026-11-21')[0];
    const { created } = issue(closingInvoiceInput(first, '2026-11-21', EMPTY_SALES_DOCUMENT_ISSUER), []);
    const again = closingCandidates('2026-11-20', CUSTOMERS, SALES, created, [], '2026-11-21')[0];
    expect(again.lines).toEqual([]);
    expect(again.issuedNo).toBe('I20261121-001');
    // 繰越は前回 (いま発行した請求書) の残高
    expect(again.balance.carryOver).toBe(550);
  });

  it('取引停止の得意先は、請求する売上か繰越があるときだけ出す', () => {
    const inactive = [customer({ id: 'cus-x', name: '休止中', closingDay: 20, active: false })];
    expect(closingCandidates('2026-11-20', inactive, [], [], [], '2026-11-21')).toEqual([]);
    const withSale = salesRows([sale('tx', 'cus-x', '2026-11-01')], PRODUCTS, inactive);
    expect(closingCandidates('2026-11-20', inactive, withSale, [], [], '2026-11-21')).toHaveLength(1);
  });
});

describe('balanceForward', () => {
  // 10/20 締めの請求書 (税込 1100、発行 10/21)
  const prevInput: IssueSalesDocumentInput = {
    kind: '請求書', issueDate: '2026-10-21', customer: CUSTOMERS[0], periodFrom: '2026-09-21', periodTo: '2026-10-20',
    dueDate: '2026-11-10', issuer: EMPTY_SALES_DOCUMENT_ISSUER,
    lines: [{ key: 'k', deliveryDate: '2026-10-01', productId: 'p1', productName: '牛乳', productSku: 'ML-001', quantity: 10, unitPrice: 100, amount: 1000, taxRate: 10, txnIds: ['a'], estimatedPrice: false, issuedNo: '', isReturn: false }],
  };
  const prev = issue(prevInput, []).created;
  const docId = prev[0].documentId;

  it('前回の請求書がなければすべて0 (前受があれば繰越はマイナス)', () => {
    expect(balanceForward('cus-20', [], [], '2026-11-21')).toEqual({ previousBilled: 0, received: 0, carryOver: 0 });
    expect(balanceForward('cus-20', [], [payment({ id: 'r', amount: 300 })], '2026-11-21'))
      .toEqual({ previousBilled: 0, received: 300, carryOver: -300 });
  });

  it('繰越額 = 前回までの請求書の残高 − 未消込入金、御入金額 = 前回の発行日より後の入金', () => {
    const payments = [
      payment({ id: 'r1', documentId: docId, amount: 700, fee: 100, paymentDate: '2026-11-05' }),
      payment({ id: 'r2', amount: 50, paymentDate: '2026-11-06' }), // 未消込
      payment({ id: 'r3', documentId: docId, amount: 100, paymentDate: '2026-12-01' }), // 発行日より後 (今回は数えない)
    ];
    const b = balanceForward('cus-20', prev, payments, '2026-11-21');
    // 残高 1100 - 800 - 100 = 200、未消込 50 → 繰越 150。入金は 800 + 50 = 850 → 前回 1000 ... と逆算
    expect(b).toEqual({ carryOver: 150, received: 850, previousBilled: 1000 });
    // 他の得意先の請求書・入金は数えない
    expect(balanceForward('cus-end', prev, payments, '2026-11-21')).toEqual({ previousBilled: 0, received: 0, carryOver: 0 });
  });
});

describe('prepareSalesDocuments / draftSalesDocuments', () => {
  const SALES = salesRows([sale('t1', 'cus-20', '2026-11-01'), sale('t2', 'cus-end', '2026-11-30', 2)], PRODUCTS, CUSTOMERS);
  const inputs = () => [
    closingInvoiceInput(closingCandidates('2026-11-20', CUSTOMERS, SALES, [], [], '2026-12-01')[0], '2026-12-01', EMPTY_SALES_DOCUMENT_ISSUER),
    closingInvoiceInput(closingCandidates('2026-11-30', CUSTOMERS, SALES, [], [], '2026-12-01')[0], '2026-12-01', EMPTY_SALES_DOCUMENT_ISSUER),
  ];

  it('まとめて発行すると続き番号になり、プレビューと番号・金額が一致する', () => {
    let n = 0;
    const { created, docs } = prepareSalesDocuments(inputs(), [], [], () => `d${++n}`, '2026-12-01T00:00:00.000Z');
    expect(docs.map(d => [d.documentNo, d.customerName, d.totals.amountWithTax])).toEqual([
      ['I20261201-001', 'みどりストア', 110],
      ['I20261201-002', '北町給食センター', 220],
    ]);
    expect(salesDocuments(created)).toHaveLength(2);
    const drafts = draftSalesDocuments(inputs(), []);
    expect(drafts.map(d => [d.documentNo, d.totals.amountWithTax])).toEqual(docs.map(d => [d.documentNo, d.totals.amountWithTax]));
    // 繰越型として保存され、再表示でも繰越欄を出せる
    expect(docs[0].balanceForward).toEqual({ previousBilled: 0, received: 0, carryOver: 0 });
    expect(created.every(i => i.balanceForward)).toBe(true);
  });

  it('同じ呼び出しの中でも同じ売上を二度載せず、載せられない書類は飛ばす', () => {
    const [a] = inputs();
    let n = 0;
    const { docs } = prepareSalesDocuments([a, a], [], [], () => `d${++n}`, '');
    expect(docs).toHaveLength(1);
  });

  it('繰越は保存する時点の請求書・入金で計算し直す (プレビューの値が古くても)', () => {
    const [a] = inputs();
    const stale = { ...a, balanceForward: { previousBilled: 9, received: 9, carryOver: 9 } };
    const earlier = prepareSalesDocuments([{ ...a, lines: [{ ...a.lines[0], txnIds: ['other'] }] }], [], [], () => 'old', '').created;
    const { docs } = prepareSalesDocuments([stale], earlier, [], () => 'new', '');
    expect(docs[0].balanceForward).toEqual({ previousBilled: 110, received: 0, carryOver: 110 });
    expect(invoiceGrandTotal(docs[0])).toBe(220);
  });

  it('繰越を指定しない請求書 (この機能より前の形) と納品書は繰越を持たない', () => {
    const [a] = inputs();
    const { balanceForward: _b, ...plain } = a;
    expect(prepareSalesDocuments([plain], [], [], () => 'x', '').docs[0].balanceForward).toBeUndefined();
    expect(prepareSalesDocuments([{ ...a, kind: '納品書' }], [], [], () => 'y', '').docs[0].balanceForward).toBeUndefined();
  });
});

describe('useInventory — 締め請求', () => {
  it('issueSalesDocuments は複数の請求書を1回で保存し、締め日・支払条件と繰越を読み込み時に復元する', async () => {
    const server = stubApi({ customers: CUSTOMERS, products: PRODUCTS, ledger: [sale('t1', 'cus-20', '2026-11-01'), sale('t2', 'cus-end', '2026-11-30')] });
    const first = renderHook(() => useInventory());
    await waitFor(() => expect(first.result.current.ledger).toHaveLength(2));
    expect(first.result.current.customers.find(c => c.id === 'cus-20')).toMatchObject({ closingDay: 20, paymentDay: 10 });

    const r = first.result.current;
    const sales = salesRows(r.ledger, r.products, r.customers);
    const inputs = ['2026-11-20', '2026-11-30'].map(date =>
      closingInvoiceInput(closingCandidates(date, r.customers, sales, [], [], '2026-12-01')[0], '2026-12-01', EMPTY_SALES_DOCUMENT_ISSUER));
    let docs: ReturnType<typeof r.issueSalesDocuments> = [];
    act(() => { docs = first.result.current.issueSalesDocuments(inputs); });
    expect(docs.map(d => d.documentNo)).toEqual(['I20261201-001', 'I20261201-002']);
    await waitFor(() => expect(server.salesDocumentItems).toHaveLength(2));

    const second = renderHook(() => useInventory());
    await waitFor(() => expect(second.result.current.salesDocumentItems).toHaveLength(2));
    expect(second.result.current.salesDocumentItems.every(i => i.balanceForward)).toBe(true);
  });

  it('締め日・支払条件のない得意先 (導入前のデータ) は末日締め・翌月末払いとして読み込む', async () => {
    const legacy = { id: 'old', name: '旧得意先', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true };
    stubApi({ customers: [legacy] });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.customers[0]).toMatchObject({ id: 'old', closingDay: 31, paymentMonths: 1, paymentDay: 31 }));
  });
});
