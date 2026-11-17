import { useState } from 'react';
import { formatLedgerDateTime, planSalesReturn, taxAmount } from './useInventory';
import type { Customer, Product, SalesReturnInput, StockTransaction, Warehouse } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  sale: StockTransaction;
  products: Product[];
  ledger: StockTransaction[];
  customers: Customer[];
  warehouses: Warehouse[];
  onSubmit: (input: SalesReturnInput) => void;
  onClose: () => void;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

/**
 * 売上返品の入力画面 (売上管理の明細の「返品」から開く)。
 * 返品数量と戻し先の倉庫を選ぶと、在庫がどこに戻るかと差し引かれる売上をプレビューする。
 * プレビューは returnSale と同じ planSalesReturn で組み立てるので、表示と実際の処理は食い違わない。
 */
export function SalesReturnModal({ sale, products, ledger, customers, warehouses, onSubmit, onClose }: Props) {
  const initial = planSalesReturn(products, ledger, { saleTxnId: sale.id, quantity: 0, warehouseId: sale.fromWarehouseId ?? '' });
  const [quantity, setQuantity] = useState(initial.returnable);
  const [warehouseId, setWarehouseId] = useState(sale.fromWarehouseId ?? warehouses[0]?.id ?? '');
  const [note, setNote] = useState('');

  const plan = planSalesReturn(products, ledger, { saleTxnId: sale.id, quantity, warehouseId, note });
  const customer = customers.find(c => c.id === sale.customerId)?.name ?? (sale.customerId ? '（削除された得意先）' : '得意先なし');
  const rate = sale.taxRate ?? 8;
  const tax = taxAmount(plan.amount, rate);
  const overLimit = quantity > plan.returnable;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (plan.error || overLimit) return;
    onSubmit({ saleTxnId: sale.id, quantity: plan.quantity, warehouseId, note });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>売上返品</h2>
        <form onSubmit={handleSubmit}>
          <div className="fefo-plan">
            <div className="fefo-plan-head">元の売上</div>
            <div>{formatLedgerDateTime(sale.date)} / {customer}</div>
            <div><strong>{sale.productName}</strong>（{sale.productSku}） ロット {sale.lotNo}</div>
            <div>
              売上数量 {sale.quantity.toLocaleString()} / 返品できる数量 <strong>{plan.returnable.toLocaleString()}</strong>
              {plan.returnable < sale.quantity && <span className="label-hint">（{(sale.quantity - plan.returnable).toLocaleString()}個は返品済み）</span>}
            </div>
          </div>

          <label htmlFor="return-qty">
            返品数量
            <NumberInput id="return-qty" min={1} max={plan.returnable} value={quantity} onValueChange={setQuantity} />
          </label>
          {overLimit && <p className="field-error">返品できるのは {plan.returnable} 個までです</p>}

          <label htmlFor="return-warehouse">
            戻し先の倉庫 <span className="label-hint">（売り物にならないものは不良倉庫などへ）</span>
            <select id="return-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>

          <label htmlFor="return-note">
            備考 <span className="label-hint">（空欄なら「売上返品（得意先名）」）</span>
            <input id="return-note" value={note} onChange={e => setNote(e.target.value)} placeholder="例: 破損のため" />
          </label>

          {!plan.error && !overLimit && (
            <div className="fefo-plan" aria-label="返品の内容">
              <div>
                ロット {plan.lotNo}{plan.expiryDate ? `（期限 ${plan.expiryDate}）` : ''} に {plan.quantity.toLocaleString()}個 戻します
                （{plan.existingLot ? '既存のロットに加算' : '新しいロットとして作成'}）
              </div>
              <div>差し引く売上 {yen(plan.amount)}（税抜）+ 消費税 {yen(tax)} = 税込 {yen(plan.amount + tax)}</div>
            </div>
          )}
          {plan.error && plan.returnable <= 0 && <p className="field-error">{plan.error}</p>}
          {plan.error && plan.returnable > 0 && quantity > 0 && <p className="field-error">{plan.error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!!plan.error || overLimit}>返品する</button>
          </div>
        </form>
      </div>
    </div>
  );
}
