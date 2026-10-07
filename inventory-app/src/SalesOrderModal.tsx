import { useMemo, useState } from 'react';
import type { Customer, Product, SalesOrder, SalesOrderInput, Warehouse } from './useInventory';
import { isMaterial, productTaxRate, salesOrderValidationError, selectableCustomers, taxRateLabel, totalQuantity, withTax } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  order: SalesOrder | null; // null = 新規作成
  products: Product[];
  customers: Customer[];
  warehouses: Warehouse[];
  onSave: (data: SalesOrderInput) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 受注の作成・編集フォーム。受注は在庫を動かさないので、ここで保存しても在庫・帳票は変わらない
 * (在庫が減るのは出荷したときだけ)。入力チェックは addSalesOrder / updateSalesOrder と同じ
 * salesOrderValidationError を使う。
 */
export function SalesOrderModal({ order, products, customers, warehouses, onSave, onClose }: Props) {
  // 資材は売らないので選択肢に出さない (売上登録と同じ)
  const sellable = useMemo(
    () => products.filter(p => !isMaterial(p)).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const [form, setForm] = useState<SalesOrderInput>(() => order
    ? {
        customerId: order.customerId,
        productId: order.productId,
        expectedDate: order.expectedDate,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        warehouseId: order.warehouseId,
        note: order.note,
      }
    : {
        customerId: selectableCustomers(customers)[0]?.id ?? '',
        productId: sellable[0]?.id ?? '',
        expectedDate: today(),
        quantity: 1,
        unitPrice: sellable[0]?.price ?? 0,
        warehouseId: '',
        note: '',
      });
  // 単価を手で変えたかどうか。変えていなければ商品を選び直すたびに販売定価へ追従させる (新規のみ)
  const [priceTouched, setPriceTouched] = useState(!!order);

  const product = sellable.find(p => p.id === form.productId);
  const error = salesOrderValidationError(form, products, customers);
  const amount = form.unitPrice * form.quantity;

  const handleProductChange = (productId: string) => {
    setForm(f => ({
      ...f,
      productId,
      unitPrice: priceTouched ? f.unitPrice : sellable.find(p => p.id === productId)?.price ?? 0,
    }));
  };

  const shippedNote = order && order.shippedQuantity > 0
    ? `この受注はすでに ${order.shippedQuantity} 出荷済みです。受注数量を出荷済数量以下にすると出荷済として扱われます。`
    : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (error) return;
    onSave({ ...form, note: form.note.trim() });
    onClose();
  };

  const unavailable = sellable.length === 0
    ? '販売品が登録されていません。先に商品マスタで商品を登録してください。'
    : customers.length === 0
      ? '得意先が登録されていません。先に商品マスタタブの得意先マスタで得意先を登録してください。'
      : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>{order ? '受注を編集' : '受注を登録'}</h2>
        {unavailable ? (
          <>
            <div className="modal-body">
              <p className="lot-empty">{unavailable}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
            </div>
          </>
        ) : (
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label className="form-span-2" htmlFor="so-customer">
                得意先
                <select id="so-customer" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}>
                  <option value="">選択してください</option>
                  {selectableCustomers(customers, form.customerId).map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.active ? '' : '（取引停止）'}</option>
                  ))}
                </select>
              </label>
              <label className="form-span-2" htmlFor="so-product">
                商品
                <select id="so-product" value={form.productId} onChange={e => handleProductChange(e.target.value)}>
                  {sellable.map(p => (
                    <option key={p.id} value={p.id}>{p.name}（{p.sku}） 在庫 {totalQuantity(p)}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="so-date">
                出荷予定日
                <input id="so-date" type="date" required value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
              </label>
              <label htmlFor="so-qty">
                受注数量
                <NumberInput id="so-qty" min={1} required value={form.quantity} onValueChange={v => setForm(f => ({ ...f, quantity: v }))} />
              </label>
              <label htmlFor="so-price">
                受注単価 <span className="label-hint">（税抜・円{product ? `／税率 ${taxRateLabel(productTaxRate(product))}` : ''}。既定は販売定価）</span>
                <NumberInput
                  id="so-price"
                  min={0}
                  value={form.unitPrice}
                  onValueChange={v => { setPriceTouched(true); setForm(f => ({ ...f, unitPrice: v })); }}
                />
              </label>
              <label htmlFor="so-warehouse">
                出荷元倉庫
                <select id="so-warehouse" value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))}>
                  <option value="">全倉庫</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <label className="form-span-2" htmlFor="so-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="so-note" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            {product && form.unitPrice > 0 && (
              <p className="sale-preview">
                <span>受注金額（税抜） <strong>¥{amount.toLocaleString()}</strong></span>
                {/* 消費税は出荷時に引き当てたロットごとに端数処理されるので、ここでは目安 */}
                <span>税込（目安） ¥{withTax(amount, productTaxRate(product)).toLocaleString()}</span>
              </p>
            )}
            {form.unitPrice === 0 && (
              <p className="fefo-note">受注単価が0のときは「単価未入力」として扱い、出荷した売上は商品の販売定価で概算します。</p>
            )}
            {shippedNote && <p className="fefo-note">{shippedNote}</p>}
            {error && form.customerId !== '' && <p className="field-error">{error}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!!error}>保存</button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
