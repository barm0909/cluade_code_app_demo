import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrderHistoryView } from '../PurchaseOrderHistoryView';
import type { PurchaseOrderPrintItem, Supplier } from '../useInventory';

const SUPPLIERS: Supplier[] = [
  { id: 'sup-yamada', name: '山田商店', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true },
  { id: 'sup-asahi', name: '朝日ベーカリー', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true },
];

const item = (over: Partial<PurchaseOrderPrintItem> & { id: string; printGroupId: string }): PurchaseOrderPrintItem => ({
  printedAt: '2026-03-01T09:00:00.000Z',
  supplierId: 'sup-yamada',
  supplierName: '山田商店',
  supplierAddress: '東京都渋谷区1-1-1',
  supplierContact: '山田 太郎',
  supplierPhone: '03-1234-5678',
  orderDate: '2026-03-01',
  senderName: '自社商店',
  senderAddress: '大阪府大阪市1-1-1',
  senderPhone: '06-0000-0000',
  senderContact: '発注 担当子',
  inboundPlanId: 'ip1',
  productName: '牛乳',
  productSku: 'ML-001',
  expectedDate: '2026-03-05',
  quantity: 10,
  unitPrice: 100,
  amount: 1000,
  ...over,
});

const PRINTS: PurchaseOrderPrintItem[] = [
  item({ id: '1', printGroupId: 'g1', printedAt: '2026-03-01T09:00:00.000Z', supplierId: 'sup-yamada', supplierName: '山田商店' }),
  item({
    id: '2', printGroupId: 'g2', printedAt: '2026-03-10T09:00:00.000Z', supplierId: 'sup-asahi', supplierName: '朝日ベーカリー',
    productName: '食パン', productSku: 'BR-001', quantity: 5, unitPrice: 90, amount: 450, orderDate: '2026-03-10',
  }),
];

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});

describe('PurchaseOrderHistoryView', () => {
  it('印刷履歴が0件のとき案内が表示される', () => {
    render(<PurchaseOrderHistoryView prints={[]} suppliers={SUPPLIERS} />);
    expect(screen.getByText(/発注履歴がありません/)).toBeInTheDocument();
  });

  it('印刷操作 (printGroupId) 単位でまとめて新しい順に一覧する', () => {
    render(<PurchaseOrderHistoryView prints={PRINTS} suppliers={SUPPLIERS} />);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    // 新しい順 (g2 が先)
    expect(within(rows[0]).getByText('朝日ベーカリー')).toBeInTheDocument();
    expect(within(rows[1]).getByText('山田商店')).toBeInTheDocument();
  });

  it('仕入先で絞り込める', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderHistoryView prints={PRINTS} suppliers={SUPPLIERS} />);

    await user.selectOptions(screen.getByLabelText('仕入先'), 'sup-yamada');

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('山田商店')).toBeInTheDocument();
  });

  it('「再表示」で印刷時点のスナップショットのまま発注書を再表示・再印刷できる', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderHistoryView prints={PRINTS} suppliers={SUPPLIERS} />);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    await user.click(within(rows[1]).getByText('再表示')); // 山田商店の発注書

    expect(screen.getByText('発注書（履歴） — 山田商店')).toBeInTheDocument();
    expect(screen.getByText('山田商店 御中')).toBeInTheDocument();
    expect(screen.getByText('東京都渋谷区1-1-1')).toBeInTheDocument();
    expect(screen.getByText('自社商店')).toBeInTheDocument();

    await user.click(screen.getByText('印刷'));
    expect(window.print).toHaveBeenCalled();
  });
});
