import { useState } from 'react';
import { planPurchaseReturn, purchaseReturnDefaults, selectableSuppliers } from './useInventory';
import type { Lot, Product, PurchaseReturnInput, StockTransaction, Supplier, Warehouse } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  product: Product;
  lot: Lot;
  ledger: StockTransaction[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  onSubmit: (input: PurchaseReturnInput) => void;
  onClose: () => void;
}

/**
 * 仕入返品の入力画面 (在庫一覧のロット行の「返品」から開く)。
 * 仕入先・返品単価の初期値は、そのロットを入荷したときの記録とロットの原価 (purchaseReturnDefaults)。
 * 可否と数量の丸めは returnToSupplier と同じ planPurchaseReturn で判定する。
 */
export function PurchaseReturnModal({ product, lot, ledger, suppliers, warehouses, onSubmit, onClose }: Props) {
  const [defaults] = useState(() => purchaseReturnDefaults(product, lot, ledger));
  const [quantity, setQuantity] = useState(lot.quantity);
  const [supplierId, setSupplierId] = useState(defaults.supplierId);
  const [unitPrice, setUnitPrice] = useState(defaults.unitPrice);
  const [note, setNote] = useState('');

  const input: PurchaseReturnInput = { productId: product.id, lotId: lot.id, quantity, supplierId, unitPrice, note };
  const plan = planPurchaseReturn([product], suppliers, input);
  const overLimit = quantity > lot.quantity;
  const options = selectableSuppliers(suppliers, supplierId);
  const warehouse = warehouses.find(w => w.id === lot.warehouseId)?.name ?? '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (plan.error || overLimit) return;
    onSubmit(input);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>仕入返品</h2>
        <form onSubmit={handleSubmit}>
          <div className="fefo-plan">
            <div><strong>{product.name}</strong>（{product.sku}）</div>
            <div>ロット {lot.lotNo}{lot.expiryDate ? `（期限 ${lot.expiryDate}）` : ''} / {warehouse} / 在庫 {lot.quantity.toLocaleString()}</div>
          </div>

          <label htmlFor="pr-supplier">
            返品先の仕入先
            <select id="pr-supplier" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">選んでください</option>
              {options.map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : '（取引停止）'}</option>)}
            </select>
          </label>
          {!defaults.supplierId && (
            <p className="label-hint">このロットの入荷記録に仕入先がないため、返品先を選んでください。</p>
          )}

          <label htmlFor="pr-qty">
            返品数量
            <NumberInput id="pr-qty" min={1} max={lot.quantity} value={quantity} onValueChange={setQuantity} />
          </label>
          {overLimit && <p className="field-error">在庫は {lot.quantity} 個です</p>}

          <label htmlFor="pr-price">
            返品単価（税抜・円） <span className="label-hint">（初期値はロットの原価。0 は未入力）</span>
            <NumberInput id="pr-price" min={0} value={unitPrice} onValueChange={setUnitPrice} />
          </label>

          <label htmlFor="pr-note">
            備考 <span className="label-hint">（空欄なら「仕入返品（仕入先名）」）</span>
            <input id="pr-note" value={note} onChange={e => setNote(e.target.value)} placeholder="例: 品質不良のため" />
          </label>

          {!plan.error && !overLimit && (
            <div className="fefo-plan" aria-label="返品の内容">
              在庫を {plan.quantity.toLocaleString()}個 減らし、仕入先へ返品します
              {plan.amount > 0 && <>（返品金額 ¥{plan.amount.toLocaleString()}・税抜）</>}
            </div>
          )}
          {/* 仕入先が未選択のときは上の案内とボタンの無効化で足りるので、同じ内容のエラーは重ねない */}
          {plan.error && supplierId && quantity > 0 && !overLimit && <p className="field-error">{plan.error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!!plan.error || overLimit}>返品する</button>
          </div>
        </form>
      </div>
    </div>
  );
}
