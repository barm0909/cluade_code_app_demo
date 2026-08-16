import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CostHistoryView } from '../CostHistoryView';
import { csvExportLabel } from '../useInventory';
import type { StockTransaction, Supplier } from '../useInventory';

const SUPPLIERS: Supplier[] = [
  { id: 'sup-yamada', name: '山田乳業', code: 'S-001', contact: '', phone: '', email: '', address: '', leadTimeDays: 2, note: '', active: true },
  { id: 'sup-asahi', name: '朝日ベーカリー', code: 'S-002', contact: '', phone: '', email: '', address: '', leadTimeDays: 1, note: '', active: true },
];

const at = (local: string) => new Date(local).toISOString();

const LEDGER: StockTransaction[] = [
  { id: 't1', date: at('2026-08-01T09:00:00'), type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260901', quantity: 10, note: '', toWarehouseId: 'wh-sales', unitPrice: 118, supplierId: 'sup-yamada' },
  { id: 't2', date: at('2026-08-10T09:00:00'), type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260910', quantity: 10, note: '', toWarehouseId: 'wh-sales', unitPrice: 120, supplierId: 'sup-yamada' },
  { id: 't3', date: at('2026-08-05T09:00:00'), type: '入荷', productId: 'p2', productName: '食パン', productSku: 'BR-001', lotNo: '20260805', quantity: 5, note: '', toWarehouseId: 'wh-sales', unitPrice: 200, supplierId: 'sup-asahi' },
];

const rowCount = () => within(screen.getByRole('table')).getAllByRole('row').length - 1; // ヘッダー行を除く

describe('CostHistoryView — 絞り込み', () => {
  it('記録が0件のときは案内文を表示し、フィルタは出さない', () => {
    render(<CostHistoryView ledger={[]} suppliers={SUPPLIERS} />);
    expect(screen.getByText(/仕入単価の記録がありません/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/商品名・SKU・仕入先で検索/)).not.toBeInTheDocument();
  });

  it('仕入単価0の入荷 (未入力) は表示から除外される', () => {
    const ledger: StockTransaction[] = [
      ...LEDGER,
      { id: 't4', date: at('2026-08-11T09:00:00'), type: '入荷', productId: 'p3', productName: 'ラベル', productSku: 'LB-001', lotNo: '20260811', quantity: 100, note: '', toWarehouseId: 'wh-sales', unitPrice: 0, supplierId: 'sup-yamada' },
    ];
    render(<CostHistoryView ledger={ledger} suppliers={SUPPLIERS} />);
    expect(rowCount()).toBe(3);
    expect(screen.queryByText('ラベル')).not.toBeInTheDocument();
  });

  it('初期表示では新しい順に全件並ぶ', () => {
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    expect(rowCount()).toBe(3);
    expect(screen.getByText('3件')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('牛乳')).toBeInTheDocument(); // t2 (08-10) が最初
  });

  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・仕入先で検索/), 'BR-001');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });

  it('仕入先で絞り込める', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.selectOptions(screen.getByLabelText('仕入先'), 'sup-asahi');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });

  it('期間で絞り込める', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.type(screen.getByLabelText('開始日'), '2026-08-06');
    expect(rowCount()).toBe(1);
  });

  it('前回比のある行にはバッジ、初回は「初回」と表示する', () => {
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    const row = screen.getByText('20260910').closest('tr')!; // t2: 118→120 の値上がり
    expect(within(row).getByText(/▲/)).toBeInTheDocument();
    const firstRow = screen.getByText('20260901').closest('tr')!; // t1: 初回
    expect(within(firstRow).getByText('初回')).toBeInTheDocument();
  });

  it('一致する記録がないときはテーブルの代わりに案内文を出す', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・仕入先で検索/), 'チーズ');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('条件に一致する記録がありません。')).toBeInTheDocument();
  });

  it('条件クリアは絞り込み中だけ現れ、押すと全件に戻る', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    expect(screen.queryByRole('button', { name: '条件クリア' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('仕入先'), 'sup-asahi');
    await user.click(screen.getByRole('button', { name: '条件クリア' }));

    expect(rowCount()).toBe(3);
    expect(screen.queryByRole('button', { name: '条件クリア' })).not.toBeInTheDocument();
  });
});

describe('CostHistoryView — CSVエクスポート', () => {
  const mockClick = vi.fn();
  const mockCreateObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
  const mockRevokeObjectURL = vi.fn();

  beforeEach(() => {
    mockClick.mockClear();
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mockClick);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('ボタンを押すとダウンロードが発火する', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.click(screen.getByRole('button', { name: csvExportLabel('costHistory') }));
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it('絞り込み結果が0件のときは押せない', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・仕入先で検索/), 'チーズ');
    expect(screen.getByRole('button', { name: csvExportLabel('costHistory') })).toBeDisabled();
  });

  it('出力されるのは絞り込み後の記録だけ', async () => {
    const user = userEvent.setup();
    render(<CostHistoryView ledger={LEDGER} suppliers={SUPPLIERS} />);
    await user.selectOptions(screen.getByLabelText('仕入先'), 'sup-asahi');
    await user.click(screen.getByRole('button', { name: csvExportLabel('costHistory') }));

    const blob = mockCreateObjectURL.mock.calls.at(-1)![0];
    const text = await blob.text();
    expect(text.split('\n')).toHaveLength(2); // ヘッダー + 朝日ベーカリー1件
    expect(text).toContain('BR-001');
    expect(text).not.toContain('ML-001');
  });
});
