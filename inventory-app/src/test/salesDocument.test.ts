import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  salesRows,
  salesTotals,
  salesDocumentLines,
  salesDocumentTotals,
  issuedSalesDocumentNos,
  nextSalesDocumentNo,
  previousMonthRange,
  nextMonthEnd,
  isValidRegistrationNo,
  salesDocumentValidationError,
  buildSalesDocumentItems,
  draftSalesDocument,
  salesDocuments,
  salesDocumentCsv,
  EMPTY_SALES_DOCUMENT_ISSUER,
  SALE_NOTE,
} from '../useInventory';
import type { Customer, IssueSalesDocumentInput, Product, SalesDocumentItem, StockTransaction } from '../useInventory';
import { stubApi } from './mockApi';

afterEach(() => { vi.unstubAllGlobals(); });

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: 'C-001', contact: '緑川', phone: '', email: '', address: '東京都世田谷区', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: 'C-002', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 8, updatedAt: '', lots: [] },
  { id: 'p2', name: '値札ラベル', sku: 'LB-001', categoryId: 'c', minQuantity: 0, price: 5, costPrice: 2, taxRate: 10, updatedAt: '', lots: [] },
];

// 日付はどのタイムゾーンでも同じローカル日付になるよう UTC の 03:00 にする
const txn = (over: Partial<StockTransaction> & { id: string }): StockTransaction => ({
  date: '2026-06-10T03:00:00.000Z',
  type: '売上出庫',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: 'L1',
  quantity: 1,
  note: SALE_NOTE,
  unitPrice: 180,
  customerId: 'cus-a',
  costUnitPrice: 130,
  taxRate: 8,
  ...over,
});

const LEDGER: StockTransaction[] = [
  // 同じ日・同じ商品・同じ単価でロットが分かれた売上 → 1行にまとまる
  txn({ id: 't1', quantity: 3, lotNo: 'L1' }),
  txn({ id: 't2', quantity: 2, lotNo: 'L2' }),
  // 単価違いは別の行
  txn({ id: 't3', quantity: 1, unitPrice: 150 }),
  // 10% の商品
  txn({ id: 't4', productId: 'p2', productName: '値札ラベル', productSku: 'LB-001', quantity: 7, unitPrice: 5, taxRate: 10 }),
  // 翌日
  txn({ id: 't5', date: '2026-06-11T03:00:00.000Z', quantity: 4 }),
  // 別の得意先・得意先なし
  txn({ id: 't6', customerId: 'cus-b', quantity: 9 }),
  txn({ id: 't7', customerId: undefined, quantity: 9 }),
  // 売上以外は対象外
  txn({ id: 't8', type: '調整出庫', quantity: 5 }),
];

const SALES = salesRows(LEDGER, PRODUCTS, CUSTOMERS);

const input = (over: Partial<IssueSalesDocumentInput> = {}): IssueSalesDocumentInput => ({
  kind: '請求書',
  issueDate: '2026-07-01',
  customer: CUSTOMERS[0],
  periodFrom: '2026-06-01',
  periodTo: '2026-06-30',
  dueDate: '2026-07-31',
  issuer: { ...EMPTY_SALES_DOCUMENT_ISSUER, name: '自社', registrationNo: 'T1234567890123', bankAccount: '〇〇銀行 普通 1234567' },
  lines: salesDocumentLines(SALES, 'cus-a', '2026-06-01', '2026-06-30'),
  ...over,
});

