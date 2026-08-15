import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LotTraceView } from '../LotTraceView';
import type { LotTraceKey, Product, StockTransaction, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

const at = (local: string) => new Date(local).toISOString();

// 新しい順 (帳票の並び)。牛乳 20260701: 入荷20 → 5移動 → 8出庫
const LEDGER: StockTransaction[] = [
  { id: 't3', date: at('2026-06-23T15:00:00'), type: '売上出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260701', quantity: 8, note: 'FEFO出庫', fromWarehouseId: 'wh-sales' },
  { id: 't2', date: at('2026-06-22T11:00:00'), type: '移動', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260701', quantity: 5, note: '倉庫移動', fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold' },
  { id: 't1', date: at('2026-06-20T10:00:00'), type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: '20260701', quantity: 20, note: 'ロット追加', toWarehouseId: 'wh-sales' },
];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: '20260701', expiryDate: '2026-07-01', quantity: 7, warehouseId: 'wh-sales' },
      { id: 'l2', lotNo: '20260701', expiryDate: '2026-07-01', quantity: 5, warehouseId: 'wh-hold' },
    ],
    updatedAt: at('2026-06-23T15:00:00'),
  },
  {
    id: 'p2', name: 'チーズ', sku: 'CS-001', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 220,
    lots: [{ id: 'l3', lotNo: '20260615', quantity: 4, warehouseId: 'wh-sales' }],
    updatedAt: at('2026-06-15T10:00:00'),
  },
];

const MILK: LotTraceKey = { productId: 'p1', lotNo: '20260701' };

function renderView(over: Partial<Parameters<typeof LotTraceView>[0]> = {}) {
  const onTargetChange = vi.fn();
  render(
    <LotTraceView
      products={PRODUCTS}
      warehouses={WAREHOUSES}
      ledger={LEDGER}
      target={null}
      onTargetChange={onTargetChange}
      {...over}
    />,
  );
  return { onTargetChange };
}

const bodyRows = () => within(screen.getAllByRole('table')[0]).getAllByRole('row').length - 1;

describe('LotTraceView — ロットの選択', () => {
  it('追跡できるロットの候補が並ぶ', () => {
    renderView();
    expect(bodyRows()).toBe(2);
    expect(screen.getByText('2件')).toBeInTheDocument();
  });

  it('キーワードでロットNo・商品名・SKUを絞り込める', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByPlaceholderText(/ロットNo・商品名・SKUで検索/), 'CS-001');
    expect(bodyRows()).toBe(1);
    expect(screen.getByText('チーズ')).toBeInTheDocument();
  });

  it('一致するロットがなければ案内を出す', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByPlaceholderText(/ロットNo・商品名・SKUで検索/), 'ないロット');
    expect(screen.getByText('条件に一致するロットがありません。')).toBeInTheDocument();
  });

  it('「追跡」を押すと商品IDとロットNoの組が通知される', async () => {
    const user = userEvent.setup();
    const { onTargetChange } = renderView();
    await user.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: '追跡' }));
    expect(onTargetChange).toHaveBeenCalledWith(MILK);
  });
});

describe('LotTraceView — 履歴', () => {
  it('入荷→移動→出庫を古い順のカードで表示する', () => {
    renderView({ target: MILK });
    const events = screen.getAllByRole('listitem');
    expect(events).toHaveLength(3);
    expect(within(events[0]).getByText('入荷')).toBeInTheDocument();
    expect(within(events[1]).getByText('移動')).toBeInTheDocument();
    expect(within(events[2]).getByText('売上出庫')).toBeInTheDocument();
    // 残数の推移 (20 → 20 → 12)
    expect(within(events[0]).getByText('残 20')).toBeInTheDocument();
    expect(within(events[2]).getByText('残 12')).toBeInTheDocument();
  });

  it('移動は移動元と移動先の両方の倉庫を出す', () => {
    renderView({ target: MILK });
    const move = screen.getAllByRole('listitem')[1];
    expect(within(move).getByText('販売倉庫')).toBeInTheDocument();
    expect(within(move).getByText('保留倉庫')).toBeInTheDocument();
  });

  it('入庫合計・出庫合計・帳票上の残数・現在庫を集計して出す', () => {
    renderView({ target: MILK });
    const statCard = (label: string) => screen.getByText(label).closest('.stat-card') as HTMLElement;
    expect(within(statCard('入庫合計')).getByText('+20')).toBeInTheDocument();
    expect(within(statCard('出庫合計（既に出た数量）')).getByText('-8')).toBeInTheDocument();
    expect(within(statCard('出庫合計（既に出た数量）')).getByText('売上出庫 8')).toBeInTheDocument();
    expect(within(statCard('帳票上の残数')).getByText('12')).toBeInTheDocument();
    expect(within(statCard('現在庫')).getByText('12')).toBeInTheDocument();
    // 帳票上の残数 12 と現在庫 12 が一致するので警告は出ない
    expect(screen.queryByText(/帳票上の残数と現在庫が一致しません/)).not.toBeInTheDocument();
  });

  it('現在の在庫を倉庫ごとに出す', () => {
    renderView({ target: MILK });
    const stockTable = screen.getAllByRole('table')[0];
    expect(within(stockTable).getAllByRole('row')).toHaveLength(3); // ヘッダー + 2倉庫
  });

  it('帳票上の残数と現在庫がずれていれば警告する', () => {
    const products: Product[] = [{ ...PRODUCTS[0], lots: [{ id: 'l1', lotNo: '20260701', quantity: 30, warehouseId: 'wh-sales' }] }];
    renderView({ target: MILK, products });
    expect(screen.getByText(/帳票上の残数と現在庫が一致しません/)).toBeInTheDocument();
  });

  it('帳票に記録のないロットは案内を出す', () => {
    renderView({ target: { productId: 'p2', lotNo: '20260615' } });
    expect(screen.getByText('入出庫の記録がありません。')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('在庫の残っていないロットも履歴を追える', () => {
    renderView({ target: MILK, products: [] });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/このロットの在庫は残っていません/)).toBeInTheDocument();
  });

  it('「ロットの選択に戻る」で追跡を解除する', async () => {
    const user = userEvent.setup();
    const { onTargetChange } = renderView({ target: MILK });
    await user.click(screen.getByRole('button', { name: /ロットの選択に戻る/ }));
    expect(onTargetChange).toHaveBeenCalledWith(null);
  });
});
