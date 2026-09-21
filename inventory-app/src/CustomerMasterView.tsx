import { useMemo, useState } from 'react';
import type { Customer, CustomerInput, SalesRow } from './useInventory';
import { csvExportHint, csvExportLabel, customerRows, exportCustomerCsv, localDateKey } from './useInventory';
import { CustomerModal } from './CustomerModal';
import { useConfirm } from './useConfirm';

interface Props {
  customers: Customer[];
  /** 売上明細 (帳票の売上出庫から組み立てたもの)。得意先ごとの実績と削除可否の判定に使う */
  sales: SalesRow[];
  onAdd: (data: CustomerInput) => void;
  onUpdate: (id: string, data: CustomerInput) => void;
  onDelete: (id: string) => void;
}

/**
 * 得意先マスタ (商品マスタタブの最後のセクション)。
 * 一覧の絞り込みと売上実績の集計は純粋関数 customerRows に任せ、この画面は表示と
 * 操作の受け渡しだけを持つ (仕入先マスタと同じ構成)。
 */
export function CustomerMasterView({ customers, sales, onAdd, onUpdate, onDelete }: Props) {
  const [keyword, setKeyword] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  // 編集対象は id で持ち、常に最新の得意先を引き直す
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const rows = useMemo(
    () => customerRows(customers, sales, keyword, showInactive),
    [customers, sales, keyword, showInactive],
  );

  const editingCustomer = editingId && editingId !== 'new' ? customers.find(c => c.id === editingId) ?? null : null;

  return (
    <section className="supplier-master">
      <h3 className="master-section-title">得意先マスタ</h3>

      <div className="controls supplier-controls">
        <input
          className="search-input"
          placeholder="得意先名・コード・担当者・電話・メールで検索..."
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
          onClick={() => exportCustomerCsv(rows)}
          title={csvExportHint('customer')}
        >
          {csvExportLabel('customer')}
        </button>
        <button className="btn-primary" onClick={() => setEditingId('new')}>+ 得意先追加</button>
      </div>

      <div className="table-wrapper supplier-table">
        <table>
          <thead>
            <tr>
              <th>得意先名</th>
              <th>コード</th>
              <th>担当者</th>
              <th>連絡先</th>
              <th style={{ textAlign: 'right' }}>売上件数</th>
              <th style={{ textAlign: 'right' }}>売上金額</th>
              <th>最終売上</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ customer: c, usage }) => (
              <tr key={c.id} className={c.active ? '' : 'supplier-inactive'}>
                <td>
                  <strong>{c.name}</strong>
                  {c.note && <div className="supplier-note">{c.note}</div>}
                </td>
                <td className="mono">{c.code || '—'}</td>
                <td>{c.contact || '—'}</td>
                <td>
                  {c.phone || c.email
                    ? <span className="supplier-contact">{c.phone}{c.phone && c.email && <br />}{c.email}</span>
                    : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {usage.saleCount === 0 ? '—' : `${usage.saleCount}件`}
                  {usage.quantity > 0 && <span className="stat-sub">（{usage.quantity.toLocaleString()}個）</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {usage.saleCount === 0 ? '—' : `¥${usage.amount.toLocaleString()}`}
                  {usage.saleCount > 0 && <div className="stat-sub">粗利 ¥{usage.profit.toLocaleString()}</div>}
                </td>
                <td className="mono">{usage.lastSaleAt ? localDateKey(usage.lastSaleAt) : '—'}</td>
                <td>
                  <span className={`badge ${c.active ? 'status-done' : 'status-canceled'}`}>{c.active ? '取引中' : '取引停止'}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-edit" onClick={() => setEditingId(c.id)}>編集</button>
                    <button
                      className="btn-move"
                      title={c.active ? '新規の売上登録で選べないようにします（過去の売上は残ります）' : '取引を再開し、売上登録で選べるようにします'}
                      onClick={() => onUpdate(c.id, { ...c, active: !c.active })}
                    >{c.active ? '取引停止' : '取引再開'}</button>
                    <button
                      className="btn-delete"
                      disabled={usage.saleCount > 0}
                      title={usage.saleCount > 0 ? '売上の記録がある得意先は削除できません（取引停止にしてください）' : undefined}
                      onClick={async () => {
                        const ok = await confirm({
                          message: `得意先「${c.name}」を削除しますか？`,
                          confirmLabel: '削除',
                          tone: 'danger',
                        });
                        if (ok) onDelete(c.id);
                      }}
                    >削除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  {customers.length === 0
                    ? '得意先がありません。「+ 得意先追加」から登録してください。'
                    : '条件に一致する得意先がありません。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <CustomerModal
          customer={editingCustomer}
          customers={customers}
          onSave={data => editingId === 'new' ? onAdd(data) : onUpdate(editingId, data)}
          onClose={() => setEditingId(null)}
        />
      )}
      {confirmDialog}
    </section>
  );
}
