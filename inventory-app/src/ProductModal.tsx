import { useState, useEffect } from 'react';
import type { Product } from './useInventory';

interface Props {
  product: Product | null;
  onSave: (data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => void;
  onClose: () => void;
}

const EMPTY = { name: '', sku: '', category: '', minQuantity: 5, price: 0 };

export function ProductModal({ product, onSave, onClose }: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(product
      ? { name: product.name, sku: product.sku, category: product.category, minQuantity: product.minQuantity, price: product.price }
      : EMPTY
    );
  }, [product]);

  const set = (k: keyof typeof EMPTY, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{product ? '商品を編集' : '商品を追加'}</h2>
        <form onSubmit={e => { e.preventDefault(); onSave(form); onClose(); }}>
          <label>商品名 <input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>SKU <input required value={form.sku} onChange={e => set('sku', e.target.value)} /></label>
          <label>カテゴリ <input required value={form.category} onChange={e => set('category', e.target.value)} /></label>
          <label>最低在庫数 <input type="number" min={0} required value={form.minQuantity} onChange={e => set('minQuantity', +e.target.value)} /></label>
          <label>単価 (円) <input type="number" min={0} required value={form.price} onChange={e => set('price', +e.target.value)} /></label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
