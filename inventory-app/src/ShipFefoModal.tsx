import { useState, useMemo } from 'react';
import type { Customer, FefoPlan, FefoShipOptions, OutboundTransactionType, Product, Warehouse } from './useInventory';
import { OUTBOUND_TYPES, planFefoShipment, productTaxRate, saleAmounts, selectableCustomers, taxRateLabel, totalQuantity, totalQuantityByWarehouse } from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';
import { NumberInput } from './NumberInput';

interface Props {
  product: Product;
  warehouses: Warehouse[];
  customers: Customer[];
  onShip: (quantity: number, options: FefoShipOptions) => void;
  onClose: () => void;
}

/**
 * FEFO出庫モーダル。商品と数量を指定すると、賞味期限の近いロットから自動で引き当てる。
 * プレビュー表は実際の出庫とまったく同じ planFefoShipment の結果を描いているので、
 * 「確定したら別のロットから引かれた」ということは起こらない。
 */
export function ShipFefoModal({ product, warehouses, customers, onShip, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [warehouseId, setWarehouseId] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [type, setType] = useState<OutboundTransactionType>(OUTBOUND_TYPES[0]);
  // 売上出庫のときだけ入力できる項目。ここで入れた単価が「実際の売上」として帳票に残り、
  // 売上管理タブの売上高・粗利になる (未入力=定価のままでも同じ)
  const [unitPrice, setUnitPrice] = useState(product.price);
  const [customerId, setCustomerId] = useState('');
  const isSale = type === '売上出庫';

  const plan: FefoPlan = useMemo(
    () => planFefoShipment(product, qty, { warehouseId: warehouseId || undefined, includeExpired }),
    [product, qty, warehouseId, includeExpired]
  );

  const stock = warehouseId ? totalQuantityByWarehouse(product, warehouseId) : totalQuantity(product);
  const valid = qty > 0 && plan.shortage === 0;
  const taxRate = productTaxRate(product);
  const sale = saleAmounts(plan.allocations.map(a => a.quantity), unitPrice, taxRate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onShip(qty, {
      warehouseId: warehouseId || undefined,
      includeExpired,
      type,
      ...(isSale ? { unitPrice, customerId } : {}),
    });
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
          {isSale && (<>
            <label htmlFor="fefo-price">
              販売単価 <span className="label-hint">（税抜・円／税率 {taxRateLabel(taxRate)}。既定は販売定価）</span>
              <NumberInput id="fefo-price" min={0} value={unitPrice} onValueChange={setUnitPrice} />
            </label>
            <label htmlFor="fefo-customer">
              得意先 <span className="label-hint">（任意）</span>
              <select id="fefo-customer" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">得意先なし</option>
                {selectableCustomers(customers, customerId).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </>)}
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
            {isSale && plan.allocations.length > 0 && (
              <div className="sale-preview">
                <span>売上金額（税抜） <strong>¥{sale.amount.toLocaleString()}</strong></span>
                <span>消費税 ¥{sale.tax.toLocaleString()}</span>
                <span>税込 <strong>¥{sale.amountWithTax.toLocaleString()}</strong></span>
                <span>原価 ¥{Math.round(plan.cost).toLocaleString()}</span>
                <span className={sale.amount - plan.cost >= 0 ? 'qty-in' : 'qty-out'}>
                  粗利 ¥{Math.round(sale.amount - plan.cost).toLocaleString()}
                </span>
              </div>
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
