import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarehouseMasterView } from '../WarehouseMasterView';
import type { Product, Warehouse } from '../useInventory';

const MOCK_WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

// wh-sales を2ロット、wh-hold を0ロットが参照している状態
const MOCK_PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: '20260101', quantity: 10, warehouseId: 'wh-sales' },
      { id: 'l2', lotNo: '20260201', quantity: 5, warehouseId: 'wh-sales' },
    ],
    updatedAt: new Date().toISOString(),
  },
];

const defaultProps = {
  warehouses: MOCK_WAREHOUSES,
  products: MOCK_PRODUCTS,
  inboundPlans: [],
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe('WarehouseMasterView — 表示', () => {
  it('倉庫一覧と使用ロット数が表示される', () => {
    render(<WarehouseMasterView {...defaultProps} />);
    expect(screen.getByText('倉庫マスタ')).toBeInTheDocument();
    expect(screen.getByText('販売倉庫')).toBeInTheDocument();
    expect(screen.getByText('保留倉庫')).toBeInTheDocument();
    // wh-sales は2ロット、wh-hold は0ロット
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('倉庫が空のとき空メッセージが表示される', () => {
    render(<WarehouseMasterView {...defaultProps} warehouses={[]} />);
    expect(screen.getByText('倉庫がありません')).toBeInTheDocument();
  });
});

describe('WarehouseMasterView — 追加', () => {
  it('倉庫名を入力して追加すると onAdd が呼ばれ入力がクリアされる', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    const input = screen.getByLabelText('新規倉庫名');
    await user.type(input, '冷凍倉庫');
    await user.click(screen.getByText('+ 倉庫追加'));
    expect(defaultProps.onAdd).toHaveBeenCalledWith('冷凍倉庫', expect.stringMatching(/^#[0-9a-f]{6}$/i));
    expect(input).toHaveValue('');
  });

  it('空欄のまま追加しても onAdd は呼ばれない', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.click(screen.getByText('+ 倉庫追加'));
    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it('倉庫名は前後の空白がトリムされて渡される', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.type(screen.getByLabelText('新規倉庫名'), '  冷蔵倉庫  ');
    await user.click(screen.getByText('+ 倉庫追加'));
    expect(defaultProps.onAdd).toHaveBeenCalledWith('冷蔵倉庫', expect.any(String));
  });
});

describe('WarehouseMasterView — 編集', () => {
  it('編集して保存すると onUpdate が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.click(screen.getAllByText('編集')[0]);
    const nameInput = screen.getByLabelText('倉庫名');
    await user.clear(nameInput);
    await user.type(nameInput, '店頭倉庫');
    await user.click(screen.getByText('保存'));
    expect(defaultProps.onUpdate).toHaveBeenCalledWith('wh-sales', '店頭倉庫', '#4caf50');
  });

  it('キャンセルすると onUpdate は呼ばれず表示に戻る', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.click(screen.getAllByText('編集')[0]);
    await user.click(screen.getByText('キャンセル'));
    expect(defaultProps.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('販売倉庫')).toBeInTheDocument();
  });
});

describe('WarehouseMasterView — 削除', () => {
  it('ロット使用中の倉庫の削除ボタンは無効化される', () => {
    render(<WarehouseMasterView {...defaultProps} />);
    const deleteButtons = screen.getAllByText('削除');
    // 1行目 (wh-sales, 2ロット使用中) は無効、2行目 (wh-hold, 未使用) は有効
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeEnabled();
  });

  it('未使用の倉庫を削除確認すると onDelete が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.click(screen.getAllByText('削除')[1]);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('倉庫「保留倉庫」を削除しますか？');
    await user.click(within(dialog).getByRole('button', { name: '削除' }));
    expect(defaultProps.onDelete).toHaveBeenCalledWith('wh-hold');
  });

  it('削除確認をキャンセルすると onDelete は呼ばれない', async () => {
    const user = userEvent.setup();
    render(<WarehouseMasterView {...defaultProps} />);
    await user.click(screen.getAllByText('削除')[1]);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル' }));
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });
});
