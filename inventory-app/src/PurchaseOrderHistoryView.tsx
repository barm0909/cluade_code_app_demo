import { useMemo, useState } from 'react';
import {
  EMPTY_PURCHASE_ORDER_HISTORY_FILTER,
  csvExportHint,
  csvExportLabel,
  exportPurchaseOrderHistoryCsv,
  formatLedgerDateTime,
  purchaseOrderPrintGroups,
} from './useInventory';
import type { PurchaseOrderHistoryFilter, PurchaseOrderPrintItem, Supplier } from './useInventory';
import { PurchaseOrderReprintModal } from './PurchaseOrderReprintModal';

interface Props {
  prints: PurchaseOrderPrintItem[];
  suppliers: Supplier[];
}

/**
 * 発注履歴タブ。発注書として印刷した明細のスナップショットを、印刷操作 (印刷した1回 = 1枚の
 * 発注書) ごとにまとめて一覧する。絞り込み・集計は純粋関数 purchaseOrderPrintGroups に任せ、
 * この画面は表示と再表示・CSV の受け渡しだけを持つ (CostHistoryView / LedgerView と同じ構成)。
 *
 * 行の「再表示」で開く PurchaseOrderReprintModal は印刷時点のスナップショットをそのまま表示する
 * (現在の商品名や仕入先情報を改名・変更していても、印刷した当時の内容のまま変わらない —
 * 帳票の過去記録と同じ扱い)。
 */
export function PurchaseOrderHistoryView({ prints, suppliers }: Props) {
  const [filter, setFilter] = useState<PurchaseOrderHistoryFilter>(EMPTY_PURCHASE_ORDER_HISTORY_FILTER);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const set = <K extends keyof PurchaseOrderHistoryFilter>(key: K, value: PurchaseOrderHistoryFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const allGroups = useMemo(() => purchaseOrderPrintGroups(prints), [prints]);
  const groups = useMemo(() => purchaseOrderPrintGroups(prints, filter), [prints, filter]);
  const openGroup = openGroupId ? allGroups.find(g => g.printGroupId === openGroupId) ?? null : null;
  const isFiltered = (Object.keys(EMPTY_PURCHASE_ORDER_HISTORY_FILTER) as (keyof PurchaseOrderHistoryFilter)[])
    .some(k => filter[k] !== EMPTY_PURCHASE_ORDER_HISTORY_FILTER[k]);

  if (allGroups.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">発注履歴がありません。商品マスタ内の仕入先マスタの「発注書」から印刷すると、ここに記録されます。</p>
      </div>
    );
  }

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="仕入先名・商品名・SKUで検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <label className="ledger-date-range">
          <input type="date" aria-label="印刷日（開始）" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="印刷日（終了）" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        <select aria-label="仕入先" value={filter.supplierId} onChange={e => set('supplierId', e.target.value)}>
          <option value="">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_PURCHASE_ORDER_HISTORY_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{groups.length}件{isFiltered ? ` / 全${allGroups.length}件` : ''}</span>
        <button
          className="btn-add-lot"
          disabled={groups.length === 0}
          onClick={() => exportPurchaseOrderHistoryCsv(groups)}
          title={csvExportHint('purchaseOrderHistory')}
        >
          {csvExportLabel('purchaseOrderHistory')}
        </button>
      </div>

      <div className="table-wrapper">
        {groups.length === 0 ? (
          <p className="empty">条件に一致する発注履歴がありません。</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>印刷日時</th>
              <th>発注日</th>
              <th>仕入先</th>
              <th style={{ textAlign: 'right' }}>件数</th>
              <th style={{ textAlign: 'right' }}>数量</th>
              <th style={{ textAlign: 'right' }}>金額</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.printGroupId}>
                <td className="mono">{formatLedgerDateTime(g.printedAt)}</td>
                <td className="mono">{g.orderDate}</td>
                <td><strong>{g.supplierName}</strong></td>
                <td style={{ textAlign: 'right' }}>{g.items.length}</td>
                <td style={{ textAlign: 'right' }}>{g.totalQuantity.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>¥{g.totalAmount.toLocaleString()}</td>
                <td>
                  <button className="btn-edit" onClick={() => setOpenGroupId(g.printGroupId)}>再表示</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {openGroup && (
        <PurchaseOrderReprintModal group={openGroup} onClose={() => setOpenGroupId(null)} />
      )}
    </>
  );
}
