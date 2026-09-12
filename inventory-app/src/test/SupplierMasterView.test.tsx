import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierMasterView } from '../SupplierMasterView';
import type { InboundPlan, Product, Supplier, Warehouse } from '../useInventory';
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
    warehouseId: DEFAULT_WAREHOUSE_ID, lotNo: '20260401', supplierId: 'sup-yamada', unitPrice: 120, note: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', lots: [], minQuantity: 0, price: 200, costPrice: 120, updatedAt: '2026-01-01T00:00:00.000Z' },
];

const WAREHOUSES: Warehouse[] = [{ id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' }];

const defaultProps = {
  suppliers: SUPPLIERS,
  inboundPlans: PLANS,
  products: PRODUCTS,
  warehouses: WAREHOUSES,
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onAddInboundPlan: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

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

describe('SupplierMasterView — 発注書', () => {
  it('入荷待ちがない仕入先でも発注書ボタンから開ける (新規発注を作るため)', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    // 朝日ベーカリー (入荷予定なし)
    expect(within(supplierRows()[1]).getByText('発注書')).toBeEnabled();
    await user.click(within(supplierRows()[1]).getByText('発注書'));

    expect(screen.getByText('発注書 — 朝日ベーカリー')).toBeInTheDocument();
    expect(screen.getByText('発注が必要な入荷予定がありません。')).toBeInTheDocument();
  });

  it('入荷待ちの予定から明細を組んだ発注書が開く', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[0]).getByText('発注書')); // 山田乳業

    expect(screen.getByText('発注書 — 山田乳業')).toBeInTheDocument();
    expect(screen.getByText('山田乳業 御中')).toBeInTheDocument();
    expect(screen.getByText('牛乳')).toBeInTheDocument();
    // 予定24・入荷済4 → 残20、単価120 → 金額2,400円 (合計行にも同じ数量・金額が出る)
    expect(screen.getAllByText('20')).toHaveLength(2);
    expect(screen.getByText('¥120')).toBeInTheDocument();
    expect(screen.getAllByText(/2,400/)).toHaveLength(2);
  });

  it('閉じるボタンでモーダルが消える', async () => {
    const user = userEvent.setup();
    render(<SupplierMasterView {...defaultProps} />);

    await user.click(within(supplierRows()[0]).getByText('発注書'));
    await user.click(screen.getByText('閉じる'));

    expect(screen.queryByText('発注書 — 山田乳業')).not.toBeInTheDocument();
  });

  it('明細を追加すると onAddInboundPlan が呼ばれ、その場でプレビューに反映される', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SupplierMasterView {...defaultProps} />);

    // 朝日ベーカリー (もともと入荷予定なし) に新規の明細を追加する
    await user.click(within(supplierRows()[1]).getByText('発注書'));
    await user.type(screen.getByLabelText('数量'), '10');
    await user.type(screen.getByLabelText(/仕入単価/), '50');
    await user.click(screen.getByText('+ 明細を追加'));

    expect(defaultProps.onAddInboundPlan).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'p1', quantity: 10, unitPrice: 50, supplierId: 'sup-asahi', lotNo: '', warehouseId: DEFAULT_WAREHOUSE_ID,
    }));

    // 実際のアプリでは onAddInboundPlan が inboundPlans を更新して再レンダーされる。
    // ここではその結果を模して、追加された予定込みで再レンダーし、プレビューに出ることを確認する
    const newPlan: InboundPlan = {
      id: 'ip-new', productId: 'p1', expectedDate: d(2), quantity: 10, receivedQuantity: 0,
      warehouseId: DEFAULT_WAREHOUSE_ID, lotNo: '', supplierId: 'sup-asahi', unitPrice: 50, note: '',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    };
    rerender(<SupplierMasterView {...defaultProps} inboundPlans={[...PLANS, newPlan]} />);

    expect(screen.queryByText('発注が必要な入荷予定がありません。')).not.toBeInTheDocument();
    // 10 × 50円 = 500円 (明細行・合計行の両方に出る)
    expect(screen.getAllByText('¥500')).toHaveLength(2);
  });
});
