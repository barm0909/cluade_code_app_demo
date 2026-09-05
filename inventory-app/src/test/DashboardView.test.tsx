import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from '../DashboardView';
import { csvExportLabel, planDisposal } from '../useInventory';
import type { Category, InboundPlan, Product, StockTransaction, Supplier, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const CATEGORIES: Category[] = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
];

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 200, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: 'A1', expiryDate: d(-2), quantity: 4, warehouseId: 'wh-hold' },
      { id: 'l2', lotNo: 'A2', expiryDate: d(3), quantity: 10, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l3', lotNo: 'B1', expiryDate: d(10), quantity: 3, warehouseId: 'wh-sales' },
    ],
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const SUPPLIERS: Supplier[] = [
  { id: 'sp1', name: '山田乳業', code: 'S-001', contact: '', phone: '', email: '', address: '', leadTimeDays: 3, note: '', active: true },
  { id: 'sp2', name: '佐藤製パン', code: 'S-002', contact: '', phone: '', email: '', address: '', leadTimeDays: 5, note: '', active: true },
];

const plan = (over: Partial<InboundPlan> = {}): InboundPlan => ({
  id: 'ip1', productId: 'p2', expectedDate: d(3), quantity: 10, receivedQuantity: 0,
  warehouseId: 'wh-sales', lotNo: '', expiryDate: '', supplierId: 'sp2', unitPrice: 95, note: '',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
});

const sectionTable = (title: string | RegExp) => {
  const section = screen.getByRole('heading', { name: title }).closest('section')!;
  return within(section as HTMLElement).getByRole('table');
};

const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

// 廃棄 (onDispose) / 発注登録 (onCreateOrders) は App 側のミューテータなので、
// ここでは呼ばれた引数だけを見る
const renderDashboard = (overrides: Partial<React.ComponentProps<typeof DashboardView>> = {}) => {
  const onDispose = vi.fn<React.ComponentProps<typeof DashboardView>['onDispose']>(
    lotIds => planDisposal(overrides.products ?? PRODUCTS, lotIds),
  );
  const onCreateOrders = vi.fn<React.ComponentProps<typeof DashboardView>['onCreateOrders']>(
    inputs => inputs.length,
  );
  render(
    <DashboardView
      products={PRODUCTS}
      categories={CATEGORIES}
      warehouses={WAREHOUSES}
      ledger={[]}
      suppliers={SUPPLIERS}
      inboundPlans={[]}
      onDispose={onDispose}
      onCreateOrders={onCreateOrders}
      {...overrides}
    />,
  );
  return { onDispose, onCreateOrders };
};

