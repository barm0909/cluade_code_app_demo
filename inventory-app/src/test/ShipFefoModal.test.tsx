import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShipFefoModal } from '../ShipFefoModal';
import type { Product } from '../useInventory';

const MOCK_WAREHOUSES = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const PRODUCT: Product = {
  id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy',
  minQuantity: 0, price: 198, costPrice: 130, updatedAt: new Date().toISOString(),
  lots: [
    { id: 'expired', lotNo: '20200101', expiryDate: d(-3), quantity: 2, warehouseId: 'wh-hold' },
    { id: 'soon', lotNo: '20260301', expiryDate: d(3), quantity: 5, warehouseId: 'wh-sales' },
    { id: 'late', lotNo: '20260401', expiryDate: d(30), quantity: 5, warehouseId: 'wh-sales' },
  ],
};

const defaultProps = {
  product: PRODUCT,
  warehouses: MOCK_WAREHOUSES,
  onShip: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

const planRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('ShipFefoModal — 引当プレビュー', () => {
  it('期限の近いロットが引当先として表示される', () => {
    render(<ShipFefoModal {...defaultProps} />);
    const rows = planRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('20260301')).toBeInTheDocument();
  });

  it('数量を増やすと引当先が次のロットへ繰り越される', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    const qtyInput = screen.getByLabelText('出庫数量');
    await user.clear(qtyInput);
    await user.type(qtyInput, '7');

    const rows = planRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('20260301')).toBeInTheDocument();
    expect(within(rows[1]).getByText('20260401')).toBeInTheDocument();
  });

  it('期限切れロットは既定で除外され、その旨が表示される', () => {
    render(<ShipFefoModal {...defaultProps} />);
    expect(screen.getByText(/期限切れロットの 2 は引当対象から除外/)).toBeInTheDocument();
  });

  it('期限切れも含めるとチェックすると期限切れロットから引き当てる', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    await user.click(screen.getByLabelText('期限切れロットも引当対象にする'));

    expect(within(planRows()[0]).getByText('20200101')).toBeInTheDocument();
  });

  it('倉庫を指定するとその倉庫のロットだけが引当対象になる', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    await user.selectOptions(screen.getByLabelText('倉庫'), 'wh-hold');

    // 保留倉庫にあるのは期限切れロットだけなので、既定では引当先がなくなる
    expect(screen.getByText('引き当てられるロットがありません。')).toBeInTheDocument();
  });
});

describe('ShipFefoModal — 在庫不足', () => {
  it('在庫を超える数量では不足を表示し出庫できない', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    const qtyInput = screen.getByLabelText('出庫数量');
    await user.clear(qtyInput);
    await user.type(qtyInput, '15');

    expect(screen.getByText(/在庫が 5 不足しています/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '出庫' })).toBeDisabled();
  });
});

describe('ShipFefoModal — 出庫の実行', () => {
  it('入力した数量と条件で onShip が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    const qtyInput = screen.getByLabelText('出庫数量');
    await user.clear(qtyInput);
    await user.type(qtyInput, '3');
    await user.selectOptions(screen.getByLabelText('出庫区分'), '廃棄');
    await user.click(screen.getByRole('button', { name: '出庫' }));

    expect(defaultProps.onShip).toHaveBeenCalledWith(3, { warehouseId: undefined, includeExpired: false, type: '廃棄' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('キャンセルでは出庫せずに閉じる', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(defaultProps.onShip).not.toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
