import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StockAnalysisView } from '../StockAnalysisView';
import type { Category, Product, StockTransaction } from '../useInventory';

const CATEGORIES: Category[] = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
];

// 出庫の集計は実時刻を基準にするので、帳票の日付は「今日から何日前か」で組み立てる
const daysAgo = (n: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - n);
  return dt.toISOString();
};

// 牛乳: 在庫30 (原価100) / 直近90日で150個出庫 → 出庫金額15,000
// 食パン: 在庫10 (原価50) / 直近90日で40個出庫 → 出庫金額2,000
// チーズ: 在庫5 (原価200) / 最後の出庫は200日前 → 滞留
const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 200, costPrice: 100,
    lots: [{ id: 'l1', lotNo: 'A1', quantity: 30, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'p2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread', minQuantity: 20, price: 150, costPrice: 50,
    lots: [{ id: 'l2', lotNo: 'B1', quantity: 10, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'p3', name: 'チーズ', sku: 'CS-001', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 200,
    lots: [{ id: 'l3', lotNo: 'C1', quantity: 5, warehouseId: 'wh-sales' }],
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

const t = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id' | 'date' | 'type' | 'productId' | 'quantity'>): StockTransaction => ({
  productName: '', productSku: '', lotNo: '', note: '', ...over,
});

const LEDGER: StockTransaction[] = [
  t({ id: 't1', date: daysAgo(10), type: '売上出庫', productId: 'p1', quantity: 90 }),
  t({ id: 't2', date: daysAgo(40), type: '売上出庫', productId: 'p1', quantity: 60 }),
  t({ id: 't3', date: daysAgo(5), type: '売上出庫', productId: 'p2', quantity: 40 }),
  t({ id: 't4', date: daysAgo(200), type: '売上出庫', productId: 'p3', quantity: 5 }),
];

const sectionTable = (title: string | RegExp) => {
  const section = screen.getByRole('heading', { name: title }).closest('section')!;
  return within(section as HTMLElement).getByRole('table');
};
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

const renderView = (overrides: Partial<React.ComponentProps<typeof StockAnalysisView>> = {}) => {
  const onApplyMinQuantities = vi.fn<React.ComponentProps<typeof StockAnalysisView>['onApplyMinQuantities']>(
    updates => updates.length,
  );
  render(
    <StockAnalysisView
      products={PRODUCTS}
      categories={CATEGORIES}
      ledger={LEDGER}
      inboundPlans={[]}
      suppliers={[]}
      onApplyMinQuantities={onApplyMinQuantities}
      {...overrides}
    />,
  );
  return { onApplyMinQuantities };
};

describe('StockAnalysisView — ABC分析', () => {
  it('商品が0件のときは案内文だけを出す', () => {
    renderView({ products: [] });
    expect(screen.getByText(/商品が登録されていません/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('出庫金額の大きい順に並び、ランクのバッジが付く', () => {
    renderView();
    const rows = bodyRows(sectionTable(/ABC分析/));
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('牛乳')).toBeInTheDocument();
    expect(within(rows[0]).getByText('A')).toBeInTheDocument();
    expect(within(rows[1]).getByText('食パン')).toBeInTheDocument();
    expect(within(rows[1]).getByText('B')).toBeInTheDocument();
    expect(within(rows[2]).getByText('チーズ')).toBeInTheDocument();
    expect(within(rows[2]).getByText('C')).toBeInTheDocument();
  });

  it('キーワード・カテゴリ・ランクで絞り込める', async () => {
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByPlaceholderText(/商品名・SKUで検索/), 'ML-001');
    expect(bodyRows(sectionTable(/ABC分析/))).toHaveLength(1);

    await user.clear(screen.getByPlaceholderText(/商品名・SKUで検索/));
    await user.selectOptions(screen.getByLabelText('カテゴリ'), 'cat-bread');
    expect(bodyRows(sectionTable(/ABC分析/))).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '条件クリア' }));
    await user.selectOptions(screen.getByLabelText('ABCランク'), 'C');
    const rows = bodyRows(sectionTable(/ABC分析/));
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('チーズ')).toBeInTheDocument();
  });

  it('集計期間を変えると出庫の集計も変わる', async () => {
    const user = userEvent.setup();
    renderView();
    // 直近30日にすると 40日前の60個が外れ、牛乳の出庫は90個になる
    await user.selectOptions(screen.getByLabelText('集計期間'), '30');
    const row = within(sectionTable(/ABC分析/)).getByText('牛乳').closest('tr')!;
    expect(within(row).getByText('90')).toBeInTheDocument();
  });
});

