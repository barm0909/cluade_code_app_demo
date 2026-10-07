import { useMemo, useState } from 'react';
import type { Product, SalesOrder, ShipOrderInput, Warehouse } from './useInventory';
import { planSalesOrderShipment, productTaxRate, remainingShipment, saleAmounts, salesOrderShipmentNote, taxRateLabel } from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';
import { NumberInput } from './NumberInput';

interface Props {
  order: SalesOrder;
  product: Product;
  customerName: string;
  warehouses: Warehouse[];
  onShip: (input: ShipOrderInput) => void;
  onClose: () => void;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

/**
 * 受注の出荷モーダル。数量 (既定は受注残) を入れると、賞味期限の近いロットから自動で引き当てて
 * 売上出庫する。プレビューは shipSalesOrder と同じ planSalesOrderShipment なので、表示どおりのロットが出る。
 * 金額は受注単価で計算する (未入力なら販売定価で概算されることを表示する)。
 */
export function ShipSalesOrderModal({ order, product, customerName, warehouses, onShip, onClose }: Props) {
  const remaining = remainingShipment(order);
  const [qty, setQty] = useState(remaining);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [note, setNote] = useState('');

  const plan = useMemo(
    () => planSalesOrderShipment(order, product, { quantity: qty, includeExpired }),
    [order, product, qty, includeExpired],
  );

  const taxRate = productTaxRate(product);
  const estimated = order.unitPrice <= 0;
  const unitPrice = estimated ? product.price : order.unitPrice;
  const { amount, tax, amountWithTax } = saleAmounts(plan.allocations.map(a => a.quantity), unitPrice, taxRate);
  const profit = amount - plan.cost;
  const valid = qty > 0 && qty <= remaining && plan.shortage === 0;
  const warehouse = warehouses.find(w => w.id === order.warehouseId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onShip({ quantity: qty, includeExpired, note });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>受注を出荷</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="move-lot-info">
              <strong>{customerName || '（削除された得意先）'}</strong> — {product.name}（{product.sku}）<br />
              出荷予定日 {order.expectedDate} ／ 受注 {order.quantity}・出荷済 {order.shippedQuantity}・残 {remaining}<br />
              出荷元: {warehouse ? <WarehouseDot warehouse={warehouse} /> : '全倉庫'}
              ／ 受注単価 {estimated ? `未入力（販売定価 ${yen(product.price)} で概算）` : yen(order.unitPrice)}（税抜・税率 {taxRateLabel(taxRate)}）
            </p>
            <div className="form-grid">
              <label htmlFor="ship-qty">
                出荷数量 <span className="label-hint">（受注残 {remaining} まで）</span>
                <NumberInput id="ship-qty" min={1} max={remaining} required value={qty} onValueChange={setQty} />
              </label>
              <label htmlFor="ship-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="ship-note" value={note} onChange={e => setNote(e.target.value)} placeholder={`空欄なら「${salesOrderShipmentNote(customerName)}」と記録されます`} />
              </label>
            </div>

            <label className="fefo-check" htmlFor="ship-expired">
              <input id="ship-expired" type="checkbox" checked={includeExpired} onChange={e => setIncludeExpired(e.target.checked)} />
              期限切れロットも引当対象にする
            </label>

            <div className="fefo-plan">
              <div className="fefo-plan-head">引当プレビュー</div>
              {plan.allocations.length === 0 ? (
                <p className="lot-empty">引き当てられるロットがありません。</p>
              ) : (
                <table className="lot-table">
                  <thead>
                    <tr>
                      <th>ロットNo</th>
                      <th>賞味期限</th>
                      <th>倉庫</th>
                      <th style={{ textAlign: 'right' }}>引当数</th>
                      <th style={{ textAlign: 'right' }}>原価</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.allocations.map(a => (
                      <tr key={a.lotId}>
                        <td className="mono">{a.lotNo}</td>
                        <td><ExpiryBadge expiryDate={a.expiryDate} /></td>
                        <td><WarehouseDot warehouse={warehouses.find(w => w.id === a.warehouseId)} /></td>
                        <td style={{ textAlign: 'right' }}>{a.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{yen(a.unitCost * a.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {qty > remaining && (
                <p className="fefo-shortage">受注残（{remaining}）を超えて出荷することはできません。</p>
              )}
              {plan.shortage > 0 && (
                <p className="fefo-shortage">在庫が {plan.shortage} 不足しています。出荷数量を減らして分割出荷するか、入荷を待ってください。</p>
              )}
              {plan.skippedExpired > 0 && (
                <p className="fefo-note">期限切れロットの {plan.skippedExpired} は引当対象から除外しています。</p>
              )}
            </div>

            <div className="sale-preview">
              <span>売上金額（税抜） <strong>{yen(amount)}</strong></span>
              <span>消費税 {yen(tax)}</span>
              <span>税込 <strong>{yen(amountWithTax)}</strong></span>
              <span>原価 {yen(plan.cost)}</span>
              <span className={profit >= 0 ? 'qty-in' : 'qty-out'}>
                粗利 {yen(profit)}（{amount > 0 ? ((profit / amount) * 100).toFixed(1) : '0.0'}%）
              </span>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!valid}>出荷する</button>
          </div>
        </form>
      </div>
    </div>
  );
}
