import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ReceivableView } from '../ReceivableView';
import { buildPaymentItems, planPayment, receivableRows, salesRows, SALE_NOTE } from '../useInventory';
import type { Customer, PaymentInput, PaymentItem, Product, SalesDocumentItem, StockTransaction } from '../useInventory';

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 10, updatedAt: '', lots: [] },
];

const pad = (n: number) => String(n).padStart(2, '0');
const dayOffset = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

// 請求書 (税抜 1000 / 10% → 請求額 1100)
const invoice = (documentId: string, customerId: string, dueDate: string, txnIds: string[] = []): SalesDocumentItem => ({
  id: `${documentId}-1`, documentId, kind: '請求書', documentNo: `I-${documentId}`,
  issuedAt: '2026-07-01T00:00:00.000Z', issueDate: dayOffset(-40),
  customerId, customerName: CUSTOMERS.find(c => c.id === customerId)!.name, customerAddress: '', customerContact: '',
  periodFrom: '', periodTo: '', dueDate,
  issuerName: '', issuerAddress: '', issuerPhone: '', issuerContact: '', issuerRegistrationNo: '', issuerBankAccount: '',
  lineNo: 1, deliveryDate: '', productName: '牛乳', productSku: 'ML-001', quantity: 5, unitPrice: 200, amount: 1000, taxRate: 10, txnIds,
});

const ITEMS = [
  invoice('inv1', 'cus-a', dayOffset(-5), ['t1']), // 5日超過
  invoice('inv2', 'cus-a', dayOffset(20)),
  invoice('inv3', 'cus-b', dayOffset(10)),
];

// まだ請求していない売上 (みどりストア 税抜 400 / 10% → 440)
const LEDGER: StockTransaction[] = [
  {
    id: 't2', date: new Date().toISOString(), type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
    lotNo: 'L1', quantity: 2, note: SALE_NOTE, unitPrice: 200, customerId: 'cus-a', costUnitPrice: 130, taxRate: 10,
  },
];
const SALES = salesRows(LEDGER, PRODUCTS, CUSTOMERS);

// useInventory の recordPayment / deletePayment と同じ振る舞いの最小版
function Harness({ initial = [] as PaymentItem[] }) {
  const [payments, setPayments] = useState<PaymentItem[]>(initial);
  const onRecordPayment = (input: PaymentInput) => {
    const plan = planPayment(receivableRows(ITEMS, payments), input);
    if (plan.error) return null;
    setPayments([...payments, ...buildPaymentItems(plan, input, crypto.randomUUID(), new Date().toISOString())]);
    return plan;
  };
  return (
    <ReceivableView
      items={ITEMS}
      payments={payments}
      sales={SALES}
      customers={CUSTOMERS}
      onRecordPayment={onRecordPayment}
      onDeletePayment={id => setPayments(payments.filter(p => p.receiptId !== id))}
    />
  );
}

const statValue = (label: string) =>
  screen.getByText(label, { selector: '.stat-label' }).parentElement!.querySelector('.stat-value')!.textContent;

// 得意先名は絞り込みの選択肢にも出るので、表の中だけを探す
const rowOf = (text: string) => within(screen.getByRole('table')).getByText(text).closest('tr') as HTMLElement;

describe('ReceivableView', () => {
  it('請求書がないときは案内を出す', () => {
    render(
      <ReceivableView items={[]} payments={[]} sales={[]} customers={CUSTOMERS} onRecordPayment={() => null} onDeletePayment={() => {}} />,
    );
    expect(screen.getByText(/発行した請求書がありません/)).toBeInTheDocument();
  });

  it('売掛金・請求残高・期限超過・未請求売上を集計し、未回収の請求書を期限の早い順に並べる', () => {
    render(<Harness />);
    expect(statValue('売掛金残高')).toBe('¥3,740'); // 3300 + 440
    expect(statValue('請求残高')).toBe('¥3,300');
    expect(statValue('期限超過')).toBe('¥1,100');
    expect(statValue('未請求売上（税込）')).toBe('¥440');

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['I-inv1', 'I-inv3', 'I-inv2']);
    expect(within(rows[0]).getByText('5日超過')).toBeInTheDocument();
    expect(within(rows[0]).getByText('未入金')).toBeInTheDocument();
  });

  it('請求書の行から入金を登録すると残高と状況が変わり、入金済は既定の一覧から消える', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(within(rowOf('I-inv1')).getByRole('button', { name: '入金登録' }));

    const dialog = screen.getByRole('heading', { name: '入金を登録' }).closest('.modal') as HTMLElement;
    expect(within(dialog).getByLabelText('得意先')).toHaveValue('cus-a');
    // その行の請求書だけが選ばれている
    expect(within(dialog).getByRole('checkbox', { name: 'I-inv1 に充てる' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'I-inv2 に充てる' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: '登録する' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText('入金額'), '600');
    expect(within(dialog).getByText(/消込 ¥600/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '登録する' }));
    expect(screen.queryByRole('heading', { name: '入金を登録' })).not.toBeInTheDocument();
    expect(within(rowOf('I-inv1')).getByText('一部入金')).toBeInTheDocument();
    expect(within(rowOf('I-inv1')).getByText('¥500')).toBeInTheDocument();

    // 残りを「残高を入金額に入れる」で全額入金する
    await user.click(within(rowOf('I-inv1')).getByRole('button', { name: '入金登録' }));
    const again = screen.getByRole('heading', { name: '入金を登録' }).closest('.modal') as HTMLElement;
    await user.click(within(again).getByRole('button', { name: /残高 ¥500 を入金額に入れる/ }));
    expect(within(again).getByLabelText('入金額')).toHaveValue(500);
    await user.click(within(again).getByRole('button', { name: '登録する' }));
    expect(screen.queryByText('I-inv1')).not.toBeInTheDocument();
    expect(statValue('期限超過')).toBe('¥0');
  });

  it('充てきれない入金は未消込として表示し、入金履歴から削除できる', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '+ 入金を登録' }));
    const dialog = screen.getByRole('heading', { name: '入金を登録' }).closest('.modal') as HTMLElement;
    await user.selectOptions(within(dialog).getByLabelText('得意先'), 'cus-b');
    await user.type(within(dialog).getByLabelText('入金額'), '1500');
    expect(within(dialog).getByText('未消込 ¥400')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '登録する' }));

    await user.click(screen.getByRole('button', { name: '入金履歴' }));
    const row = rowOf('さくらカフェ');
    expect(within(row).getByText('¥1,500')).toBeInTheDocument();
    expect(within(row).getByText('I-inv3')).toBeInTheDocument();
    expect(within(row).getByText('未消込 ¥400')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: '削除' }));
    await user.click(screen.getByRole('button', { name: '削除する' }));
    expect(screen.getByText(/入金の記録はまだありません/)).toBeInTheDocument();
  });

  it('得意先別に売掛金残高を出す', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{
      id: 'r1-1', receiptId: 'r1', customerId: 'cus-a', paymentDate: dayOffset(-1), method: '振込',
      documentId: '', documentNo: '', amount: 300, fee: 0, note: '', createdAt: '2026-08-01T00:00:00.000Z',
    }]} />);
    await user.click(screen.getByRole('button', { name: '得意先別' }));
    const row = rowOf('みどりストア');
    const cells = within(row).getAllByRole('cell').map(c => c.textContent);
    // 請求残高 2200 (2枚) / 期限超過 1100 / 未請求 440 / 未消込 300 / 残高 2340
    expect(cells.slice(1, 6)).toEqual(['¥2,2002枚', '¥1,100', '¥440', '¥300', '¥2,340']);
  });
});
