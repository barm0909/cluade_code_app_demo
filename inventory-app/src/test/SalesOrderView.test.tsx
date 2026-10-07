import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesOrderView } from '../SalesOrderView';
import type { Customer, Product, SalesOrder, Warehouse } from '../useInventory';

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'みどりストア', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
  { id: 'c2', name: 'さくらカフェ', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0, price: 198, costPrice: 130, taxRate: 8,
    lots: [
      { id: 'l1', lotNo: '20260701', expiryDate: d(3), quantity: 4, warehouseId: 'wh-sales', unitPrice: 118 },
      { id: 'l2', lotNo: '20260705', expiryDate: d(7), quantity: 10, warehouseId: 'wh-sales', unitPrice: 120 },
    ],
    updatedAt: new Date().toISOString(),
  },
  { id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', lots: [], minQuantity: 0, price: 150, costPrice: 90, updatedAt: new Date().toISOString() },
];

const ORDERS: SalesOrder[] = [
  {
    id: 'o1', customerId: 'c1', productId: 'p1', expectedDate: d(1), quantity: 6, shippedQuantity: 0, unitPrice: 190,
    warehouseId: '', note: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'o2', customerId: 'c2', productId: 'p2', expectedDate: d(-1), quantity: 5, shippedQuantity: 0, unitPrice: 0,
    warehouseId: 'wh-sales', note: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const defaultProps = {
  salesOrders: ORDERS,
  products: PRODUCTS,
  customers: CUSTOMERS,
  warehouses: WAREHOUSES,
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  onShip: vi.fn(() => ({
    plan: { allocations: [{ lotId: 'l1', lotNo: '20260701', warehouseId: 'wh-sales', availableQuantity: 4, quantity: 4, unitCost: 118 }], allocated: 4, shortage: 0, skippedExpired: 0, cost: 472 },
    remaining: 2,
  })),
};

beforeEach(() => { vi.clearAllMocks(); });

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('SalesOrderView — 一覧', () => {
  it('出荷予定日の早い順に、得意先・引当・状態が表示される', () => {
    render(<SalesOrderView {...defaultProps} />);
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    // 遅延している食パンが先、在庫がないので不足
    expect(within(rows[0]).getByText('さくらカフェ')).toBeInTheDocument();
    expect(within(rows[0]).getByText('遅延')).toBeInTheDocument();
    expect(within(rows[0]).getByText('不足 5')).toBeInTheDocument();
    expect(within(rows[0]).getByText('¥150（概算）')).toBeInTheDocument();
    // 牛乳は在庫 14 で受注 6 なので引当可
    expect(within(rows[1]).getByText('みどりストア')).toBeInTheDocument();
    expect(within(rows[1]).getByText('引当可')).toBeInTheDocument();
    expect(within(rows[1]).getByText('全倉庫')).toBeInTheDocument();
  });

  it('集計に受注残・在庫不足・遅延が出る', () => {
    render(<SalesOrderView {...defaultProps} />);
    expect(screen.getByText('受注 11')).toBeInTheDocument();
    expect(screen.getByText('在庫不足 1件')).toBeInTheDocument();
    expect(screen.getByText('遅延 1件')).toBeInTheDocument();
  });

  it('得意先で絞り込める', async () => {
    const user = userEvent.setup();
    render(<SalesOrderView {...defaultProps} />);
    await user.selectOptions(screen.getByLabelText('得意先'), 'c1');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('1件 / 全2件')).toBeInTheDocument();
  });

  it('受注がなければ案内を出す', () => {
    render(<SalesOrderView {...defaultProps} salesOrders={[]} />);
    expect(screen.getByText(/受注がありません/)).toBeInTheDocument();
  });
});

describe('SalesOrderView — 出荷', () => {
  it('出荷モーダルに FEFO の引当プレビューと金額が出て、確定すると onShip が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<SalesOrderView {...defaultProps} />);
    await user.click(within(bodyRows()[1]).getByRole('button', { name: '出荷' }));

    const dialog = screen.getByRole('heading', { name: '受注を出荷' }).closest('.modal') as HTMLElement;
    // 受注残 6 を期限の近い l1 (4) → l2 (2) の順に引き当てる
    expect(within(dialog).getByText('20260701')).toBeInTheDocument();
    expect(within(dialog).getByText('20260705')).toBeInTheDocument();
    // 190 × 6 = 1,140、消費税はロットごとに四捨五入 (60.8→61, 30.4→30)
    expect(within(dialog).getByText('¥1,140')).toBeInTheDocument();
    expect(within(dialog).getByText('消費税 ¥91')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '出荷する' }));
    expect(defaultProps.onShip).toHaveBeenCalledWith('o1', { quantity: 6, includeExpired: false, note: '' });
    expect(screen.getByText(/4 を出荷しました/)).toBeInTheDocument();
  });

  it('在庫が足りない受注は出荷ボタンを押せない', async () => {
    const user = userEvent.setup();
    render(<SalesOrderView {...defaultProps} />);
    await user.click(within(bodyRows()[0]).getByRole('button', { name: '出荷' }));
    const dialog = screen.getByRole('heading', { name: '受注を出荷' }).closest('.modal') as HTMLElement;
    expect(within(dialog).getByText(/在庫が 5 不足しています/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '出荷する' })).toBeDisabled();
  });
});

describe('SalesOrderView — 登録', () => {
  it('得意先・商品・数量を入れて保存すると onAdd が呼ばれる（単価の既定は販売定価）', async () => {
    const user = userEvent.setup();
    render(<SalesOrderView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '+ 受注を登録' }));

    // 一覧の絞り込みにも「得意先」があるので、モーダルの中で探す
    const dialog = screen.getByRole('heading', { name: '受注を登録' }).closest('.modal') as HTMLElement;
    await user.selectOptions(within(dialog).getByLabelText('得意先'), 'c2');
    const qty = within(dialog).getByLabelText('受注数量');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'c2', productId: 'p1', quantity: 3, unitPrice: 198, warehouseId: '',
    }));
  });
});
