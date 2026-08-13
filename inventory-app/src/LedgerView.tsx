import { useMemo, useState } from 'react';
import {
  ALL_TRANSACTION_TYPES,
  EMPTY_LEDGER_FILTER,
  csvExportHint,
  csvExportLabel,
  exportLedgerCsv,
  filterLedger,
  formatLedgerDateTime,
  ledgerTotals,
  transactionDirection,
} from './useInventory';
import type { LedgerFilter, StockTransaction, TransactionType, Warehouse } from './useInventory';

interface Props {
  ledger: StockTransaction[];
  warehouses: Warehouse[];
}

export function LedgerView({ ledger, warehouses }: Props) {
  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_LEDGER_FILTER);

  const whName = (id?: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '';
  const set = <K extends keyof LedgerFilter>(key: K, value: LedgerFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const filtered = useMemo(() => filterLedger(ledger, filter), [ledger, filter]);
  const totals = useMemo(() => ledgerTotals(filtered), [filtered]);
  const isFiltered = useMemo(
    () => (Object.keys(EMPTY_LEDGER_FILTER) as (keyof LedgerFilter)[]).some(k => filter[k] !== EMPTY_LEDGER_FILTER[k]),
    [filter],
  );

  if (ledger.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">入出庫の記録がありません。ロット追加や在庫数の調整を行うと記録されます。</p>
      </div>
    );
  }

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="商品名・SKU・ロットNoで検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <label className="ledger-date-range">
          <input type="date" aria-label="開始日" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="終了日" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        <select aria-label="区分" value={filter.type} onChange={e => set('type', e.target.value as TransactionType | '')}>
          <option value="">全区分</option>
          {ALL_TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="倉庫" value={filter.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
          <option value="">全倉庫</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_LEDGER_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{filtered.length}件{isFiltered ? ` / 全${ledger.length}件` : ''}</span>
        <span className="qty-in">入庫 +{totals.inbound.toLocaleString()}</span>
        <span className="qty-out">出庫 -{totals.outbound.toLocaleString()}</span>
        <span className="qty-move">移動 {totals.move.toLocaleString()}</span>
        <button
          className="btn-add-lot"
          disabled={filtered.length === 0}
          onClick={() => exportLedgerCsv(filtered, warehouses)}
          title={csvExportHint('ledger')}
        >
          {csvExportLabel('ledger')}
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
              <th>区分</th>
              <th>商品名</th>
              <th>SKU</th>
              <th>ロットNo</th>
              <th style={{ textAlign: 'right' }}>数量</th>
              <th>倉庫</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(txn => {
              const dir = transactionDirection(txn.type);
              return (
              <tr key={txn.id}>
                <td className="mono">{formatLedgerDateTime(txn.date)}</td>
                <td>
                  <span className={`badge badge-${dir}`}>
                    {txn.type}
                  </span>
                </td>
                <td><strong>{txn.productName}</strong></td>
                <td className="mono">{txn.productSku}</td>
                <td className="mono">{txn.lotNo}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  <span className={`qty-${dir}`}>
                    {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}{txn.quantity}
                  </span>
                </td>
                <td style={{ fontSize: '0.85rem', color: '#555' }}>
                  {txn.type === '移動' && txn.fromWarehouseId && txn.toWarehouseId
                    ? `${whName(txn.fromWarehouseId)} → ${whName(txn.toWarehouseId)}`
                    : whName(txn.toWarehouseId ?? txn.fromWarehouseId)}
                </td>
                <td style={{ color: '#888', fontSize: '0.85rem' }}>{txn.note}</td>
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
