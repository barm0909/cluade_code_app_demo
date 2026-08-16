import { useMemo, useState } from 'react';
import {
  EMPTY_COST_HISTORY_FILTER,
  costHistoryRows,
  costHistoryTotals,
  csvExportHint,
  csvExportLabel,
  exportCostHistoryCsv,
  filterCostHistory,
  formatLedgerDateTime,
} from './useInventory';
import type { CostHistoryFilter, StockTransaction, Supplier } from './useInventory';

interface Props {
  ledger: StockTransaction[];
  suppliers: Supplier[];
}

/**
 * 原価履歴タブ。入荷予定に入力された仕入単価が、入荷のたびに帳票へ書き写された記録を一覧する。
 * 絞り込み・集計・CSV はすべて useInventory.ts の純粋関数 (costHistoryRows / filterCostHistory /
 * costHistoryTotals / costHistoryCsv) に任せ、この画面は表示と操作の受け渡しだけを持つ (LedgerView と同じ構成)。
 */
export function CostHistoryView({ ledger, suppliers }: Props) {
  const [filter, setFilter] = useState<CostHistoryFilter>(EMPTY_COST_HISTORY_FILTER);

  const set = <K extends keyof CostHistoryFilter>(key: K, value: CostHistoryFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const allRows = useMemo(() => costHistoryRows(ledger, suppliers), [ledger, suppliers]);
  const filtered = useMemo(() => filterCostHistory(allRows, filter), [allRows, filter]);
  const totals = useMemo(() => costHistoryTotals(filtered), [filtered]);
  const isFiltered = useMemo(
    () => (Object.keys(EMPTY_COST_HISTORY_FILTER) as (keyof CostHistoryFilter)[]).some(k => filter[k] !== EMPTY_COST_HISTORY_FILTER[k]),
    [filter],
  );

  if (allRows.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">仕入単価の記録がありません。入荷予定に仕入単価を入力して入荷すると、ここに記録されます。</p>
      </div>
    );
  }

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="商品名・SKU・仕入先で検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <label className="ledger-date-range">
          <input type="date" aria-label="開始日" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="終了日" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        <select aria-label="仕入先" value={filter.supplierId} onChange={e => set('supplierId', e.target.value)}>
          <option value="">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_COST_HISTORY_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{filtered.length}件{isFiltered ? ` / 全${allRows.length}件` : ''}</span>
        <span>平均仕入単価 ¥{Math.round(totals.averageUnitPrice).toLocaleString()}</span>
        <span>仕入金額合計 ¥{totals.amount.toLocaleString()}</span>
        <button
          className="btn-add-lot"
          disabled={filtered.length === 0}
          onClick={() => exportCostHistoryCsv(filtered)}
          title={csvExportHint('costHistory')}
        >
          {csvExportLabel('costHistory')}
        </button>
      </div>

      <div className="table-wrapper">
        {filtered.length === 0 ? (
          <p className="empty">条件に一致する記録がありません。</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>商品名</th>
              <th>SKU</th>
              <th>ロットNo</th>
              <th>仕入先</th>
              <th style={{ textAlign: 'right' }}>仕入単価</th>
              <th style={{ textAlign: 'right' }}>前回比</th>
              <th style={{ textAlign: 'right' }}>数量</th>
              <th style={{ textAlign: 'right' }}>金額</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const delta = r.previousUnitPrice != null ? r.unitPrice - r.previousUnitPrice : null;
              return (
                <tr key={r.txnId}>
                  <td className="mono">{formatLedgerDateTime(r.date)}</td>
                  <td><strong>{r.productName}</strong></td>
                  <td className="mono">{r.productSku}</td>
                  <td className="mono">{r.lotNo}</td>
                  <td>{r.supplierName || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>¥{r.unitPrice.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    {delta == null
                      ? <span className="stat-sub">初回</span>
                      : delta === 0
                        ? <span className="stat-sub">±0</span>
                        : (
                          <span className={delta > 0 ? 'qty-out' : 'qty-in'}>
                            {delta > 0 ? '▲' : '▼'}¥{Math.abs(delta).toLocaleString()}
                          </span>
                        )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>¥{r.amount.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </>
  );
}
