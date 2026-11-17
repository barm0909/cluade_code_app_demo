import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseReturnModal } from '../PurchaseReturnModal';
import type { Product, StockTransaction, Supplier, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [{ id: 'wh-sales', name: '販売倉庫', color: '#4caf50' }];
const SUPPLIERS: Supplier[] = [
  { id: 'sup-a', name: '山田乳業', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true },
  { id: 'sup-b', name: '朝日ベーカリー', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true },
];
const PRODUCT: Product = {
  id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, updatedAt: '',
  lots: [{ id: 'l1', lotNo: '20260703', expiryDate: '2026-07-03', quantity: 5, warehouseId: 'wh-sales', unitPrice: 120 }],
};
const INBOUND: StockTransaction = {
  id: 'in1', date: '2026-06-01T03:00:00.000Z', type: '入荷', productId: 'p1', productName: '牛乳', productSku: 'ML-001',
  lotNo: '20260703', quantity: 5, note: '', toWarehouseId: 'wh-sales', unitPrice: 120, supplierId: 'sup-a',
};

describe('PurchaseReturnModal', () => {
  it('入荷したときの仕入先・ロットの原価・在庫全数を初期値にして返品できる', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PurchaseReturnModal product={PRODUCT} lot={PRODUCT.lots[0]} ledger={[INBOUND]} suppliers={SUPPLIERS} warehouses={WAREHOUSES} onSubmit={onSubmit} onClose={() => {}} />);
    expect(screen.getByLabelText('返品先の仕入先')).toHaveValue('sup-a');
    expect(screen.getByLabelText('返品数量')).toHaveValue(5);
    expect(screen.getByLabelText(/返品単価/)).toHaveValue(120);
    expect(screen.getByText(/返品金額 ¥600/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返品する' }));
    expect(onSubmit).toHaveBeenCalledWith({ productId: 'p1', lotId: 'l1', quantity: 5, supplierId: 'sup-a', unitPrice: 120, note: '' });
  });

  it('入荷記録に仕入先がなければ選ぶまで返品できない', async () => {
    const user = userEvent.setup();
    render(<PurchaseReturnModal product={PRODUCT} lot={PRODUCT.lots[0]} ledger={[]} suppliers={SUPPLIERS} warehouses={WAREHOUSES} onSubmit={vi.fn()} onClose={() => {}} />);
    expect(screen.getByText(/返品先を選んでください/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返品する' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('返品先の仕入先'), 'sup-b');
    expect(screen.getByRole('button', { name: '返品する' })).toBeEnabled();
  });

  it('在庫を超える数量は返品できない', async () => {
    const user = userEvent.setup();
    render(<PurchaseReturnModal product={PRODUCT} lot={PRODUCT.lots[0]} ledger={[INBOUND]} suppliers={SUPPLIERS} warehouses={WAREHOUSES} onSubmit={vi.fn()} onClose={() => {}} />);
    const qty = screen.getByLabelText('返品数量');
    await user.clear(qty);
    await user.type(qty, '9');
    expect(screen.getByText('在庫は 5 個です')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返品する' })).toBeDisabled();
  });
});
