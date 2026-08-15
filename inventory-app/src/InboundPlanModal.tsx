import { useState, useEffect } from 'react';
import type { InboundPlan, InboundPlanInput, Product, Supplier, Warehouse } from './useInventory';
import { generateLotNo, expectedDateFromLeadTime, selectableSuppliers, DEFAULT_WAREHOUSE_ID } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  plan: InboundPlan | null; // null = 新規作成
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onSave: (data: InboundPlanInput) => void;
  onClose: () => void;
}

const LOT_PATTERN = /^\d{8}$/;
const today = () => new Date().toISOString().slice(0, 10);

const makeEmpty = (products: Product[], warehouses: Warehouse[]) => ({
  productId: products[0]?.id ?? '',
  expectedDate: today(),
  quantity: 0,
  warehouseId: warehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID) ? DEFAULT_WAREHOUSE_ID : (warehouses[0]?.id ?? ''),
  lotNo: '',
  expiryDate: '',
  supplierId: '',
  note: '',
});

/**
 * 入荷予定の作成・編集フォーム。ここで決めた内容 (ロットNo・賞味期限・倉庫) は
 * 入荷モーダルの初期値になるので、入荷時に上書きもできる「予定値」として扱う。
 */
export function InboundPlanModal({ plan, products, warehouses, suppliers, onSave, onClose }: Props) {
  const [form, setForm] = useState(() => makeEmpty(products, warehouses));
  const [lotError, setLotError] = useState('');

  useEffect(() => {
    setForm(plan
      ? {
          productId: plan.productId,
          expectedDate: plan.expectedDate,
          quantity: plan.quantity,
          warehouseId: plan.warehouseId,
          lotNo: plan.lotNo,
          expiryDate: plan.expiryDate ?? '',
          supplierId: plan.supplierId,
          note: plan.note,
        }
      : makeEmpty(products, warehouses));
    setLotError('');
  }, [plan, products, warehouses]);

  // 新規登録で仕入先を選んだときだけ、入荷予定日をその仕入先の標準リードタイムに合わせる。
  // 編集中や、予定日を自分で動かしたあと (今日+前の仕入先のリードタイム から変わっている) は触らない
  const handleSupplierChange = (supplierId: string) => {
    setForm(f => {
      const previous = suppliers.find(s => s.id === f.supplierId);
      const selected = suppliers.find(s => s.id === supplierId);
      const keepsDefault = f.expectedDate === expectedDateFromLeadTime(previous);
      return {
        ...f,
        supplierId,
        expectedDate: !plan && keepsDefault ? expectedDateFromLeadTime(selected) : f.expectedDate,
      };
    });
  };

  // ロットNoが未入力か、前の賞味期限から自動生成したままのときだけ追従させる (手入力は尊重する)
  const handleExpiryChange = (val: string) => {
    setForm(f => ({
      ...f,
      expiryDate: val,
      lotNo: f.lotNo === '' || f.lotNo === generateLotNo(f.expiryDate || undefined)
        ? generateLotNo(val || undefined)
        : f.lotNo,
    }));
    setLotError('');
  };

  const handleLotNoChange = (val: string) => {
    setForm(f => ({ ...f, lotNo: val.replace(/[^\d]/g, '').slice(0, 8) }));
    setLotError('');
  };

  const receivedNote = plan && plan.receivedQuantity > 0
    ? `この予定はすでに ${plan.receivedQuantity} 入荷済みです。予定数量は入荷済数量より少なくできますが、その場合は入荷済として扱われます。`
    : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productId || form.quantity <= 0) return;
    if (!LOT_PATTERN.test(form.lotNo)) {
      setLotError('半角数字8桁で入力してください');
      return;
    }
    const { expiryDate, ...rest } = form;
    onSave({ ...rest, ...(expiryDate ? { expiryDate } : {}) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>{plan ? '入荷予定を編集' : '入荷予定を追加'}</h2>
        {products.length === 0 ? (
          <>
            <div className="modal-body">
              <p className="lot-empty">商品が登録されていません。先に商品マスタで商品を登録してください。</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
            </div>
          </>
        ) : (
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label className="form-span-2" htmlFor="ip-product">
                商品
                <select id="ip-product" value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}（{p.sku}）</option>
                  ))}
                </select>
              </label>
              <label htmlFor="ip-date">
                入荷予定日
                <input id="ip-date" type="date" required value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
              </label>
              <label htmlFor="ip-qty">
                予定数量
                <NumberInput id="ip-qty" min={1} required value={form.quantity} onValueChange={v => setForm(f => ({ ...f, quantity: v }))} />
              </label>
              <label htmlFor="ip-warehouse">
                入荷先倉庫
                <select id="ip-warehouse" value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))}>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="ip-expiry">
                賞味期限 <span className="label-hint">（任意 — ロットNoを自動生成）</span>
                <input id="ip-expiry" type="date" value={form.expiryDate} onChange={e => handleExpiryChange(e.target.value)} />
              </label>
              <label htmlFor="ip-lot-no">
                ロットNo <span className="label-hint">（半角数字8桁）</span>
                <input
                  id="ip-lot-no"
                  required
                  value={form.lotNo}
                  onChange={e => handleLotNoChange(e.target.value)}
                  placeholder="例: 20261231"
                  inputMode="numeric"
                  maxLength={8}
                />
                {lotError && <span className="field-error">{lotError}</span>}
              </label>
              <label htmlFor="ip-supplier">
                仕入先 <span className="label-hint">（任意 — 仕入先マスタから選択）</span>
                <select id="ip-supplier" value={form.supplierId} onChange={e => handleSupplierChange(e.target.value)}>
                  <option value="">未設定</option>
                  {selectableSuppliers(suppliers, form.supplierId).map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.active ? '' : '（取引停止）'}</option>
                  ))}
                </select>
              </label>
              <label className="form-span-2" htmlFor="ip-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="ip-note" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            {receivedNote && <p className="fefo-note">{receivedNote}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={form.quantity <= 0}>保存</button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
