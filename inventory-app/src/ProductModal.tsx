import { useState, useEffect } from 'react';
import { normalizeJanCode } from './useInventory';
import type { Category, Product } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  product: Product | null;
  categories: Category[];
  onSave: (data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => void;
  onClose: () => void;
}

const EMPTY = { name: '', sku: '', janCode: '', categoryId: '', minQuantity: 5, price: 0, costPrice: 0 };

export function ProductModal({ product, categories, onSave, onClose }: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(product
      ? { name: product.name, sku: product.sku, janCode: product.janCode ?? '', categoryId: product.categoryId, minQuantity: product.minQuantity, price: product.price, costPrice: product.costPrice }
      : EMPTY
    );
  }, [product]);

  const set = (k: keyof typeof EMPTY, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{product ? '商品を編集' : '商品を追加'}</h2>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, janCode: form.janCode.trim() || undefined }); onClose(); }}>
          <label>商品名 <input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>SKU <input required value={form.sku} onChange={e => set('sku', e.target.value)} /></label>
          <label>JANコード <input inputMode="numeric" maxLength={13} pattern="\d{8}|\d{13}" title="8桁または13桁の数字で入力してください" placeholder="未設定可" value={form.janCode} onChange={e => set('janCode', normalizeJanCode(e.target.value))} /></label>
          <label>カテゴリ
            <select required value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
              <option value="" disabled>選択してください</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>最低在庫数 <NumberInput min={0} required value={form.minQuantity} onValueChange={v => set('minQuantity', v)} /></label>
          <label>販売定価 (円) <NumberInput min={0} required value={form.price} onValueChange={v => set('price', v)} /></label>
          <label>原価 (円) <NumberInput min={0} required value={form.costPrice} onValueChange={v => set('costPrice', v)} /></label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
