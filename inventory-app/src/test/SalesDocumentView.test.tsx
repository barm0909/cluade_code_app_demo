import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SalesDocumentView } from '../SalesDocumentView';
import {
  buildSalesDocumentItems,
  prepareSalesDocuments,
  issuedSalesDocumentNos,
  salesDocumentValidationError,
  salesDocuments,
  salesRows,
  SALE_NOTE,
} from '../useInventory';
import type { Customer, IssueSalesDocumentInput, Product, SalesDocumentItem, StockTransaction } from '../useInventory';

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: '', contact: '', phone: '', email: '', address: '東京都世田谷区', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 8, updatedAt: '', lots: [] },
];

// 今日の売上にしておくと、納品書の納品日の初期値 (最新の売上日) と一致する
const NOW = new Date();
NOW.setHours(12, 0, 0, 0);
const LEDGER: StockTransaction[] = [
  {
    id: 't1', date: NOW.toISOString(), type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
    lotNo: 'L1', quantity: 3, note: SALE_NOTE, unitPrice: 180, customerId: 'cus-a', costUnitPrice: 130, taxRate: 8,
  },
];
const SALES = salesRows(LEDGER, PRODUCTS, CUSTOMERS);

// useInventory の issueSalesDocument / deleteSalesDocument と同じ振る舞いの最小版
function Harness({ initial = [] as SalesDocumentItem[] }) {
  const [items, setItems] = useState<SalesDocumentItem[]>(initial);
  const onIssue = (input: IssueSalesDocumentInput) => {
    const issued = issuedSalesDocumentNos(items, input.kind);
    const lines = input.lines.map(l => ({ ...l, issuedNo: l.txnIds.map(id => issued.get(id)).find(Boolean) ?? '' }));
    if (salesDocumentValidationError({ ...input, lines })) return null;
    const created = buildSalesDocumentItems({ ...input, lines }, items, crypto.randomUUID(), new Date().toISOString());
    setItems([...items, ...created]);
    return salesDocuments(created)[0];
  };
  return (
    <SalesDocumentView
      items={items}
      sales={SALES}
      customers={CUSTOMERS}
      onIssue={onIssue}
      onDelete={id => setItems(items.filter(i => i.documentId !== id))}
    />
  );
}

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
  localStorage.clear();
});

