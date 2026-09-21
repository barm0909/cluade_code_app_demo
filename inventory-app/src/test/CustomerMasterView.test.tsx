import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerMasterView } from '../CustomerMasterView';
import { salesRows, DEFAULT_WAREHOUSE_ID } from '../useInventory';
import type { Customer, Product, StockTransaction } from '../useInventory';

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: 'C-001', contact: '緑川 一郎', phone: '03-2222-3333', email: '', address: '', note: '毎朝配送', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: 'C-002', contact: '', phone: '', email: 'cafe@example.jp', address: '', note: '', active: true },
  { id: 'cus-c', name: '休止先', code: '', contact: '', phone: '', email: '', address: '', note: '', active: false },
];

const PRODUCTS: Product[] = [{
  id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0,
  price: 200, costPrice: 130, updatedAt: new Date().toISOString(), lots: [],
}];

const LEDGER: StockTransaction[] = [
  {
    id: 't1', date: '2026-06-10T01:00:00.000Z', type: '売上出庫', productId: 'p1', productName: '牛乳',
    productSku: 'ML-001', lotNo: '20260610', quantity: 10, note: '売上登録',
    fromWarehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 190, costUnitPrice: 118, customerId: 'cus-a',
  },
];

const defaultProps = {
  customers: CUSTOMERS,
  sales: salesRows(LEDGER, PRODUCTS, CUSTOMERS),
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('CustomerMasterView', () => {
  it('取引中を先に並べ、売上実績を表示する', () => {
    render(<CustomerMasterView {...defaultProps} />);
    expect(rows()).toHaveLength(3);
    const first = rows()[0];
    expect(within(first).getByText('さくらカフェ')).toBeInTheDocument(); // 取引中→名前順
    const midori = rows()[1];
    expect(within(midori).getByText('1件')).toBeInTheDocument();
    expect(within(midori).getByText('¥1,900')).toBeInTheDocument();
    expect(within(midori).getByText('粗利 ¥720')).toBeInTheDocument();
  });

  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<CustomerMasterView {...defaultProps} />);
    await user.type(screen.getByPlaceholderText(/得意先名・コード・担当者・電話・メールで検索/), '緑川');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('みどりストア')).toBeInTheDocument();
  });

  it('取引停止を隠せる', async () => {
    const user = userEvent.setup();
    render(<CustomerMasterView {...defaultProps} />);
    await user.click(screen.getByLabelText('取引停止も表示'));
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('休止先')).not.toBeInTheDocument();
  });

  it('売上のある得意先は削除できない', () => {
    render(<CustomerMasterView {...defaultProps} />);
    const midori = rows()[1];
    expect(within(midori).getByRole('button', { name: '削除' })).toBeDisabled();
    const sakura = rows()[0];
    expect(within(sakura).getByRole('button', { name: '削除' })).toBeEnabled();
  });

  it('取引停止・取引再開は active だけを書き換える', async () => {
    const user = userEvent.setup();
    render(<CustomerMasterView {...defaultProps} />);
    await user.click(within(rows()[0]).getByRole('button', { name: '取引停止' }));
    expect(defaultProps.onUpdate).toHaveBeenCalledWith('cus-b', expect.objectContaining({ name: 'さくらカフェ', active: false }));

    await user.click(within(rows()[2]).getByRole('button', { name: '取引再開' }));
    expect(defaultProps.onUpdate).toHaveBeenCalledWith('cus-c', expect.objectContaining({ name: '休止先', active: true }));
  });

  it('追加フォームから登録できる', async () => {
    const user = userEvent.setup();
    render(<CustomerMasterView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '+ 得意先追加' }));
    await user.type(screen.getByLabelText('得意先名'), '新規商店');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '新規商店', active: true }));
  });

  it('同じ名前の得意先は登録できず、エラーを出す', async () => {
    const user = userEvent.setup();
    render(<CustomerMasterView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '+ 得意先追加' }));
    await user.type(screen.getByLabelText('得意先名'), 'みどりストア');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前の得意先がすでにあります');
    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it('得意先が1件もないときは案内文を出す', () => {
    render(<CustomerMasterView {...defaultProps} customers={[]} sales={[]} />);
    expect(screen.getByText(/得意先がありません/)).toBeInTheDocument();
  });
});
