import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesView } from '../SalesView';
import { csvExportLabel, DEFAULT_WAREHOUSE_ID } from '../useInventory';
import type { Customer, Product, StockTransaction, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const CUSTOMERS: Customer[] = [
  { id: 'cus-a', name: 'みどりストア', code: 'C-001', contact: '', phone: '', email: '', address: '', note: '', active: true },
  { id: 'cus-b', name: 'さくらカフェ', code: 'C-002', contact: '', phone: '', email: '', address: '', note: '', active: true },
];

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0,
    price: 200, costPrice: 130, updatedAt: new Date().toISOString(),
    lots: [{ id: 'l1', lotNo: '20260610', expiryDate: d(5), quantity: 20, warehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 118 }],
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 0,
    price: 150, costPrice: 90, updatedAt: new Date().toISOString(),
    lots: [{ id: 'l2', lotNo: '20260611', expiryDate: d(2), quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID }],
  },
];

const at = (local: string) => new Date(local).toISOString();

const sale = (over: Partial<StockTransaction> & { id: string }): StockTransaction => ({
  date: at('2026-06-10T09:00:00'),
  type: '売上出庫',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: '20260610',
  quantity: 1,
  note: '売上登録',
  fromWarehouseId: DEFAULT_WAREHOUSE_ID,
  unitPrice: 190,
  costUnitPrice: 118,
  customerId: 'cus-a',
  ...over,
});

const LEDGER: StockTransaction[] = [
  sale({ id: 't1', quantity: 10 }), // 牛乳 1,900円 / 原価 1,180円
  sale({ id: 't2', date: at('2026-06-11T09:00:00'), productId: 'p2', productName: '食パン', productSku: 'BR-001', lotNo: '20260611', quantity: 4, unitPrice: 140, costUnitPrice: 88, customerId: 'cus-b' }),
  sale({ id: 't3', date: at('2026-06-09T09:00:00'), quantity: 2, unitPrice: undefined, costUnitPrice: undefined, customerId: undefined, note: 'FEFO出庫' }),
  { id: 't4', date: at('2026-06-08T09:00:00'), type: '調整出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260610', quantity: 3, note: '', fromWarehouseId: DEFAULT_WAREHOUSE_ID },
];

const defaultProps = {
  ledger: LEDGER,
  products: PRODUCTS,
  customers: CUSTOMERS,
  warehouses: WAREHOUSES,
  onRecordSale: vi.fn(() => ({ allocated: 3, shortage: 0, cost: 354 })),
};

beforeEach(() => { vi.clearAllMocks(); });

const rowCount = () => within(screen.getByRole('table')).getAllByRole('row').length - 1; // ヘッダー行を除く

describe('SalesView — 明細', () => {
  it('売上出庫だけを新しい順に並べる（調整出庫は売上ではない）', () => {
    render(<SalesView {...defaultProps} />);
    expect(rowCount()).toBe(3);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('食パン')).toBeInTheDocument(); // 06-11 が最初
  });

  it('売上高・原価・粗利のサマリを出す', () => {
    render(<SalesView {...defaultProps} />);
    // 1,900 + 560 + 400(概算) = 2,860 / 原価 1,180 + 352 + 260 = 1,792
    expect(screen.getByText('¥2,860')).toBeInTheDocument();
    expect(screen.getByText('¥1,792')).toBeInTheDocument();
    expect(screen.getByText('¥1,068')).toBeInTheDocument();
  });

  it('単価が記録されていない売上は概算として印をつける', () => {
    render(<SalesView {...defaultProps} />);
    expect(screen.getByText('うち概算 1件')).toBeInTheDocument();
    expect(screen.getAllByText('（概算）').length).toBeGreaterThan(0);
  });

  it('売上の記録がないときは案内文を出す', () => {
    render(<SalesView {...defaultProps} ledger={[]} />);
    expect(screen.getByText(/売上の記録がありません/)).toBeInTheDocument();
  });
});

describe('SalesView — 絞り込み', () => {
  it('キーワードで絞り込める', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・得意先で検索/), 'BR-001');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('食パン')).toBeInTheDocument();
  });

  it('得意先で絞り込める', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.selectOptions(screen.getByLabelText('得意先'), 'cus-b');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('1件 / 全3件')).toBeInTheDocument();
  });

  it('得意先なしの売上だけを絞り込める', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.selectOptions(screen.getByLabelText('得意先'), 'none');
    expect(rowCount()).toBe(1);
    expect(screen.getByText('うち概算 1件')).toBeInTheDocument();
  });

  it('条件クリアで全件に戻る', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.type(screen.getByPlaceholderText(/商品名・SKU・得意先で検索/), 'BR-001');
    await user.click(screen.getByRole('button', { name: '条件クリア' }));
    expect(rowCount()).toBe(3);
  });
});

describe('SalesView — 集計の切り替え', () => {
  it('商品別では商品ごとに1行にまとまる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '商品別' }));
    expect(rowCount()).toBe(2);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('牛乳')).toBeInTheDocument(); // 売上高の多い順
  });

  it('得意先別では得意先なしもまとめて並ぶ', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '得意先別' }));
    expect(rowCount()).toBe(3);
    expect(within(screen.getByRole('table')).getByText('得意先なし')).toBeInTheDocument();
  });

  it('日別では日付ごとに1行にまとまる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: '日別' }));
    expect(rowCount()).toBe(3);
  });

  it('CSVボタンは明細と集計で出力内容が変わる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);
    expect(screen.getByRole('button', { name: csvExportLabel('sales') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '商品別' }));
    expect(screen.getByRole('button', { name: csvExportLabel('salesSummary') })).toBeInTheDocument();
  });
});

describe('SalesView — 売上登録', () => {
  it('入力した単価・得意先で onRecordSale が呼ばれる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '+ 売上を登録' }));

    const qty = screen.getByLabelText('数量');
    await user.clear(qty);
    await user.type(qty, '3');
    const price = screen.getByLabelText(/販売単価/);
    await user.clear(price);
    await user.type(price, '180');
    // 絞り込みの「得意先」と区別するため、モーダル側のラベル (得意先 （任意）) で引く
    await user.selectOptions(screen.getByLabelText(/得意先 （任意）/), 'cus-b');
    await user.click(screen.getByRole('button', { name: '売上を登録' }));

    expect(defaultProps.onRecordSale).toHaveBeenCalledWith({
      productId: 'p1',
      quantity: 3,
      unitPrice: 180,
      customerId: 'cus-b',
      warehouseId: undefined,
      includeExpired: false,
      note: '',
    });
  });

  it('販売単価の初期値は選んだ商品の販売定価になる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '+ 売上を登録' }));
    expect(screen.getByLabelText(/販売単価/)).toHaveValue(200); // 牛乳

    await user.selectOptions(screen.getByLabelText('商品'), 'p2');
    expect(screen.getByLabelText(/販売単価/)).toHaveValue(150); // 食パン
  });

  it('在庫が足りないときは登録できない', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '+ 売上を登録' }));
    const qty = screen.getByLabelText('数量');
    await user.clear(qty);
    await user.type(qty, '50');

    expect(screen.getByText(/在庫が 30 不足しています/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '売上を登録' })).toBeDisabled();
  });

  it('登録後に売上金額と粗利を知らせる', async () => {
    const user = userEvent.setup();
    render(<SalesView {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '+ 売上を登録' }));
    const qty = screen.getByLabelText('数量');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('button', { name: '売上を登録' }));

    expect(await screen.findByText(/売上金額 ¥600 \/ 原価 ¥354 \/ 粗利 ¥246/)).toBeInTheDocument();
  });
});
