import { useState, useMemo } from 'react';
import { useInventory, daysUntilExpiry, totalQuantity } from './useInventory';
import type { Product, Lot, Warehouse, SortField, SortOrder } from './useInventory';
import { ProductModal } from './ProductModal';
import { LotModal } from './LotModal';
import { LedgerView } from './LedgerView';
import './App.css';

function ExpiryBadge({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return <span className="expiry-none">—</span>;
  const days = daysUntilExpiry(expiryDate);
  if (days < 0) return <span className="expiry-badge expired">期限切れ</span>;
  if (days === 0) return <span className="expiry-badge expiring-today">今日まで</span>;
  if (days <= 7) return <span className="expiry-badge expiring-soon">{days}日後</span>;
  return <span className="expiry-badge ok">{expiryDate}</span>;
}

function WarehouseDot({ warehouse }: { warehouse?: Warehouse }) {
  if (!warehouse) return <span className="wh-unknown">—</span>;
  return (
    <span className="wh-badge" style={{ borderColor: warehouse.color, color: warehouse.color }}>
      <span className="wh-dot" style={{ background: warehouse.color }} />
      {warehouse.name}
    </span>
  );
}

function lotRowClass(lot: Lot) {
  if (!lot.expiryDate) return '';
  const d = daysUntilExpiry(lot.expiryDate);
  if (d < 0) return 'lot-expired';
  if (d <= 7) return 'lot-expiring';
  return '';
}

interface MoveLotModalProps {
  lot: Lot;
  product: Product;
  warehouses: Warehouse[];
  onMove: (targetWarehouseId: string, quantity: number) => void;
  onClose: () => void;
}

function MoveLotModal({ lot, product, warehouses, onMove, onClose }: MoveLotModalProps) {
  const [targetId, setTargetId] = useState(() => {
    const others = warehouses.filter(w => w.id !== lot.warehouseId);
    return others[0]?.id ?? '';
  });
  const [qty, setQty] = useState(lot.quantity);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || qty <= 0) return;
    onMove(targetId, qty);
    onClose();
  };

  const currentWh = warehouses.find(w => w.id === lot.warehouseId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>ロット移動</h2>
        <p className="move-lot-info">
          <strong>{product.name}</strong> — ロット {lot.lotNo}<br />
          移動元: <WarehouseDot warehouse={currentWh} /> （在庫: {lot.quantity}）
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="move-target">
            移動先倉庫
            <select id="move-target" value={targetId} onChange={e => setTargetId(e.target.value)}>
              {warehouses.filter(w => w.id !== lot.warehouseId).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label htmlFor="move-qty">
            移動数量
            <input
              id="move-qty"
              type="number"
              min={1}
              max={lot.quantity}
              required
              value={qty}
              onChange={e => setQty(+e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!targetId}>移動</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, moveLot } = useInventory();
  const [editingProduct, setEditingProduct] = useState<Product | null | 'new'>(null);
  const [editingLot, setEditingLot] = useState<{ productId: string; lot: Lot | null } | null>(null);
  const [movingLot, setMovingLot] = useState<{ product: Product; lot: Lot } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [activeTab, setActiveTab] = useState<'inventory' | 'ledger'>('inventory');

  const categories = useMemo(() => [...new Set(products.map(p => p.category))].sort(), [products]);

  const filtered = useMemo(() => {
    let list = products.filter(p => {
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      const matchCategory = !categoryFilter || p.category === categoryFilter;
      const matchWarehouse = !warehouseFilter || p.lots.some(l => l.warehouseId === warehouseFilter);
      return matchSearch && matchCategory && matchWarehouse;
    });
    return [...list].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [products, search, categoryFilter, warehouseFilter, sortField, sortOrder]);

  const allLots = products.flatMap(p => p.lots);
  const expired = allLots.filter(l => l.expiryDate && daysUntilExpiry(l.expiryDate) < 0);
  const expiringSoon = allLots.filter(l => l.expiryDate && daysUntilExpiry(l.expiryDate) >= 0 && daysUntilExpiry(l.expiryDate) <= 7);
  const lowStock = products.filter(p => totalQuantity(p) <= p.minQuantity);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };
  const sortIcon = (field: SortField) => sortField === field ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';

  const totalValue = products.reduce((s, p) => s + totalQuantity(p) * p.price, 0);

  const productRowClass = (p: Product) => {
    const hasExpired = p.lots.some(l => l.expiryDate && daysUntilExpiry(l.expiryDate) < 0);
    const hasExpiring = p.lots.some(l => l.expiryDate && daysUntilExpiry(l.expiryDate) >= 0 && daysUntilExpiry(l.expiryDate) <= 7);
    if (hasExpired) return 'row-expired';
    if (hasExpiring) return 'row-expiring';
    if (totalQuantity(p) <= p.minQuantity) return 'row-alert';
    return '';
  };

  const visibleLots = (p: Product) => warehouseFilter
    ? p.lots.filter(l => l.warehouseId === warehouseFilter)
    : p.lots;

  return (
    <div className="app">
      <header className="header">
        <h1>食品在庫管理システム</h1>
        <div className="header-actions">
          <button className="btn-ghost" onClick={() => { if (confirm('サンプルデータにリセットしますか？')) resetToSample(); }}>リセット</button>
          <button className="btn-secondary" onClick={exportCsv}>CSVエクスポート</button>
          <button className="btn-secondary" onClick={exportExcel}>Excelエクスポート</button>
          <label className="btn-secondary" style={{ cursor: 'pointer' }}>
            Excelインポート
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              try {
                const { updated, errors } = await importExcel(file);
                const msg = `${updated}件の在庫数を更新しました。` + (errors.length ? `\n\n警告:\n${errors.join('\n')}` : '');
                alert(msg);
              } catch {
                alert('Excelファイルの読み込みに失敗しました。');
              }
            }} />
          </label>
          <button className="btn-primary" onClick={() => setEditingProduct('new')}>+ 商品追加</button>
        </div>
      </header>

      {expired.length > 0 && (
        <div className="alert-banner danger"><strong>期限切れロットあり:</strong> {expired.map(l => l.lotNo).join('、')}</div>
      )}
      {expiringSoon.length > 0 && (
        <div className="alert-banner warning"><strong>期限間近（7日以内）:</strong> {expiringSoon.map(l => `${l.lotNo}（${daysUntilExpiry(l.expiryDate!)}日後）`).join('、')}</div>
      )}
      {lowStock.length > 0 && (
        <div className="alert-banner info"><strong>在庫不足:</strong> {lowStock.map(p => `${p.name}（残${totalQuantity(p)}）`).join('、')}</div>
      )}

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">総商品数</div><div className="stat-value">{products.length}</div></div>
        <div className="stat-card"><div className="stat-label">期限切れロット</div><div className="stat-value expired-text">{expired.length}</div></div>
        <div className="stat-card"><div className="stat-label">期限間近ロット</div><div className="stat-value warning-text">{expiringSoon.length}</div></div>
        <div className="stat-card"><div className="stat-label">在庫総額</div><div className="stat-value">¥{totalValue.toLocaleString()}</div></div>
      </div>

      <div className="tabs">
        <button className={activeTab === 'inventory' ? 'tab active' : 'tab'} onClick={() => setActiveTab('inventory')}>在庫一覧</button>
        <button className={activeTab === 'ledger' ? 'tab active' : 'tab'} onClick={() => setActiveTab('ledger')}>入出庫帳票</button>
      </div>

      {activeTab === 'ledger' ? (
        <LedgerView ledger={ledger} warehouses={warehouses} />
      ) : (<>

      <div className="controls">
        <input className="search-input" placeholder="商品名・SKUで検索..." value={search} onChange={e => setSearch(e.target.value)} />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">全カテゴリ</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}>
          <option value="">全倉庫</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th onClick={() => toggleSort('name')} className="sortable">商品名{sortIcon('name')}</th>
              <th onClick={() => toggleSort('sku')} className="sortable">SKU{sortIcon('sku')}</th>
              <th onClick={() => toggleSort('category')} className="sortable">カテゴリ{sortIcon('category')}</th>
              <th>合計在庫</th>
              <th onClick={() => toggleSort('price')} className="sortable">販売定価{sortIcon('price')}</th>
              <th onClick={() => toggleSort('costPrice')} className="sortable">原価{sortIcon('costPrice')}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const expanded = expandedIds.has(p.id);
              const qty = totalQuantity(p);
              const lots = visibleLots(p);
              return (
                <>
                  <tr key={p.id} className={`product-row ${productRowClass(p)}`} onClick={() => toggleExpand(p.id)}>
                    <td className="expand-cell">{expanded ? '▼' : '▶'}</td>
                    <td><strong>{p.name}</strong></td>
                    <td className="mono">{p.sku}</td>
                    <td><span className="badge">{p.category}</span></td>
                    <td>
                      <span className={qty <= p.minQuantity ? 'qty-low' : ''}>{qty}</span>
                      <span className="lot-count">（{p.lots.length}ロット）</span>
                    </td>
                    <td>¥{p.price.toLocaleString()}</td>
                    <td>¥{p.costPrice.toLocaleString()}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="btn-edit" onClick={() => setEditingProduct(p)}>編集</button>
                        <button className="btn-delete" onClick={() => { if (confirm(`「${p.name}」を削除しますか？`)) deleteProduct(p.id); }}>削除</button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${p.id}-lots`} className="lot-row-wrapper">
                      <td colSpan={8} className="lot-cell">
                        <div className="lot-section">
                          <div className="lot-header">
                            <span>ロット一覧</span>
                            <button className="btn-add-lot" onClick={() => setEditingLot({ productId: p.id, lot: null })}>+ ロット追加</button>
                          </div>
                          {lots.length === 0
                            ? <p className="lot-empty">ロットがありません。「+ ロット追加」から追加してください。</p>
                            : (
                              <table className="lot-table">
                                <thead>
                                  <tr>
                                    <th>ロットNo</th>
                                    <th>賞味期限</th>
                                    <th>倉庫</th>
                                    <th>在庫数</th>
                                    <th>操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lots.map(l => (
                                    <tr key={l.id} className={lotRowClass(l)}>
                                      <td className="mono">{l.lotNo}</td>
                                      <td><ExpiryBadge expiryDate={l.expiryDate} /></td>
                                      <td><WarehouseDot warehouse={warehouses.find(w => w.id === l.warehouseId)} /></td>
                                      <td>
                                        <div className="qty-control">
                                          <button onClick={() => adjustLotQuantity(p.id, l.id, -1)} disabled={l.quantity === 0}>-</button>
                                          <span>{l.quantity}</span>
                                          <button onClick={() => adjustLotQuantity(p.id, l.id, 1)}>+</button>
                                        </div>
                                      </td>
                                      <td>
                                        <div className="row-actions">
                                          <button className="btn-move" onClick={() => setMovingLot({ product: p, lot: l })}>移動</button>
                                          <button className="btn-edit" onClick={() => setEditingLot({ productId: p.id, lot: l })}>編集</button>
                                          <button className="btn-delete" onClick={() => { if (confirm(`ロット「${l.lotNo}」を削除しますか？`)) deleteLot(p.id, l.id); }}>削除</button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )
                          }
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="empty">商品が見つかりません</td></tr>}
          </tbody>
        </table>
      </div>
      </>)}

      {editingProduct !== null && (
        <ProductModal
          product={editingProduct === 'new' ? null : editingProduct}
          onSave={data => editingProduct === 'new' ? addProduct(data) : updateProduct((editingProduct as Product).id, data)}
          onClose={() => setEditingProduct(null)}
        />
      )}
      {editingLot !== null && (
        <LotModal
          lot={editingLot.lot}
          warehouses={warehouses}
          onSave={data => editingLot.lot
            ? updateLot(editingLot.productId, editingLot.lot.id, data)
            : addLot(editingLot.productId, data)
          }
          onClose={() => setEditingLot(null)}
        />
      )}
      {movingLot !== null && (
        <MoveLotModal
          lot={movingLot.lot}
          product={movingLot.product}
          warehouses={warehouses}
          onMove={(targetId, qty) => moveLot(movingLot.product.id, movingLot.lot.id, targetId, qty)}
          onClose={() => setMovingLot(null)}
        />
      )}
    </div>
  );
}