describe('salesDocumentLines', () => {
  it('同じ日・商品・単価・税率の売上を1行にまとめ、日付→商品名の順に並べる', () => {
    const lines = salesDocumentLines(SALES, 'cus-a', '2026-06-01', '2026-06-30');
    expect(lines.map(l => [l.deliveryDate, l.productName, l.unitPrice, l.quantity, l.amount])).toEqual([
      ['2026-06-10', '牛乳', 150, 1, 150],
      ['2026-06-10', '牛乳', 180, 5, 900],
      ['2026-06-10', '値札ラベル', 5, 7, 35],
      ['2026-06-11', '牛乳', 180, 4, 720],
    ]);
    expect(lines[1].txnIds.sort()).toEqual(['t1', 't2']);
  });

  it('期間・得意先で絞り、得意先なしや得意先未指定は対象外', () => {
    expect(salesDocumentLines(SALES, 'cus-a', '2026-06-11', '2026-06-11')).toHaveLength(1);
    expect(salesDocumentLines(SALES, 'cus-b', '', '').map(l => l.quantity)).toEqual([9]);
    expect(salesDocumentLines(SALES, '', '', '')).toEqual([]);
  });

  it('発行済みの売上は書類番号つきの別の行になる', () => {
    const issued = new Map([['t1', 'I20260701-001']]);
    const lines = salesDocumentLines(SALES, 'cus-a', '2026-06-10', '2026-06-10', issued);
    const milk180 = lines.filter(l => l.productName === '牛乳' && l.unitPrice === 180);
    expect(milk180.map(l => [l.quantity, l.issuedNo])).toEqual([[3, 'I20260701-001'], [2, '']]);
  });

  it('販売単価が記録されていない売上は定価で計算し、印をつける', () => {
    const sales = salesRows([txn({ id: 'x', unitPrice: undefined, quantity: 2 })], PRODUCTS, CUSTOMERS);
    const [line] = salesDocumentLines(sales, 'cus-a', '', '');
    expect(line.unitPrice).toBe(200);
    expect(line.estimatedPrice).toBe(true);
  });
});

describe('salesDocumentTotals', () => {
  it('消費税は税率ごとに合計してから1回だけ四捨五入する', () => {
    // 明細ごとに丸めると 0+0+0 = 0 円、合計で丸めると 105 * 8% = 8.4 → 8 円
    const lines = [35, 35, 35].map(amount => ({ quantity: 1, amount, taxRate: 8 as const }));
    const totals = salesDocumentTotals(lines);
    expect(totals.tax).toBe(8);
    expect(totals.amountWithTax).toBe(113);
    expect(totals.byTaxRate).toEqual([{ taxRate: 8, amount: 105, tax: 8, amountWithTax: 113 }]);
  });

  it('載っている税率だけを軽減税率から順に返す', () => {
    const totals = salesDocumentTotals(input().lines);
    expect(totals.byTaxRate.map(b => [b.taxRate, b.amount, b.tax])).toEqual([[8, 1770, 142], [10, 35, 4]]);
    expect(totals.amount).toBe(1805);
    expect(totals.tax).toBe(146);
  });

  it('売上管理の明細ごとの端数処理とは数円ずれうる (書類側が適格請求書のルール)', () => {
    const rows = SALES.filter(r => r.customerId === 'cus-a');
    expect(salesTotals(rows).amount).toBe(salesDocumentTotals(input().lines).amount);
  });
});

