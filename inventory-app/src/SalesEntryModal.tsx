import { useMemo, useState } from 'react';
import type { Customer, FefoPlan, Product, SaleInput, Warehouse } from './useInventory';
import { DEFAULT_TAX_RATE, planFefoShipment, productTaxRate, saleAmounts, selectableCustomers, taxRateLabel, totalQuantity, totalQuantityByWarehouse } from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';
import { NumberInput } from './NumberInput';

interface Props {
  products: Product[];
  customers: Customer[];
  warehouses: Warehouse[];
  onSubmit: (input: SaleInput) => void;
  onClose: () => void;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

/**
 * 売上登録モーダル。商品・数量・実売単価・得意先を入力すると、賞味期限の近いロットから
 * 自動で引き当てて出庫する (FEFO出庫と同じ planFefoShipment を使うので、プレビューと
 * 実際に出るロットは必ず一致する)。
 *
 * 単価は税抜で入力する (消費税は商品の税率で計算してプレビューに出す)。初期値は商品の販売定価。値引きしたときはここを書き換えると、その金額が
 * 「実際の売上」として帳票に残る (定価のままでも同じ扱い)。
 */
export function SalesEntryModal({ products, customers, warehouses, onSubmit, onClose }: Props) {
  const sorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const [productId, setProductId] = useState(sorted[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  // 単価を手で変えたかどうか。変えていなければ商品を選び直すたびに定価へ追従させる
  const [priceTouched, setPriceTouched] = useState(false);
  const [unitPrice, setUnitPrice] = useState(sorted[0]?.price ?? 0);
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [note, setNote] = useState('');

  const product = sorted.find(p => p.id === productId);

  const handleProductChange = (id: string) => {
    setProductId(id);
    if (!priceTouched) setUnitPrice(sorted.find(p => p.id === id)?.price ?? 0);
  };

  const plan: FefoPlan = useMemo(
    () => product
      ? planFefoShipment(product, qty, { warehouseId: warehouseId || undefined, includeExpired })
      : { allocations: [], allocated: 0, shortage: 0, skippedExpired: 0, cost: 0 },
    [product, qty, warehouseId, includeExpired],
  );

  const stock = product ? (warehouseId ? totalQuantityByWarehouse(product, warehouseId) : totalQuantity(product)) : 0;
  const taxRate = product ? productTaxRate(product) : DEFAULT_TAX_RATE;
  const { amount, tax, amountWithTax } = saleAmounts(plan.allocations.map(a => a.quantity), unitPrice, taxRate);
  const profit = amount - plan.cost;
  const valid = !!product && qty > 0 && plan.shortage === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      productId,
      quantity: qty,
      unitPrice,
      customerId,
      warehouseId: warehouseId || undefined,
      includeExpired,
      note,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>売上を登録</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label className="form-span-2" htmlFor="sale-product">
                商品
                <select id="sale-product" value={productId} onChange={e => handleProductChange(e.target.value)}>
                  {sorted.map(p => (
                    <option key={p.id} value={p.id}>{p.name}（{p.sku}） 在庫 {totalQuantity(p)}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="sale-qty">
                数量
                <NumberInput id="sale-qty" min={1} required value={qty} onValueChange={setQty} />
              </label>
              <label htmlFor="sale-price">
                販売単価 <span className="label-hint">（税抜・円／税率 {taxRateLabel(taxRate)}）</span>
                <NumberInput
                  id="sale-price"
                  min={0}
                  value={unitPrice}
                  onValueChange={v => { setPriceTouched(true); setUnitPrice(v); }}
                />
              </label>
              <label htmlFor="sale-customer">
                得意先 <span className="label-hint">（任意）</span>
                <select id="sale-customer" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                  <option value="">得意先なし</option>
                  {selectableCustomers(customers, customerId).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="sale-warehouse">
                出庫元倉庫
                <select id="sale-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                  <option value="">全倉庫</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <label className="form-span-2" htmlFor="sale-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="sale-note" value={note} onChange={e => setNote(e.target.value)} placeholder="空欄なら「売上登録」と記録されます" />
              </label>
            </div>

            <label className="fefo-check" htmlFor="sale-expired">
              <input
                id="sale-expired"
                type="checkbox"
                checked={includeExpired}
                onChange={e => setIncludeExpired(e.target.checked)}
              />
              期限切れロットも引当対象にする
            </label>

            <div className="fefo-plan">
              <div className="fefo-plan-head">引当プレビュー（対象在庫: {stock}）</div>
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
              {plan.shortage > 0 && (
                <p className="fefo-shortage">在庫が {plan.shortage} 不足しています。数量を減らすか、対象倉庫を見直してください。</p>
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
            {unitPrice === 0 && (
              <p className="fefo-note">販売単価が0のときは「単価未入力」として扱い、売上管理では商品の販売定価で概算します。</p>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!valid}>売上を登録</button>
          </div>
        </form>
      </div>
    </div>
  );
}
