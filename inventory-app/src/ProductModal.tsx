import { useState, useEffect } from 'react';
import { DEFAULT_TAX_RATE, PRODUCT_KINDS, TAX_RATES, defaultTaxRateForCategory, normalizeJanCode, productKind, productTaxRate, taxRateLabel, withTax } from './useInventory';
import type { Category, Product, ProductKind, TaxRate } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  product: Product | null;
  categories: Category[];
  /** 新規追加時に、選んだカテゴリの商品から税率の初期値を引くのに使う */
  products?: Product[];
  onSave: (data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => void;
  onClose: () => void;
}

const EMPTY = { name: '', sku: '', janCode: '', categoryId: '', minQuantity: 5, price: 0, costPrice: 0, taxRate: DEFAULT_TAX_RATE as TaxRate, kind: '販売品' as ProductKind };

export function ProductModal({ product, categories, products = [], onSave, onClose }: Props) {
  const [form, setForm] = useState(EMPTY);
  // 税率を手で選んだあとは、カテゴリを変えても初期値で上書きしない
  const [taxRateTouched, setTaxRateTouched] = useState(false);

  useEffect(() => {
    setForm(product
      ? { name: product.name, sku: product.sku, janCode: product.janCode ?? '', categoryId: product.categoryId, minQuantity: product.minQuantity, price: product.price, costPrice: product.costPrice, taxRate: productTaxRate(product), kind: productKind(product) }
      : EMPTY
    );
    setTaxRateTouched(false);
  }, [product]);

  const set = (k: keyof typeof EMPTY, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  // 資材は売らないので販売定価・税率の欄を出さない (値は保持したまま隠すだけ)
  const isSaleItem = form.kind === '販売品';

  const setCategory = (categoryId: string) => setForm(f => ({
    ...f,
    categoryId,
    // 新規追加のときだけ、同じカテゴリの商品の税率を初期値にする (乳製品なら 8%、ラベルなら 10%)
    ...(!product && !taxRateTouched ? { taxRate: defaultTaxRateForCategory(products, categoryId) } : {}),
  }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{product ? '商品を編集' : '商品を追加'}</h2>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, janCode: form.janCode.trim() || undefined }); onClose(); }}>
          <label>商品名 <input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>SKU <input required value={form.sku} onChange={e => set('sku', e.target.value)} /></label>
          <label>JANコード <input inputMode="numeric" maxLength={13} pattern="\d{8}|\d{13}" title="8桁または13桁の数字で入力してください" placeholder="未設定可" value={form.janCode} onChange={e => set('janCode', normalizeJanCode(e.target.value))} /></label>
          <label>カテゴリ
            <select required value={form.categoryId} onChange={e => setCategory(e.target.value)}>
              <option value="" disabled>選択してください</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>最低在庫数 <NumberInput min={0} required value={form.minQuantity} onValueChange={v => set('minQuantity', v)} /></label>
          <label>区分
            <select value={form.kind} onChange={e => set('kind', e.target.value)}>
              {PRODUCT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          {!isSaleItem && <p className="label-hint">資材は売上の対象にならず、使った分は「資材使用」で出庫します。</p>}
          {isSaleItem && (<>
            <label>消費税率
              <select value={form.taxRate} onChange={e => { set('taxRate', Number(e.target.value)); setTaxRateTouched(true); }}>
                {TAX_RATES.map(r => <option key={r} value={r}>{taxRateLabel(r)}</option>)}
              </select>
            </label>
            <label>販売定価 (税抜・円) <span className="label-hint">税込 ¥{withTax(form.price, form.taxRate).toLocaleString()}</span>
              <NumberInput min={0} required value={form.price} onValueChange={v => set('price', v)} />
            </label>
          </>)}
          <label>原価 (税抜・円) <NumberInput min={0} required value={form.costPrice} onValueChange={v => set('costPrice', v)} /></label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
