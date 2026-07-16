import { useState } from 'react';
import type { Category, Product } from './useInventory';

interface Props {
  products: Product[];
  categories: Category[];
  onUpdate: (id: string, data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => void;
  onDelete: (id: string) => void;
  onAddClick: () => void;
}

type MasterForm = Omit<Product, 'id' | 'updatedAt' | 'lots'>;

const toForm = (p: Product): MasterForm => ({
  name: p.name, sku: p.sku, janCode: p.janCode ?? '', categoryId: p.categoryId, minQuantity: p.minQuantity, price: p.price, costPrice: p.costPrice,
});

export function ProductMasterView({ products, categories, onUpdate, onDelete, onAddClick }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MasterForm | null>(null);

  const startEdit = (p: Product) => { setEditingId(p.id); setForm(toForm(p)); };
  const cancelEdit = () => { setEditingId(null); setForm(null); };

  const set = (k: keyof MasterForm, v: string | number) => setForm(f => f ? { ...f, [k]: v } : f);

  const saveEdit = () => {
    if (!editingId || !form) return;
    if (!form.name.trim() || !form.sku.trim()) return;
    const janCode = form.janCode?.trim() ?? '';
    if (janCode && !/^(\d{8}|\d{13})$/.test(janCode)) return;
    onUpdate(editingId, { ...form, janCode: janCode || undefined });
    cancelEdit();
  };

  return (<>
    <div className="master-toolbar">
      <button className="btn-primary" onClick={onAddClick}>+ 商品追加</button>
    </div>
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>商品名</th>
            <th>SKU</th>
            <th>JANコード</th>
            <th>カテゴリ</th>
            <th>最低在庫数</th>
            <th>販売定価</th>
            <th>原価</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => editingId === p.id && form ? (
            <tr key={p.id} className="master-editing-row">
              <td><input className="master-input" aria-label="商品名" required value={form.name} onChange={e => set('name', e.target.value)} /></td>
              <td><input className="master-input" aria-label="SKU" required value={form.sku} onChange={e => set('sku', e.target.value)} /></td>
              <td><input className="master-input" aria-label="JANコード" inputMode="numeric" pattern="\d{8}|\d{13}" title="8桁または13桁の数字で入力してください" value={form.janCode ?? ''} onChange={e => set('janCode', e.target.value)} /></td>
              <td>
                <select className="master-input" aria-label="カテゴリ" required value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
                  <option value="" disabled>選択してください</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </td>
              <td><input className="master-input" aria-label="最低在庫数" type="number" min={0} value={form.minQuantity} onChange={e => set('minQuantity', +e.target.value)} /></td>
              <td><input className="master-input" aria-label="販売定価" type="number" min={0} value={form.price} onChange={e => set('price', +e.target.value)} /></td>
              <td><input className="master-input" aria-label="原価" type="number" min={0} value={form.costPrice} onChange={e => set('costPrice', +e.target.value)} /></td>
              <td>
                <div className="row-actions">
                  <button className="btn-primary" onClick={saveEdit}>保存</button>
                  <button className="btn-secondary" onClick={cancelEdit}>キャンセル</button>
                </div>
              </td>
            </tr>
          ) : (
            <tr key={p.id}>
              <td><strong>{p.name}</strong></td>
              <td className="mono">{p.sku}</td>
              <td className="mono">{p.janCode || '—'}</td>
              <td><span className="badge">{categories.find(c => c.id === p.categoryId)?.name ?? '—'}</span></td>
              <td>{p.minQuantity}</td>
              <td>¥{p.price.toLocaleString()}</td>
              <td>¥{p.costPrice.toLocaleString()}</td>
              <td>
                <div className="row-actions">
                  <button className="btn-edit" onClick={() => startEdit(p)}>編集</button>
                  <button className="btn-delete" onClick={() => { if (confirm(`「${p.name}」を削除しますか？`)) onDelete(p.id); }}>削除</button>
                </div>
              </td>
            </tr>
          ))}
          {products.length === 0 && <tr><td colSpan={8} className="empty">商品がありません</td></tr>}
        </tbody>
      </table>
    </div>
  </>);
}