describe('DashboardView', () => {
  it('商品が0件のときは案内文だけを出す', () => {
    renderDashboard({ products: [] });
    expect(screen.getByText(/商品が登録されていません/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('在庫金額と件数のサマリを表示する', () => {
    renderDashboard();
    expect(screen.getByText(`¥${(14 * 130 + 3 * 90).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(`売価 ¥${(14 * 200 + 3 * 150).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('2商品 / 3ロット')).toBeInTheDocument();
  });

  it('発注提案に発注点以下の商品と推奨発注数を出す', () => {
    renderDashboard();
    const rows = bodyRows(sectionTable(/発注提案/));
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('食パン')).toBeInTheDocument();
    expect(within(rows[0]).getByText('パン')).toBeInTheDocument();
    // 発注点5の2倍 = 10 まで戻す → 在庫3 なので 7個・原価90 で ¥630
    expect(within(rows[0]).getByLabelText('食パンの発注数')).toHaveValue(7);
    expect(screen.getByText('発注見込金額 ¥630')).toBeInTheDocument();
  });

  it('発注点を下回る商品がなければ案内文を出し、CSVボタンを無効にする', () => {
    const enough: Product[] = [{ ...PRODUCTS[0], minQuantity: 1 }];
    renderDashboard({ products: enough });
    expect(screen.getByText(/発注点を下回っている商品はありません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: csvExportLabel('reorder') })).toBeDisabled();
  });

  it('目標在庫の倍率を変えると推奨発注数が変わる', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.selectOptions(screen.getByLabelText(/目標在庫/), '1');
    expect(screen.getByLabelText('食パンの発注数')).toHaveValue(2); // 発注点5 - 在庫3
  });

  it('入荷予定の残数を差し引き、発注済みの商品は推奨発注数が0になる', () => {
    renderDashboard({ inboundPlans: [plan({ quantity: 10, receivedQuantity: 0 })] });
    const row = bodyRows(sectionTable(/発注提案/))[0];
    expect(within(row).getByText('発注済 10')).toBeInTheDocument();
    expect(within(row).getByLabelText('食パンの発注数')).toHaveValue(0);
    expect(screen.getByRole('button', { name: /発注が要る商品を選択（0件）/ })).toBeDisabled();
  });

  it('キャンセル済みの入荷予定は残数に数えない', () => {
    renderDashboard({ inboundPlans: [plan({ canceledAt: '2026-08-02T00:00:00.000Z' })] });
    expect(within(bodyRows(sectionTable(/発注提案/))[0]).getByLabelText('食パンの発注数')).toHaveValue(7);
  });

  it('選択して発注登録すると、入荷予定の入力値が onCreateOrders に渡る', async () => {
    const user = userEvent.setup();
    const { onCreateOrders } = renderDashboard({ inboundPlans: [plan({ quantity: 10, receivedQuantity: 10 })] });

    // 過去の入荷予定から仕入先・仕入単価を引き継ぐ (入荷済みなので残数は 0)
    expect(screen.getByLabelText('食パンの仕入先')).toHaveValue('sp2');

    await user.click(screen.getByRole('button', { name: /発注が要る商品を選択（1件）/ }));
    await user.click(screen.getByRole('button', { name: /選択した商品を発注登録（1件）/ }));
    expect(screen.getByText(/1商品（合計7個・¥665）の入荷予定を作成します/)).toBeInTheDocument(); // 7 × 95

    await user.click(screen.getByRole('button', { name: '発注登録する' }));
    expect(onCreateOrders).toHaveBeenCalledTimes(1);
    expect(onCreateOrders.mock.calls[0][0]).toEqual([
      expect.objectContaining({ productId: 'p2', quantity: 7, supplierId: 'sp2', unitPrice: 95, warehouseId: 'wh-sales', note: '発注提案' }),
    ]);
    expect(await screen.findByText(/1件の入荷予定を作成しました/)).toBeInTheDocument();
  });

  it('発注数を書き換えるとその行が選択され、書き換えた数量で登録される', async () => {
    const user = userEvent.setup();
    const { onCreateOrders } = renderDashboard();

    const qty = screen.getByLabelText('食パンの発注数');
    await user.clear(qty);
    await user.type(qty, '12');
    expect(screen.getByLabelText('食パンを発注する')).toBeChecked();

    await user.click(screen.getByRole('button', { name: /選択した商品を発注登録（1件）/ }));
    await user.click(screen.getByRole('button', { name: '発注登録する' }));
    expect(onCreateOrders.mock.calls[0][0][0]).toMatchObject({ quantity: 12 });
  });

  it('仕入先を選び直すと入荷予定日がその仕入先のリードタイムで引き直される', async () => {
    const user = userEvent.setup();
    const { onCreateOrders } = renderDashboard();

    await user.selectOptions(screen.getByLabelText('食パンの仕入先'), 'sp1'); // リードタイム3日
    await user.click(screen.getByRole('button', { name: /選択した商品を発注登録（1件）/ }));
    await user.click(screen.getByRole('button', { name: '発注登録する' }));
    expect(onCreateOrders.mock.calls[0][0][0]).toMatchObject({ supplierId: 'sp1', expectedDate: d(3) });
  });

  it('発注登録をキャンセルすると何も作られない', async () => {
    const user = userEvent.setup();
    const { onCreateOrders } = renderDashboard();

    await user.click(screen.getByLabelText('食パンを発注する'));
    await user.click(screen.getByRole('button', { name: /選択した商品を発注登録（1件）/ }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCreateOrders).not.toHaveBeenCalled();
  });

  it('期限アラートは既定で7日以内、表示範囲を広げると対象が増える', async () => {
    const user = userEvent.setup();
    renderDashboard();
    expect(bodyRows(sectionTable('期限アラート'))).toHaveLength(2); // A1 (期限切れ) と A2 (3日後)

    await user.selectOptions(screen.getByLabelText(/表示範囲/), '14');
    const rows = bodyRows(sectionTable('期限アラート'));
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('2日経過')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3日後')).toBeInTheDocument();
    expect(within(rows[2]).getByText('10日後')).toBeInTheDocument();
  });

  it('期限切れを選択して廃棄すると、選んだロットだけが onDispose に渡る', async () => {
    const user = userEvent.setup();
    const { onDispose } = renderDashboard();

    await user.click(screen.getByRole('button', { name: /期限切れを選択（1件）/ }));
    expect(screen.getByRole('button', { name: /選択したロットを廃棄（1件）/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /選択したロットを廃棄（1件）/ }));
    // 確認ダイアログに廃棄する数量とロス金額が出る (牛乳 A1: 4個 × 原価130)
    expect(screen.getByText(/1ロット（4個・¥520）を廃棄します/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '廃棄する' }));
    expect(onDispose).toHaveBeenCalledWith(['l1']);
    expect(await screen.findByText(/1ロット（4個）を廃棄しました/)).toBeInTheDocument();
  });

  it('確認ダイアログでキャンセルすると廃棄されない', async () => {
    const user = userEvent.setup();
    const { onDispose } = renderDashboard();

    await user.click(screen.getByLabelText('牛乳 ロットA1 を選択'));
    await user.click(screen.getByRole('button', { name: /選択したロットを廃棄（1件）/ }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onDispose).not.toHaveBeenCalled();
  });

  it('期限内のロットを選ぶと確認ダイアログで注意を出す', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByLabelText('牛乳 ロットA2 を選択')); // 3日後 = 期限内
    await user.click(screen.getByRole('button', { name: /選択したロットを廃棄（1件）/ }));

    expect(screen.getByText(/まだ期限の来ていないロットが含まれています/)).toBeInTheDocument();
  });

  it('表示範囲を狭めて隠れた行は廃棄対象から外れる', async () => {
    const user = userEvent.setup();
    const { onDispose } = renderDashboard();

    await user.selectOptions(screen.getByLabelText(/表示範囲/), '14');
    await user.click(screen.getByLabelText('すべてのロットを選択')); // 3ロット
    expect(screen.getByRole('button', { name: /選択したロットを廃棄（3件）/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/表示範囲/), '7'); // 食パン(10日後)が隠れる
    await user.click(screen.getByRole('button', { name: /選択したロットを廃棄（2件）/ }));
    await user.click(screen.getByRole('button', { name: '廃棄する' }));

    expect(onDispose).toHaveBeenCalledWith(['l1', 'l2']);
  });

  it('廃棄ロスを帳票から商品別に集計する', () => {
    const today = new Date().toISOString();
    const ledger: StockTransaction[] = [
      { id: 't1', date: today, type: '廃棄', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'A1', quantity: 4, note: '一括廃棄', fromWarehouseId: 'wh-hold' },
      { id: 't2', date: today, type: '廃棄', productId: 'p2', productName: '食パン', productSku: 'BR-001', lotNo: 'B1', quantity: 2, note: '', fromWarehouseId: 'wh-sales' },
      { id: 't3', date: today, type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'A2', quantity: 5, note: '', fromWarehouseId: 'wh-sales' },
    ];
    renderDashboard({ ledger });

    const rows = bodyRows(sectionTable(/廃棄ロス/));
    expect(rows).toHaveLength(2); // 売上出庫は集計対象外
    expect(within(rows[0]).getByText('牛乳')).toBeInTheDocument();
    expect(within(rows[0]).getByText('¥520')).toBeInTheDocument(); // 4 × 130
    expect(within(rows[1]).getByText('¥180')).toBeInTheDocument(); // 2 × 90
    expect(screen.getByText('廃棄ロス金額 ¥700（2件 / 6個）')).toBeInTheDocument();
    expect(screen.getByText('2件 / 6個')).toBeInTheDocument(); // サマリカード (今月)
  });

  it('廃棄がなければ案内文を出し、CSVボタンを無効にする', () => {
    renderDashboard();
    expect(screen.getByText('今月の廃棄はありません。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: csvExportLabel('disposal') })).toBeDisabled();
  });

  it('倉庫別・カテゴリ別サマリを構成比つきで表示する', () => {
    renderDashboard();
    const whRows = bodyRows(sectionTable('倉庫別在庫'));
    expect(within(whRows[0]).getByText('販売倉庫')).toBeInTheDocument();
    expect(within(whRows[0]).getByText('¥1,570')).toBeInTheDocument(); // 10*130 + 3*90
    expect(within(whRows[1]).getByText('¥520')).toBeInTheDocument(); // 4*130

    const catRows = bodyRows(sectionTable('カテゴリ別在庫'));
    expect(within(catRows[0]).getByText('乳製品')).toBeInTheDocument();
    expect(within(catRows[0]).getByText('¥1,820')).toBeInTheDocument();
    expect(within(catRows[0]).getByText('87.1%')).toBeInTheDocument(); // 1820 / 2090
  });
});
