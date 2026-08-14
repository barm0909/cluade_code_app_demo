import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboundPlanView } from '../InboundPlanView';
import type { InboundPlan, Product, Warehouse } from '../useInventory';

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', lots: [], minQuantity: 0, price: 198, costPrice: 130, updatedAt: new Date().toISOString() },
  { id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', lots: [], minQuantity: 0, price: 150, costPrice: 90, updatedAt: new Date().toISOString() },
];

const PLANS: InboundPlan[] = [
  {
    id: 'ip1', productId: 'p1', expectedDate: d(2), quantity: 24, receivedQuantity: 0,
    warehouseId: 'wh-sales', lotNo: '20260401', expiryDate: d(12), supplier: '山田乳業', note: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'ip2', productId: 'p2', expectedDate: d(-1), quantity: 20, receivedQuantity: 8,
    warehouseId: 'wh-hold', lotNo: '20260501', supplier: '朝日ベーカリー', note: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const defaultProps = {
  inboundPlans: PLANS,
  products: PRODUCTS,
  warehouses: WAREHOUSES,
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  onReceive: vi.fn(() => ({ quantity: 5, lotNo: '20260401', warehouseId: 'wh-sales', remaining: 19, merged: false })),
};

beforeEach(() => { vi.clearAllMocks(); });

const planRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('InboundPlanView — 一覧', () => {
  it('入荷予定日の早い順に、状態と残数が表示される', () => {
    render(<InboundPlanView {...defaultProps} />);
    const rows = planRows();

    expect(rows).toHaveLength(2);
    // 予定日超過の ip2 が先
    expect(within(rows[0]).getByText('食パン')).toBeInTheDocument();
    expect(within(rows[0]).getByText('一部入荷')).toBeInTheDocument();
    expect(within(rows[0]).getByText('遅延')).toBeInTheDocument();
    expect(within(rows[1]).getByText('牛乳')).toBeInTheDocument();
    expect(within(rows[1]).getByText('未入荷')).toBeInTheDocument();
  });

  it('予定が0件のとき案内が表示される', () => {
    render(<InboundPlanView {...defaultProps} inboundPlans={[]} />);
    expect(screen.getByText(/入荷予定がありません/)).toBeInTheDocument();
  });

  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<InboundPlanView {...defaultProps} />);

    await user.type(screen.getByPlaceholderText(/商品名・SKU・ロットNo・仕入先/), '山田');

    const rows = planRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('牛乳')).toBeInTheDocument();
  });

  it('状態で絞り込める', async () => {
    const user = userEvent.setup();
    render(<InboundPlanView {...defaultProps} />);

    await user.selectOptions(screen.getByLabelText('状態'), '一部入荷');

    expect(planRows()).toHaveLength(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });
});

describe('InboundPlanView — 入荷', () => {
  it('入荷モーダルは残数を初期値にし、onReceive に入力が渡る', async () => {
    const user = userEvent.setup();
    render(<InboundPlanView {...defaultProps} />);

    // ip2 (残12) の行の「入荷」
    await user.click(within(planRows()[0]).getByText('入荷'));

    const qtyInput = screen.getByLabelText(/入荷数量/);
    expect(qtyInput).toHaveValue(12);

    await user.clear(qtyInput);
    await user.type(qtyInput, '5');
    await user.click(screen.getByText('入荷する'));

    expect(defaultProps.onReceive).toHaveBeenCalledWith('ip2', expect.objectContaining({
      quantity: 5, lotNo: '20260501', warehouseId: 'wh-hold',
    }));
  });

  it('残数のない予定は入荷ボタンが押せない', () => {
    const done: InboundPlan = { ...PLANS[0], id: 'ip3', receivedQuantity: 24 };
    render(<InboundPlanView {...defaultProps} inboundPlans={[done]} />);

    expect(within(planRows()[0]).getByText('入荷済')).toBeInTheDocument();
    expect(within(planRows()[0]).getByText('入荷')).toBeDisabled();
  });
});

describe('InboundPlanView — 作成・取消', () => {
  it('「+ 入荷予定を追加」で作成モーダルが開き、保存すると onAdd が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<InboundPlanView {...defaultProps} />);

    await user.click(screen.getByText('+ 入荷予定を追加'));
    expect(screen.getByText('入荷予定を追加')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('商品'), 'p2');
    const qty = screen.getByLabelText('予定数量');
    await user.clear(qty);
    await user.type(qty, '30');
    await user.type(screen.getByPlaceholderText('例: 20261231'), '20261231');
    await user.click(screen.getByText('保存'));

    expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'p2', quantity: 30, lotNo: '20261231',
    }));
  });

  it('取消は確認ダイアログのあとに onCancel を呼ぶ', async () => {
    const user = userEvent.setup();
    render(<InboundPlanView {...defaultProps} />);

    await user.click(within(planRows()[0]).getByText('取消'));
    expect(screen.getByText('入荷予定の取消')).toBeInTheDocument();
    await user.click(screen.getByText('取消する'));

    expect(defaultProps.onCancel).toHaveBeenCalledWith('ip2');
  });
});