describe('StockAnalysisView — 滞留在庫', () => {
  it('しきい値以上動いていない商品を並べる', () => {
    renderView();
    const rows = bodyRows(sectionTable(/滞留在庫/));
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('チーズ')).toBeInTheDocument();
    expect(within(rows[0]).getByText('200日')).toBeInTheDocument();
  });

  it('出庫実績のない商品は「出庫なし」として滞留に出る', () => {
    renderView({ ledger: [] });
    const rows = bodyRows(sectionTable(/滞留在庫/));
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getAllByText('出庫なし').length).toBeGreaterThan(0);
  });

  it('しきい値を変えると対象が変わる', async () => {
    const user = userEvent.setup();
    renderView();
    await user.selectOptions(screen.getByLabelText('判定'), '30');
    expect(bodyRows(sectionTable(/滞留在庫/))).toHaveLength(1); // 牛乳(10日前)・食パン(5日前)はまだ入らない
  });
});

describe('StockAnalysisView — 発注点の見直し提案', () => {
  it('出庫ペースから提案値を出し、出庫のない商品は対象外にする', () => {
    renderView();
    const rows = bodyRows(sectionTable(/発注点の見直し提案/));
    // 食パン: ceil(0.444 × 7) = 4 (現在20 → -16) / 牛乳: ceil(1.667 × 7) = 12 (現在5 → +7)
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('食パン')).toBeInTheDocument();
    expect(within(rows[1]).getByText('牛乳')).toBeInTheDocument();
    expect(within(sectionTable(/発注点の見直し提案/)).queryByText('チーズ')).not.toBeInTheDocument();
  });

  it('安全在庫日数を変えると提案値が変わる', async () => {
    const user = userEvent.setup();
    renderView();
    await user.selectOptions(screen.getByLabelText('安全在庫'), '14');
    const row = within(sectionTable(/発注点の見直し提案/)).getByText('牛乳').closest('tr')!;
    expect(within(row).getByText('24')).toBeInTheDocument(); // ceil(1.667 × 14)
  });

  it('選択して反映すると、提案値が onApplyMinQuantities に渡る', async () => {
    const user = userEvent.setup();
    const { onApplyMinQuantities } = renderView();

    await user.click(screen.getByRole('button', { name: /すべて選択（2件）/ }));
    await user.click(screen.getByRole('button', { name: /選択した2件を反映/ }));
    expect(screen.getByText(/2商品の発注点（最低在庫数）を提案値に更新します/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更新する' }));
    expect(onApplyMinQuantities).toHaveBeenCalledTimes(1);
    expect(onApplyMinQuantities.mock.calls[0][0]).toEqual([
      { productId: 'p2', minQuantity: 4 },
      { productId: 'p1', minQuantity: 12 },
    ]);
    expect(await screen.findByText(/2商品の発注点を更新しました/)).toBeInTheDocument();
  });

  it('確認ダイアログをキャンセルすると何も更新しない', async () => {
    const user = userEvent.setup();
    const { onApplyMinQuantities } = renderView();

    await user.click(screen.getByLabelText('牛乳を選択'));
    await user.click(screen.getByRole('button', { name: /選択した1件を反映/ }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onApplyMinQuantities).not.toHaveBeenCalled();
  });

  it('何も選択していなければ反映ボタンは押せない', () => {
    renderView();
    expect(screen.getByRole('button', { name: /選択した0件を反映/ })).toBeDisabled();
  });
});
