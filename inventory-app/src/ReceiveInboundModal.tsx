import { useState, useMemo } from 'react';
import type { InboundPlan, Product, ReceiveInput, Warehouse } from './useInventory';
import { planReceipt, remainingInbound } from './useInventory';
import { WarehouseDot } from './badges';
import { NumberInput } from './NumberInput';

interface Props {
  plan: InboundPlan;
  product: Product;
  warehouses: Warehouse[];
  onReceive: (input: ReceiveInput) => void;
  onClose: () => void;
}

const LOT_PATTERN = /^\d{8}$/;

/**
 * 入荷予定にもとづく入荷モーダル。予定の内容 (数量・ロットNo・賞味期限・倉庫) を初期値とし、
 * 実際に届いたものが違えばここで直せる。プレビューは receiveInboundPlan と同じ planReceipt を
 * 呼んでいるので、「確定したら別のロットに入った」ということは起こらない。
 */
export function ReceiveInboundModal({ plan, product, warehouses, onReceive, onClose }: Props) {
  const remaining = remainingInbound(plan);
  const [qty, setQty] = useState(remaining);
  const [lotNo, setLotNo] = useState(plan.lotNo);
  const [expiryDate, setExpiryDate] = useState(plan.expiryDate ?? '');
  const [warehouseId, setWarehouseId] = useState(plan.warehouseId);
  const [note, setNote] = useState('');
  const [lotError, setLotError] = useState('');

  const input: ReceiveInput = useMemo(
    () => ({ quantity: qty, lotNo, expiryDate: expiryDate || undefined, warehouseId, note }),
    [qty, lotNo, expiryDate, warehouseId, note],
  );
  const target = useMemo(() => planReceipt(plan, product, input), [plan, product, input]);

  const valid = qty > 0 && qty <= remaining && LOT_PATTERN.test(lotNo);

  const handleLotNoChange = (val: string) => {
    setLotNo(val.replace(/[^\d]/g, '').slice(0, 8));
    setLotError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (qty <= 0 || qty > remaining) return;
    if (!LOT_PATTERN.test(lotNo)) {
      setLotError('半角数字8桁で入力してください');
      return;
    }
    onReceive(input);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>入荷</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="move-lot-info">
              <strong>{product.name}</strong>（{product.sku}）<br />
              入荷予定日 {plan.expectedDate}
              {plan.supplier && <> / 仕入先 {plan.supplier}</>}<br />
              予定 {plan.quantity} ／ 入荷済 {plan.receivedQuantity} ／ <strong>残 {remaining}</strong>
            </p>
            <div className="form-grid">
              <label htmlFor="receive-qty">
                入荷数量 <span className="label-hint">（残数 {remaining} まで）</span>
                <NumberInput id="receive-qty" min={1} max={remaining} required value={qty} onValueChange={setQty} />
              </label>
              <label htmlFor="receive-warehouse">
                入荷先倉庫
                <select id="receive-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="receive-expiry">
                賞味期限 <span className="label-hint">（任意）</span>
                <input id="receive-expiry" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
              </label>
              <label htmlFor="receive-lot-no">
                ロットNo <span className="label-hint">（半角数字8桁）</span>
                <input
                  id="receive-lot-no"
                  required
                  value={lotNo}
                  onChange={e => handleLotNoChange(e.target.value)}
                  inputMode="numeric"
                  maxLength={8}
                />
                {lotError && <span className="field-error">{lotError}</span>}
              </label>
              <label className="form-span-2" htmlFor="receive-note">
                備考 <span className="label-hint">（未入力なら「入荷予定」として帳票に記録）</span>
                <input id="receive-note" value={note} onChange={e => setNote(e.target.value)} />
              </label>
            </div>

            <div className="fefo-plan">
              <div className="fefo-plan-head">入荷後の在庫</div>
              {target.quantity <= 0 ? (
                <p className="lot-empty">入荷できる数量がありません。</p>
              ) : (
                <p className="receive-preview">
                  {target.existingLot
                    ? <>既存ロット <span className="mono">{target.lotNo}</span>（<WarehouseDot warehouse={warehouses.find(w => w.id === target.warehouseId)} />）に加算します：{target.existingLot.quantity} → <strong>{target.existingLot.quantity + target.quantity}</strong></>
                    : <>新しいロット <span className="mono">{target.lotNo}</span>（<WarehouseDot warehouse={warehouses.find(w => w.id === target.warehouseId)} />）を作成します：<strong>{target.quantity}</strong></>}
                  <br />
                  入荷後の残数：<strong>{remaining - target.quantity}</strong>
                  {remaining - target.quantity === 0 && <>（この予定は入荷済になります）</>}
                </p>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!valid}>入荷する</button>
          </div>
        </form>
      </div>
    </div>
  );
}