describe('SalesDocumentView', () => {
  it('発行済みの書類がないときは案内を出す', () => {
    render(<Harness />);
    expect(screen.getByText(/発行した納品書・請求書はまだありません/)).toBeInTheDocument();
  });

  it('納品書を発行すると印刷され、一覧に載り、同じ売上は次から選べなくなる', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '+ 納品書を作成' }));

    const dialog = screen.getByRole('heading', { name: '納品書を作成' }).closest('.modal') as HTMLElement;
    expect(within(dialog).getByLabelText('得意先')).toHaveValue('cus-a');
    expect(within(dialog).getByText('みどりストア 御中')).toBeInTheDocument();
    // 紙面の合計: 540 + 消費税 43 (8%)
    expect(within(dialog).getAllByText('¥583').length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole('button', { name: '発行して印刷' }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: '納品書を作成' })).not.toBeInTheDocument();

    const row = screen.getByRole('cell', { name: /^D\d{8}-001$/ }).closest('tr') as HTMLElement;
    expect(within(row).getByText('みどりストア')).toBeInTheDocument();
    expect(within(row).getByText('¥583')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ 納品書を作成' }));
    const again = screen.getByRole('heading', { name: '納品書を作成' }).closest('.modal') as HTMLElement;
    expect(within(again).getByRole('checkbox', { name: /記載済みのため選択できません/ })).toBeDisabled();
    expect(within(again).getByRole('button', { name: '発行して印刷' })).toBeDisabled();
  });

  it('外した売上は紙面に載らず、全部外すと発行できない', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '+ 納品書を作成' }));
    const dialog = screen.getByRole('heading', { name: '納品書を作成' }).closest('.modal') as HTMLElement;
    await user.click(within(dialog).getByRole('checkbox', { name: /牛乳.*納品書に載せる/ }));
    expect(within(dialog).getByText('明細がありません。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '発行して印刷' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('1件以上');
  });

  it('登録番号の形式が違うと発行できない', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '+ 納品書を作成' }));
    const dialog = screen.getByRole('heading', { name: '納品書を作成' }).closest('.modal') as HTMLElement;
    await user.type(within(dialog).getByLabelText(/登録番号/), 'T123');
    expect(within(dialog).getByRole('button', { name: '発行して印刷' })).toBeDisabled();
    expect(localStorage.getItem('sales-doc-issuer-info')).toContain('T123');
  });

  it('取消すると一覧から消える', async () => {
    const user = userEvent.setup();
    const initial = buildSalesDocumentItems({
      kind: '請求書', issueDate: '2026-07-01', customer: CUSTOMERS[0], periodFrom: '2026-06-01', periodTo: '2026-06-30', dueDate: '2026-07-31',
      issuer: { name: '自社', address: '', phone: '', contact: '', registrationNo: '', bankAccount: '' },
      lines: [{ key: 'k', deliveryDate: '2026-06-10', productId: 'p1', productName: '牛乳', productSku: 'ML-001', quantity: 1, unitPrice: 100, amount: 100, taxRate: 8, txnIds: ['old'], estimatedPrice: false, issuedNo: '', isReturn: false }],
    }, [], 'doc1', '2026-07-01T00:00:00.000Z');
    render(<Harness initial={initial} />);
    expect(screen.getByText('I20260701-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '取り消す' }));
    expect(screen.queryByText('I20260701-001')).not.toBeInTheDocument();
  });

  it('入金を充てた請求書は取り消せない', () => {
    const initial = buildSalesDocumentItems({
      kind: '請求書', issueDate: '2026-07-01', customer: CUSTOMERS[0], periodFrom: '2026-06-01', periodTo: '2026-06-30', dueDate: '2026-07-31',
      issuer: { name: '自社', address: '', phone: '', contact: '', registrationNo: '', bankAccount: '' },
      lines: [{ key: 'k', deliveryDate: '2026-06-10', productId: 'p1', productName: '牛乳', productSku: 'ML-001', quantity: 1, unitPrice: 100, amount: 100, taxRate: 8, txnIds: ['old'], estimatedPrice: false, issuedNo: '', isReturn: false }],
    }, [], 'doc1', '2026-07-01T00:00:00.000Z');
    render(
      <SalesDocumentView
        items={initial}
        sales={SALES}
        customers={CUSTOMERS}
        payments={[{
          id: 'r1-1', receiptId: 'r1', customerId: 'cus-a', paymentDate: '2026-07-20', method: '振込',
          documentId: 'doc1', documentNo: 'I20260701-001', amount: 50, fee: 0, note: '', createdAt: '2026-07-20T00:00:00.000Z',
        }]}
        onIssue={() => null}
        onDelete={() => false}
      />,
    );
    const button = screen.getByRole('button', { name: '取消' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('入金を充てた請求書は取り消せません'));
  });

  it('再表示で発行済みの紙面を開ける', async () => {
    const user = userEvent.setup();
    const initial = buildSalesDocumentItems({
      kind: '請求書', issueDate: '2026-07-01', customer: CUSTOMERS[0], periodFrom: '2026-06-01', periodTo: '2026-06-30', dueDate: '2026-07-31',
      issuer: { name: '自社', address: '', phone: '', contact: '', registrationNo: 'T1234567890123', bankAccount: '〇〇銀行' },
      lines: [{ key: 'k', deliveryDate: '2026-06-10', productId: 'p1', productName: '牛乳', productSku: 'ML-001', quantity: 1, unitPrice: 100, amount: 100, taxRate: 8, txnIds: ['old'], estimatedPrice: false, issuedNo: '', isReturn: false }],
    }, [], 'doc1', '2026-07-01T00:00:00.000Z');
    render(<Harness initial={initial} />);
    await user.click(screen.getByRole('button', { name: '再表示' }));
    expect(screen.getByText('登録番号：T1234567890123')).toBeInTheDocument();
    expect(screen.getByText('お支払期限：2026-07-31')).toBeInTheDocument();
    expect(screen.getByText('〇〇銀行')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '印刷' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});

describe('SalesDocumentView — 締め請求', () => {
  // 締め日 = 今月末 (今日の売上が対象期間に入る)
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthEnd = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0);
  const closingDate = `${monthEnd.getFullYear()}-${pad(monthEnd.getMonth() + 1)}-${pad(monthEnd.getDate())}`;
  const nextMonthEnd = new Date(NOW.getFullYear(), NOW.getMonth() + 2, 0);
  const dueDate = `${nextMonthEnd.getFullYear()}-${pad(nextMonthEnd.getMonth() + 1)}-${pad(nextMonthEnd.getDate())}`;

  function ClosingHarness() {
    const [items, setItems] = useState<SalesDocumentItem[]>([]);
    const onIssueMany = (inputs: IssueSalesDocumentInput[]) => {
      const { created, docs } = prepareSalesDocuments(inputs, items, [], () => crypto.randomUUID(), new Date().toISOString());
      setItems([...items, ...created]);
      return docs;
    };
    return (
      <SalesDocumentView
        items={items}
        sales={SALES}
        customers={[{ ...CUSTOMERS[0], closingDay: 31, paymentMonths: 1, paymentDay: 31 }, { ...CUSTOMERS[1], closingDay: 0 }]}
        onIssue={() => null}
        onIssueMany={onIssueMany}
        onDelete={() => true}
      />
    );
  }

  it('締め日にあたる得意先の請求書を、期間・期限・繰越つきでまとめて発行する', async () => {
    const user = userEvent.setup();
    render(<ClosingHarness />);
    await user.click(screen.getByRole('button', { name: '締め請求' }));
    const dialog = screen.getByRole('heading', { name: '締め請求' }).closest('.modal') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText('締め日'), { target: { value: closingDate } });

    // 末日締めの得意先だけが並ぶ (都度請求のさくらカフェは対象外)
    const row = within(dialog).getByRole('checkbox', { name: 'みどりストアの請求書を発行する' }).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('末日締め・翌月末払い');
    expect(row).toHaveTextContent(`〜 ${closingDate}`);
    expect(row).toHaveTextContent(dueDate);
    expect(within(row).getAllByText('¥583').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('さくらカフェ')).not.toBeInTheDocument();

    // 紙面プレビューに繰越欄が出る
    expect(within(dialog).getByRole('table', { name: '繰越' })).toHaveTextContent('今回御請求額');

    await user.click(within(dialog).getByRole('button', { name: '1件を発行して印刷' }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: '締め請求' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /^I\d{8}-001$/ })).toBeInTheDocument();

    // もう一度開くと発行済みになっていて選べない
    await user.click(screen.getByRole('button', { name: '締め請求' }));
    const again = screen.getByRole('heading', { name: '締め請求' }).closest('.modal') as HTMLElement;
    fireEvent.change(within(again).getByLabelText('締め日'), { target: { value: closingDate } });
    expect(within(again).getByRole('checkbox', { name: 'みどりストアの請求書を発行する' })).toBeDisabled();
    expect(within(again).getByText(/発行済み（I\d{8}-001）/)).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: '発行して印刷' })).toBeDisabled();
  });

  it('締め日にあたる得意先がいなければ案内を出す', async () => {
    const user = userEvent.setup();
    render(<ClosingHarness />);
    await user.click(screen.getByRole('button', { name: '締め請求' }));
    const dialog = screen.getByRole('heading', { name: '締め請求' }).closest('.modal') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText('締め日'), { target: { value: '2026-11-15' } });
    expect(within(dialog).getByText(/2026-11-15 が締め日にあたる得意先はいません/)).toBeInTheDocument();
  });
});
