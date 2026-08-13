import { useState, useMemo } from 'react';
import type { FefoPlan, OutboundTransactionType, Product, Warehouse } from './useInventory';
import { OUTBOUND_TYPES, planFefoShipment, totalQuantity, totalQuantityByWarehouse } from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';
import { NumberInput } from './NumberInput';

interface Props {
  product: Product;
  warehouses: Warehouse[];
  onShip: (quantity: number, options: { warehouseId?: string; includeExpired: boolean; type: OutboundTransactionType }) => void;
  onClose: () => void;
}

/**
 * FEFO出庫モーダル。商品と数量を指定すると、賞味期限の近いロットから自動で引き当てる。
 * プレビュー表は実際の出庫とまったく同じ planFefoShipment の結果を描いているので、
 * 「確定したら別のロットから引かれた」ということは起こらない。
 */
export function ShipFefoModal({ product, warehouses, onShip, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [warehouseId, setWarehouseId] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [type, setType] = useState<OutboundTransactionType>(OUTBOUND_TYPES[0]);

  const plan: FefoPlan = useMemo(
    () => planFefoShipment(product, qty, { warehouseId: warehouseId || undefined, includeExpired }),
    [product, qty, warehouseId, includeExpired]
  );

  const stock = warehouseId ? totalQuantityByWarehouse(product, warehouseId) : totalQuantity(product);
  const valid = qty > 0 && plan.shortage === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onShip(qty, { warehouseId: warehouseId || undefined, includeExpired, type });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <h2>FEFO出庫</h2>
        <p className="move-lot-info">
          <strong>{product.name}</strong>（{product.sku}）<br />
          賞味期限の近いロットから自動で引き当てます。（対象在庫: {stock}）
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="fefo-warehouse">
            倉庫
            <select id="fefo-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">全倉庫</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label htmlFor="fefo-type">
            出庫区分
            <select id="fefo-type" value={type} onChange={e => setType(e.target.value as OutboundTransactionType)}>
              {OUTBOUND_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label htmlFor="fefo-qty">
            出庫数量
            <NumberInput id="fefo-qty" min={1} required value={qty} onValueChange={setQty} />
          </label>
          <label className="fefo-check" htmlFor="fefo-expired">
            <input
              id="fefo-expired"
              type="checkbox"
              checked={includeExpired}
              onChange={e => setIncludeExpired(e.target.checked)}
            />
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
                    <th>引当数</th>
                    <th>引当後</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.allocations.map(a => (
                    <tr key={a.lotId}>
                      <td className="mono">{a.lotNo}</td>
                      <td><ExpiryBadge expiryDate={a.expiryDate} /></td>
                      <td><WarehouseDot warehouse={warehouses.find(w => w.id === a.warehouseId)} /></td>
                      <td>{a.quantity}</td>
                      <td>{a.availableQuantity - a.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.shortage > 0 && (
              <p className="fefo-shortage">在庫が {plan.shortage} 不足しています。数量を減らすか、対象倉庫を見直してください。</p>
            )}
            {plan.skippedExpired > 0 && (
              <p className="fefo-note">期限切れロットの {plan.skippedExpired} は引当対象から除外しています。</p>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!valid}>出庫</button>
          </div>
        </form>
      </div>
    </div>
  );
}
