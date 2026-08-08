import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from '../DashboardView';
import type { Category, Product, Warehouse } from '../useInventory';

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

const sectionTable = (title: string | RegExp) => {
  const section = screen.getByRole('heading', { name: title }).closest('section')!;
  return within(section as HTMLElement).getByRole('table');
};

const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

describe('DashboardView', () => {
  it('商品が0件のときは案内文だけを出す', () => {
    render(<DashboardView products={[]} categories={CATEGORIES} warehouses={WAREHOUSES} />);
    expect(screen.getByText(/商品が登録されていません/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('在庫金額と件数のサマリを表示する', () => {
    render(<DashboardView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} />);
    expect(screen.getByText(`¥${(14 * 130 + 3 * 90).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(`売価 ¥${(14 * 200 + 3 * 150).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('2商品 / 3ロット')).toBeInTheDocument();
  });

  it('要発注リストに発注点以下の商品と発注見込金額を出す', () => {
    render(<DashboardView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} />);
    const rows = bodyRows(sectionTable(/要発注リスト/));
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('食パン')).toBeInTheDocument();
    expect(within(rows[0]).getByText('パン')).toBeInTheDocument();
    expect(screen.getByText('発注見込金額 ¥180')).toBeInTheDocument();
  });

  it('発注点を下回る商品がなければ案内文を出し、CSVボタンを無効にする', () => {
    const enough: Product[] = [{ ...PRODUCTS[0], minQuantity: 1 }];
    render(<DashboardView products={enough} categories={CATEGORIES} warehouses={WAREHOUSES} />);
    expect(screen.getByText(/発注点を下回っている商品はありません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSVエクスポート' })).toBeDisabled();
  });

  it('期限アラートは既定で7日以内、表示範囲を広げると対象が増える', async () => {
    const user = userEvent.setup();
    render(<DashboardView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} />);
    expect(bodyRows(sectionTable('期限アラート'))).toHaveLength(2); // A1 (期限切れ) と A2 (3日後)

    await user.selectOptions(screen.getByLabelText(/表示範囲/), '14');
    const rows = bodyRows(sectionTable('期限アラート'));
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('2日経過')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3日後')).toBeInTheDocument();
    expect(within(rows[2]).getByText('10日後')).toBeInTheDocument();
  });

  it('倉庫別・カテゴリ別サマリを構成比つきで表示する', () => {
    render(<DashboardView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} />);
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
