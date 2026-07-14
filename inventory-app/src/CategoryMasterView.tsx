import { useState } from 'react';
import type { Category, Product } from './useInventory';

interface Props {
  categories: Category[];
  products: Product[];
  onAdd: (name: string) => void;
  onUpdate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function CategoryMasterView({ categories, products, onAdd, onUpdate, onDelete }: Props) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const usageCount = (id: string) => products.filter(p => p.categoryId === id).length;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAdd(newName);
    setNewName('');
  };

  const startEdit = (c: Category) => { setEditingId(c.id); setEditName(c.name); };
  const cancelEdit = () => { setEditingId(null); setEditName(''); };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    onUpdate(editingId, editName);
    cancelEdit();
  };

  return (
    <section className="category-master">
      <h3 className="master-section-title">カテゴリマスタ</h3>
      <form className="category-add-form" onSubmit={handleAdd}>
        <input
          className="master-input"
          aria-label="新規カテゴリ名"
          placeholder="新しいカテゴリ名"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button type="submit" className="btn-primary">+ カテゴリ追加</button>
      </form>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>カテゴリ名</th>
              <th>使用商品数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(c => {
              const count = usageCount(c.id);
              return editingId === c.id ? (
                <tr key={c.id} className="master-editing-row">
                  <td><input className="master-input" aria-label="カテゴリ名" required value={editName} onChange={e => setEditName(e.target.value)} /></td>
                  <td>{count}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-primary" onClick={saveEdit}>保存</button>
                      <button className="btn-secondary" onClick={cancelEdit}>キャンセル</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td><span className="badge">{c.name}</span></td>
                  <td>{count}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-edit" onClick={() => startEdit(c)}>編集</button>
                      <button
                        className="btn-delete"
                        disabled={count > 0}
                        title={count > 0 ? '使用中のカテゴリは削除できません' : undefined}
                        onClick={() => { if (confirm(`カテゴリ「${c.name}」を削除しますか？`)) onDelete(c.id); }}
                      >削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {categories.length === 0 && <tr><td colSpan={3} className="empty">カテゴリがありません</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
