import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LedgerView } from '../LedgerView';
import { csvExportLabel } from '../useInventory';
import type { StockTransaction, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const at = (local: string) => new Date(local).toISOString();

const LEDGER: StockTransaction[] = [
  { id: 't1', date: at('2026-06-28T10:00:00'), type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260701', quantity: 10, note: 'ロット追加', toWarehouseId: 'wh-sales' },
  { id: 't2', date: at('2026-06-27T09:00:00'), type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260701', quantity: 3, note: '', fromWarehouseId: 'wh-sales' },
  { id: 't3', date: at('2026-06-25T08:00:00'), type: '廃棄', productId: 'p2', productName: '食パン', productSku: 'BR-001', lotNo: '20260625', quantity: 2, note: '', fromWarehouseId: 'wh-hold' },
];

const rowCount = () => within(screen.getByRole('table')).getAllByRole('row').length - 1; // ヘッダー行を除く

describe('LedgerView — 絞り込み', () => {
  it('記録が0件のときは案内文を表示し、フィルタは出さない', () => {
    render(<LedgerView ledger={[]} warehouses={WAREHOUSES} />);
    expect(screen.getByText(/入出庫の記録がありません/)).toBeInTheDocument();
    expect(screen.queryByLabelText('区分')).not.toBeInTheDocument();
  });

  it('初期表示では全件が並ぶ', () => {
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    expect(rowCount()).toBe(3);
    expect(screen.getByText('3件')).toBeInTheDocument();
  });

  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・ロットNoで検索/), 'BR-001');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });

  it('区分で絞り込める', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.selectOptions(screen.getByLabelText('区分'), '廃棄');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('1件 / 全3件')).toBeInTheDocument();
  });

  it('倉庫で絞り込める', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.selectOptions(screen.getByLabelText('倉庫'), 'wh-hold');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });

  it('期間で絞り込める', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.type(screen.getByLabelText('開始日'), '2026-06-27');
    expect(rowCount()).toBe(2);
    await user.type(screen.getByLabelText('終了日'), '2026-06-27');
    expect(rowCount()).toBe(1);
  });

  it('合計は絞り込み後の件数で計算される', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    expect(screen.getByText('入庫 +10')).toBeInTheDocument();
    expect(screen.getByText('出庫 -5')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('区分'), '廃棄');
    expect(screen.getByText('入庫 +0')).toBeInTheDocument();
    expect(screen.getByText('出庫 -2')).toBeInTheDocument();
  });

  it('一致する記録がないときはテーブルの代わりに案内文を出す', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・ロットNoで検索/), 'チーズ');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('条件に一致する記録がありません。')).toBeInTheDocument();
  });

  it('条件クリアは絞り込み中だけ現れ、押すと全件に戻る', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    expect(screen.queryByRole('button', { name: '条件クリア' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('区分'), '廃棄');
    await user.click(screen.getByRole('button', { name: '条件クリア' }));

    expect(rowCount()).toBe(3);
    expect(screen.queryByRole('button', { name: '条件クリア' })).not.toBeInTheDocument();
  });

  it('入出庫のみの記録でも倉庫名が表示される', () => {
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    const row = screen.getByText('食パン').closest('tr')!;
    expect(within(row).getByText('保留倉庫')).toBeInTheDocument();
  });
});

describe('LedgerView — CSVエクスポート', () => {
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
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.click(screen.getByRole('button', { name: csvExportLabel('ledger') }));
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it('絞り込み結果が0件のときは押せない', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・ロットNoで検索/), 'チーズ');
    expect(screen.getByRole('button', { name: csvExportLabel('ledger') })).toBeDisabled();
  });

  it('出力されるのは絞り込み後の記録だけ', async () => {
    const user = userEvent.setup();
    render(<LedgerView ledger={LEDGER} warehouses={WAREHOUSES} />);
    await user.selectOptions(screen.getByLabelText('区分'), '廃棄');
    await user.click(screen.getByRole('button', { name: csvExportLabel('ledger') }));

    const blob = mockCreateObjectURL.mock.calls.at(-1)![0];
    const text = await blob.text();
    expect(text.split('\n')).toHaveLength(2); // ヘッダー + 廃棄1件
    expect(text).toContain('BR-001');
    expect(text).not.toContain('ML-001');
  });
});
