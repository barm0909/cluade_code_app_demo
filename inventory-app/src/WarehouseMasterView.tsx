import { useState } from 'react';
import type { Warehouse, Product } from './useInventory';

interface Props {
  warehouses: Warehouse[];
  products: Product[];
  onAdd: (name: string, color: string) => void;
  onUpdate: (id: string, name: string, color: string) => void;
  onDelete: (id: string) => void;
}

const DEFAULT_NEW_COLOR = '#4f6ef7';

export function WarehouseMasterView({ warehouses, products, onAdd, onUpdate, onDelete }: Props) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_NEW_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // 使用ロット数 = この倉庫を参照しているロットの数 (0 のときだけ削除可)
  const usageCount = (id: string) => products.reduce((s, p) => s + p.lots.filter(l => l.warehouseId === id).length, 0);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAdd(newName.trim(), newColor);
    setNewName('');
    setNewColor(DEFAULT_NEW_COLOR);
  };

  const startEdit = (w: Warehouse) => { setEditingId(w.id); setEditName(w.name); setEditColor(w.color); };
  const cancelEdit = () => { setEditingId(null); setEditName(''); setEditColor(''); };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    onUpdate(editingId, editName.trim(), editColor);
    cancelEdit();
  };

  return (
    <section className="warehouse-master">
      <h3 className="master-section-title">倉庫マスタ</h3>
      <form className="warehouse-add-form" onSubmit={handleAdd}>
        <input
          className="master-input"
          aria-label="新規倉庫名"
          placeholder="新しい倉庫名"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <input
          className="color-input"
          aria-label="新規倉庫カラー"
          type="color"
          value={newColor}
          onChange={e => setNewColor(e.target.value)}
        />
        <button type="submit" className="btn-primary">+ 倉庫追加</button>
      </form>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>倉庫名</th>
              <th>カラー</th>
              <th>使用ロット数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map(w => {
              const count = usageCount(w.id);
              return editingId === w.id ? (
                <tr key={w.id} className="master-editing-row">
                  <td><input className="master-input" aria-label="倉庫名" required value={editName} onChange={e => setEditName(e.target.value)} /></td>
                  <td><input className="color-input" aria-label="倉庫カラー" type="color" value={editColor} onChange={e => setEditColor(e.target.value)} /></td>
                  <td>{count}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-primary" onClick={saveEdit}>保存</button>
                      <button className="btn-secondary" onClick={cancelEdit}>キャンセル</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={w.id}>
                  <td>
                    <span className="wh-badge" style={{ borderColor: w.color, color: w.color }}>
                      <span className="wh-dot" style={{ background: w.color }} />
                      {w.name}
                    </span>
                  </td>
                  <td><span className="color-swatch" style={{ background: w.color }} title={w.color} /></td>
                  <td>{count}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-edit" onClick={() => startEdit(w)}>編集</button>
                      <button
                        className="btn-delete"
                        disabled={count > 0}
                        title={count > 0 ? 'ロットが使用中の倉庫は削除できません' : undefined}
                        onClick={() => { if (confirm(`倉庫「${w.name}」を削除しますか？`)) onDelete(w.id); }}
                      >削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {warehouses.length === 0 && <tr><td colSpan={4} className="empty">倉庫がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
