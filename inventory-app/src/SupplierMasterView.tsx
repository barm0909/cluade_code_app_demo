import { useMemo, useState } from 'react';
import type { InboundPlan, Supplier, SupplierInput } from './useInventory';
import { csvExportHint, csvExportLabel, exportSupplierCsv, supplierRows } from './useInventory';
import { SupplierModal } from './SupplierModal';
import { useConfirm } from './useConfirm';

interface Props {
  suppliers: Supplier[];
  inboundPlans: InboundPlan[];
  onAdd: (data: SupplierInput) => void;
  onUpdate: (id: string, data: SupplierInput) => void;
  onDelete: (id: string) => void;
}

/**
 * 仕入先マスタ (商品マスタタブの最後のセクション)。
 * 一覧の絞り込みと入荷予定の集計は純粋関数 supplierRows に任せ、この画面は表示と
 * 操作の受け渡しだけを持つ (他のマスタ・一覧画面と同じ構成)。
 */
export function SupplierMasterView({ suppliers, inboundPlans, onAdd, onUpdate, onDelete }: Props) {
  const [keyword, setKeyword] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  // 編集対象は id で持ち、常に最新の仕入先を引き直す
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const rows = useMemo(
    () => supplierRows(suppliers, inboundPlans, keyword, showInactive),
    [suppliers, inboundPlans, keyword, showInactive],
  );

  const editingSupplier = editingId && editingId !== 'new' ? suppliers.find(s => s.id === editingId) ?? null : null;

  return (
    <section className="supplier-master">
      <h3 className="master-section-title">仕入先マスタ</h3>

      <div className="controls supplier-controls">
        <input
          className="search-input"
          placeholder="仕入先名・コード・担当者・電話・メールで検索..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <label className="supplier-inactive-check">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          取引停止も表示
        </label>
        <button
          className="btn-add-lot"
          disabled={rows.length === 0}
          onClick={() => exportSupplierCsv(rows)}
          title={csvExportHint('supplier')}
        >
          {csvExportLabel('supplier')}
        </button>
        <button className="btn-primary" onClick={() => setEditingId('new')}>+ 仕入先追加</button>
      </div>

      <div className="table-wrapper supplier-table">
        <table>
          <thead>
            <tr>
              <th>仕入先名</th>
              <th>コード</th>
              <th>担当者</th>
              <th>連絡先</th>
              <th style={{ textAlign: 'right' }}>リードタイム</th>
              <th>入荷予定</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ supplier: s, usage }) => (
              <tr key={s.id} className={s.active ? '' : 'supplier-inactive'}>
                <td>
                  <strong>{s.name}</strong>
                  {s.note && <div className="supplier-note">{s.note}</div>}
                </td>
                <td className="mono">{s.code || '—'}</td>
                <td>{s.contact || '—'}</td>
                <td>
                  {s.phone || s.email
                    ? <span className="supplier-contact">{s.phone}{s.phone && s.email && <br />}{s.email}</span>
                    : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{s.leadTimeDays}日</td>
                <td>
                  {usage.planCount === 0 ? '—' : (<>
                    {usage.planCount}件
                    {usage.pendingCount > 0 && (
                      <span className="qty-move">（入荷待ち {usage.pendingCount}件 / {usage.pendingQuantity.toLocaleString()}）</span>
                    )}
                    {usage.overdueCount > 0 && <span className="inbound-overdue" title="入荷予定日を過ぎています">遅延 {usage.overdueCount}</span>}
                  </>)}
                </td>
                <td>
                  <span className={`badge ${s.active ? 'status-done' : 'status-canceled'}`}>{s.active ? '取引中' : '取引停止'}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-edit" onClick={() => setEditingId(s.id)}>編集</button>
                    <button
                      className="btn-move"
                      title={s.active ? '新規の入荷予定で選べないようにします（過去の予定は残ります）' : '取引を再開し、入荷予定で選べるようにします'}
                      onClick={() => onUpdate(s.id, { ...s, active: !s.active })}
                    >{s.active ? '取引停止' : '取引再開'}</button>
                    <button
                      className="btn-delete"
                      disabled={usage.planCount > 0}
                      title={usage.planCount > 0 ? '入荷予定で使用中の仕入先は削除できません（取引停止にしてください）' : undefined}
                      onClick={async () => {
                        const ok = await confirm({
                          message: `仕入先「${s.name}」を削除しますか？`,
                          confirmLabel: '削除',
                          tone: 'danger',
                        });
                        if (ok) onDelete(s.id);
                      }}
                    >削除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  {suppliers.length === 0
                    ? '仕入先がありません。「+ 仕入先追加」から登録してください。'
                    : '条件に一致する仕入先がありません。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <SupplierModal
          supplier={editingSupplier}
          suppliers={suppliers}
          onSave={data => editingId === 'new' ? onAdd(data) : onUpdate(editingId, data)}
          onClose={() => setEditingId(null)}
        />
      )}
      {confirmDialog}
    </section>
  );
}