describe('書類番号・日付', () => {
  const item = (documentNo: string): SalesDocumentItem => ({ ...buildSalesDocumentItems(input(), [], 'd', '')[0], documentNo });

  it('種類ごとの接頭辞 + 発行日 + その日の連番', () => {
    expect(nextSalesDocumentNo('納品書', '2026-07-01', [])).toBe('D20260701-001');
    const existing = [item('I20260701-001'), item('I20260701-004'), item('I20260630-009'), item('D20260701-007')];
    expect(nextSalesDocumentNo('請求書', '2026-07-01', existing)).toBe('I20260701-005');
  });

  it('前月の範囲と翌月末', () => {
    expect(previousMonthRange(new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousMonthRange(new Date(2026, 2, 31))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(nextMonthEnd('2026-01-31')).toBe('2026-02-28');
    expect(nextMonthEnd('2026-12-31')).toBe('2027-01-31');
  });

  it('登録番号は T + 13桁 (空は可)', () => {
    expect(isValidRegistrationNo('')).toBe(true);
    expect(isValidRegistrationNo('T1234567890123')).toBe(true);
    expect(isValidRegistrationNo('1234567890123')).toBe(false);
    expect(isValidRegistrationNo('T123')).toBe(false);
  });
});

describe('salesDocumentValidationError', () => {
  it('正しい入力なら空文字', () => {
    expect(salesDocumentValidationError(input())).toBe('');
  });

  it.each([
    ['得意先なし', { customer: { ...CUSTOMERS[0], id: '' } }, '得意先'],
    ['明細なし', { lines: [] }, '1件以上'],
    ['期間が逆', { periodFrom: '2026-07-01', periodTo: '2026-06-01' }, '開始日'],
    ['登録番号の形式', { issuer: { ...EMPTY_SALES_DOCUMENT_ISSUER, registrationNo: 'T12' } }, '登録番号'],
  ])('%s', (_, over, message) => {
    expect(salesDocumentValidationError(input(over as Partial<IssueSalesDocumentInput>))).toContain(message);
  });

  it('発行済みの行を含むと発行できない', () => {
    const lines = input().lines.map((l, i) => i === 0 ? { ...l, issuedNo: 'I20260701-001' } : l);
    expect(salesDocumentValidationError(input({ lines }))).toContain('すでに');
  });
});

describe('buildSalesDocumentItems / salesDocuments', () => {
  it('ヘッダ情報をスナップショットとして各行に持ち、書類にまとめ直せる', () => {
    const items = buildSalesDocumentItems(input(), [], 'doc1', '2026-07-01T00:00:00.000Z');
    expect(items).toHaveLength(4);
    expect(items.every(i => i.documentNo === 'I20260701-001' && i.customerName === 'みどりストア' && i.issuerRegistrationNo === 'T1234567890123')).toBe(true);
    const [doc] = salesDocuments(items);
    expect(doc.items.map(i => i.lineNo)).toEqual([1, 2, 3, 4]);
    expect(doc.totals.amountWithTax).toBe(1951);
    expect(doc.issuer.bankAccount).toBe('〇〇銀行 普通 1234567');
  });

  it('納品書には支払期限・振込先を載せない', () => {
    const [i] = buildSalesDocumentItems(input({ kind: '納品書' }), [], 'doc1', '');
    expect(i.documentNo).toBe('D20260701-001');
    expect(i.dueDate).toBe('');
    expect(i.issuerBankAccount).toBe('');
  });

  it('プレビュー (draftSalesDocument) は発行される書類と同じ番号・金額になる', () => {
    const existing = buildSalesDocumentItems(input(), [], 'old', '2026-07-01T00:00:00.000Z');
    const draft = draftSalesDocument(input(), existing);
    const [issued] = salesDocuments(buildSalesDocumentItems(input(), existing, 'new', ''));
    expect(draft.documentNo).toBe('I20260701-002');
    expect(draft.documentNo).toBe(issued.documentNo);
    expect(draft.totals).toEqual(issued.totals);
    expect(draftSalesDocument(input({ lines: [] }), []).items).toEqual([]);
  });

  it('種類・得意先・発行日・キーワードで絞り込み、新しい順に並べる', () => {
    const a = buildSalesDocumentItems(input(), [], 'a', '2026-07-01T00:00:00.000Z');
    const b = buildSalesDocumentItems(
      input({ kind: '納品書', customer: CUSTOMERS[1], issueDate: '2026-06-10', lines: salesDocumentLines(SALES, 'cus-b', '', '') }),
      a, 'b', '2026-06-10T00:00:00.000Z',
    );
    const all = [...a, ...b];
    expect(salesDocuments(all).map(d => d.documentId)).toEqual(['a', 'b']);
    expect(salesDocuments(all, { keyword: '', kind: '納品書', customerId: '', from: '', to: '' }).map(d => d.documentId)).toEqual(['b']);
    expect(salesDocuments(all, { keyword: 'さくら', kind: '', customerId: '', from: '', to: '' }).map(d => d.documentId)).toEqual(['b']);
    expect(salesDocuments(all, { keyword: 'LB-001', kind: '', customerId: '', from: '', to: '' }).map(d => d.documentId)).toEqual(['a']);
    expect(salesDocuments(all, { keyword: '', kind: '', customerId: 'cus-a', from: '2026-06-15', to: '' }).map(d => d.documentId)).toEqual(['a']);
  });

  it('issuedSalesDocumentNos は種類ごとに売上 → 書類番号を引ける', () => {
    const items = buildSalesDocumentItems(input(), [], 'a', '');
    expect(issuedSalesDocumentNos(items, '請求書').get('t1')).toBe('I20260701-001');
    expect(issuedSalesDocumentNos(items, '納品書').size).toBe(0);
  });

  it('CSV は書類の明細を1行ずつ出す', () => {
    const csv = salesDocumentCsv(salesDocuments(buildSalesDocumentItems(input(), [], 'a', '')));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('書類番号');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('請求書,I20260701-001,2026-07-01,みどりストア,2026-06-01,2026-06-30,2026-07-31,2026-06-10,牛乳,ML-001,1,150,150,8%');
  });
});

describe('useInventory — issueSalesDocument / deleteSalesDocument', () => {
  const sell = (result: { current: ReturnType<typeof useInventory> }) => {
    act(() => { result.current.recordSale({ productId: '1', quantity: 3, unitPrice: 180, customerId: 'cus-midori' }); });
  };
  const today = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const issueInput = (result: { current: ReturnType<typeof useInventory> }, kind: '納品書' | '請求書' = '納品書'): IssueSalesDocumentInput => {
    const sales = salesRows(result.current.ledger, result.current.products, result.current.customers);
    const customer = result.current.customers.find(c => c.id === 'cus-midori')!;
    return {
      kind, issueDate: today(), customer, periodFrom: today(), periodTo: today(), dueDate: '',
      issuer: EMPTY_SALES_DOCUMENT_ISSUER,
      lines: salesDocumentLines(sales, 'cus-midori', today(), today(), issuedSalesDocumentNos(result.current.salesDocumentItems, kind)),
    };
  };

  it('発行すると履歴に残り、在庫と帳票は動かない', () => {
    const { result } = renderHook(() => useInventory());
    sell(result);
    const ledgerBefore = result.current.ledger.length;
    const stockBefore = JSON.stringify(result.current.products);
    let doc: ReturnType<typeof result.current.issueSalesDocument> = null;
    act(() => { doc = result.current.issueSalesDocument(issueInput(result)); });
    expect(doc).not.toBeNull();
    expect(doc!.documentNo).toMatch(/^D\d{8}-001$/);
    expect(result.current.salesDocumentItems.length).toBeGreaterThan(0);
    expect(result.current.ledger).toHaveLength(ledgerBefore);
    expect(JSON.stringify(result.current.products)).toBe(stockBefore);
  });

  it('同じ売上を同じ種類の書類に二度載せられないが、別の種類には載せられる', () => {
    const { result } = renderHook(() => useInventory());
    sell(result);
    const stale = issueInput(result); // 発行前に作った候補 (呼び出し側の状態が古い場合を想定)
    act(() => { result.current.issueSalesDocument(issueInput(result)); });
    let again: ReturnType<typeof result.current.issueSalesDocument> = null;
    act(() => { again = result.current.issueSalesDocument(stale); });
    expect(again).toBeNull();
    expect(issueInput(result).lines.every(l => l.issuedNo)).toBe(true);
    let invoice: ReturnType<typeof result.current.issueSalesDocument> = null;
    act(() => { invoice = result.current.issueSalesDocument(issueInput(result, '請求書')); });
    expect(invoice!.documentNo).toMatch(/^I\d{8}-001$/);
  });

  it('取り消すと売上がふたたび載せられるようになる', () => {
    const { result } = renderHook(() => useInventory());
    sell(result);
    let doc: ReturnType<typeof result.current.issueSalesDocument> = null;
    act(() => { doc = result.current.issueSalesDocument(issueInput(result)); });
    act(() => { result.current.deleteSalesDocument(doc!.documentId); });
    expect(result.current.salesDocumentItems).toEqual([]);
    expect(issueInput(result).lines.every(l => !l.issuedNo)).toBe(true);
  });

  it('発行内容を API に保存し、読み込み時に復元する', async () => {
    const server = stubApi();
    const first = renderHook(() => useInventory());
    await waitFor(() => expect(first.result.current.products).toEqual([]));
    const saved = buildSalesDocumentItems(input(), [], 'doc1', '2026-07-01T00:00:00.000Z');
    server.salesDocumentItems = saved;
    const second = renderHook(() => useInventory());
    await waitFor(() => expect(second.result.current.salesDocumentItems).toEqual(saved));
    act(() => { second.result.current.deleteSalesDocument('doc1'); });
    await waitFor(() => expect(server.salesDocumentItems).toEqual([]));
  });
});
