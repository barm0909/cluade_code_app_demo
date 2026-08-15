import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierMasterView } from '../SupplierMasterView';
import type { InboundPlan, Supplier } from '../useInventory';
import { DEFAULT_WAREHOUSE_ID } from '../useInventory';

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const SUPPLIERS: Supplier[] = [
  {
    id: 'sup-yamada', name: '山田乳業', code: 'S-001', contact: '山田 太郎',
    phone: '03-1234-5678', email: 'order@example.jp', address: '東京都', leadTimeDays: 2, note: '定期便', active: true,
  },
  {
    id: 'sup-asahi', name: '朝日ベーカリー', code: 'S-002', contact: '', phone: '', email: '',
    address: '', leadTimeDays: 1, note: '', active: true,
  },
  {
    id: 'sup-old', name: '休止商店', code: 'S-003', contact: '', phone: '', email: '',
    address: '', leadTimeDays: 0, note: '', active: false,
  },
];

// sup-yamada だけが入荷予定 (残数あり・予定日超過) から参照されている状態
const PLANS: InboundPlan[] = [
  {
    id: 'ip1', productId: 'p1', expectedDate: d(-1), quantity: 24, receivedQuantity: 4,
    warehouseId: DEFAULT_WAREHOUSE_ID, lotNo: '20260401', supplierId: 'sup-yamada', note: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const defaultProps = {
  suppliers: SUPPLIERS,
  inboundPlans: PLANS,
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

const supplierRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('SupplierMasterView — 一覧', () => {
  it('仕入先と入荷予定の状況が表示される', () => {
    render(<SupplierMasterView {...defaultProps} />);
    const rows = supplierRows();

    expect(screen.getByText('仕入先マスタ')).toBeInTheDocument();
    expect(rows).toHaveLength(3);
    // 取引中が先 (山田乳業 → 朝日ベーカリー)、取引停止は最後
    expect(within(rows[0]).getByText('山田乳業')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/入荷待ち 1件 \/ 20/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('遅延 1')).toBeInTheDocument();
    expect(within(rows[2]).getByText('取引停止')).toBeInTheDocument();
  });

  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.type(screen.getByPlaceholderText(/仕入先名・コード/), '朝日');

    const rows = supplierRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('朝日ベーカリー')).toBeInTheDocument();
  });

  it('「取引停止も表示」を外すと取引中だけになる', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(screen.getByLabelText('取引停止も表示'));

    expect(supplierRows()).toHaveLength(2);
    expect(screen.queryByText('休止商店')).not.toBeInTheDocument();
  });

  it('仕入先が0件のとき案内が表示される', () => {
    render(<SupplierMasterView {...defaultProps} suppliers={[]} />);
    expect(screen.getByText(/仕入先がありません/)).toBeInTheDocument();
  });
});

describe('SupplierMasterView — 登録・編集', () => {
  it('モーダルから登録すると onAdd に入力が渡る', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(screen.getByText('+ 仕入先追加'));
    await user.type(screen.getByLabelText(/仕入先名/), '新規商店');
    await user.click(screen.getByText('保存'));

    expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '新規商店', active: true }));
  });

  it('仕入先名が空のまま保存するとエラーが出て onAdd は呼ばれない', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(screen.getByText('+ 仕入先追加'));
    await user.click(screen.getByText('保存'));

    expect(screen.getByRole('alert')).toHaveTextContent('仕入先名は必須です');
    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it('既存と同じ名前では保存できない', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(screen.getByText('+ 仕入先追加'));
    await user.type(screen.getByLabelText(/仕入先名/), '山田乳業');
    await user.click(screen.getByText('保存'));

    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前の仕入先がすでにあります');
    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it('編集すると現在の内容が初期表示され、保存で onUpdate が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[0]).getByText('編集'));
    const nameInput = screen.getByLabelText(/仕入先名/);
    expect(nameInput).toHaveValue('山田乳業');
    await user.clear(nameInput);
    await user.type(nameInput, '山田乳業（新）');
    await user.click(screen.getByText('保存'));

    expect(defaultProps.onUpdate).toHaveBeenCalledWith('sup-yamada', expect.objectContaining({ name: '山田乳業（新）' }));
  });

  it('取引停止ボタンは active を反転して onUpdate を呼ぶ', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[0]).getByText('取引停止'));
    expect(defaultProps.onUpdate).toHaveBeenCalledWith('sup-yamada', expect.objectContaining({ active: false }));

    // 取引停止中の行は「取引再開」になる
    await user.click(within(supplierRows()[2]).getByText('取引再開'));
    expect(defaultProps.onUpdate).toHaveBeenLastCalledWith('sup-old', expect.objectContaining({ active: true }));
  });
});

describe('SupplierMasterView — 削除', () => {
  it('入荷予定で使用中の仕入先は削除できない', () => {
    render(<SupplierMasterView {...defaultProps} />);
    const rows = supplierRows();

    expect(within(rows[0]).getByText('削除')).toBeDisabled(); // 山田乳業 (予定あり)
    expect(within(rows[1]).getByText('削除')).toBeEnabled(); // 朝日ベーカリー (予定なし)
  });

  it('未使用の仕入先を削除確認すると onDelete が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[1]).getByText('削除'));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('仕入先「朝日ベーカリー」を削除しますか？');
    await user.click(within(dialog).getByRole('button', { name: '削除' }));

    expect(defaultProps.onDelete).toHaveBeenCalledWith('sup-asahi');
  });

  it('削除確認をキャンセルすると onDelete は呼ばれない', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[1]).getByText('削除'));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル' }));

    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });
});
