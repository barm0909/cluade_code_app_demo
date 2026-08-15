import { useMemo, useState } from 'react';
import {
  csvExportHint,
  csvExportLabel,
  exportLotTraceCsv,
  formatLedgerDateTime,
  lotStockRows,
  lotTraceCandidates,
  traceLot,
} from './useInventory';
import type {
  LotTraceBreakdown,
  LotTraceKey,
  Product,
  StockTransaction,
  Warehouse,
} from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';

interface Props {
  products: Product[];
  warehouses: Warehouse[];
  ledger: StockTransaction[];
  /** 追跡中のロット。null なら候補一覧を表示する */
  target: LotTraceKey | null;
  onTargetChange: (key: LotTraceKey | null) => void;
}

const breakdownText = (rows: LotTraceBreakdown[]) =>
  rows.length === 0 ? '—' : rows.map(r => `${r.type} ${r.quantity.toLocaleString()}`).join(' / ');

export function LotTraceView({ products, warehouses, ledger, target, onTargetChange }: Props) {
  const [keyword, setKeyword] = useState('');

  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);
  const candidates = useMemo(() => lotTraceCandidates(products, ledger, keyword), [products, ledger, keyword]);
  const trace = useMemo(
    () => target ? traceLot(ledger, target.lotNo, { productId: target.productId }) : null,
    [ledger, target],
  );
  const stock = useMemo(() => target ? lotStockRows(products, target) : [], [products, target]);

  if (target && trace) {
    const stockQuantity = stock.reduce((s, r) => s + r.quantity, 0);
    // 追跡中の商品は削除済みのこともあるので、マスタになければ帳票に残った当時の名前を使う
    const product = products.find(p => p.id === target.productId);
    const productName = product?.name || trace.productName || '（削除された商品）';
    const productSku = product?.sku || trace.productSku;
    const mismatched = trace.events.length > 0 && trace.balance !== stockQuantity;

    return (
      <div className="trace">
        <div className="trace-head">
          <button className="btn-ghost-light" onClick={() => onTargetChange(null)}>← ロットの選択に戻る</button>
          <h3 className="trace-title">
            <strong>{productName}</strong>
            <span className="mono trace-title-sku">{productSku}</span>
            <span className="trace-title-lot mono">ロット {target.lotNo}</span>
          </h3>
          <button
            className="btn-add-lot"
            disabled={trace.events.length === 0}
            onClick={() => exportLotTraceCsv(trace, warehouses)}
            title={csvExportHint('trace')}
          >
            {csvExportLabel('trace')}
          </button>
        </div>

        <div className="stats-row dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">入庫合計</div>
            <div className="stat-value qty-in">+{trace.inbound.toLocaleString()}</div>
            <div className="stat-sub">{breakdownText(trace.inboundBreakdown)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">出庫合計（既に出た数量）</div>
            <div className="stat-value qty-out">-{trace.outbound.toLocaleString()}</div>
            <div className="stat-sub">{breakdownText(trace.outboundBreakdown)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">帳票上の残数</div>
            <div className="stat-value">{trace.balance.toLocaleString()}</div>
            <div className="stat-sub">入庫 − 出庫</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">現在庫</div>
            <div className={stockQuantity === 0 ? 'stat-value qty-low' : 'stat-value'}>
              {stockQuantity.toLocaleString()}
            </div>
            <div className="stat-sub">
              {stock.length === 0 ? '在庫なし'
                : stock.length === 1 ? (warehouseById.get(stock[0].warehouseId)?.name ?? stock[0].warehouseId)
                : `${stock.length}倉庫に分散`}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">記録件数</div>
            <div className="stat-value">{trace.events.length.toLocaleString()}</div>
            <div className="stat-sub">移動 {trace.moveCount}件</div>
          </div>
        </div>

        {trace.events.length === 0 && (
          <div className="alert-banner info">
            <strong>入出庫の記録がありません。</strong>
            {stockQuantity > 0
              ? ' 帳票を記録し始める前からある在庫（サンプルデータやリセット直後の初期在庫）です。'
              : ' このロットNoの記録は帳票に残っていません。'}
          </div>
        )}
        {mismatched && (
          <div className="alert-banner warning">
            <strong>帳票上の残数と現在庫が一致しません。</strong>
            {` 帳票 ${trace.balance.toLocaleString()} / 現在庫 ${stockQuantity.toLocaleString()}。`}
            帳票を記録し始める前からあった在庫が含まれている可能性があります。
          </div>
        )}

        <section className="dashboard-section">
          <div className="dashboard-section-head">
            <h3 className="dashboard-section-title">現在の在庫</h3>
            {trace.warehouseIds.length > 0 && (
              <span className="dashboard-section-note trace-route">
                経路: {trace.warehouseIds.map(id => warehouseById.get(id)?.name ?? id).join(' → ')}
              </span>
            )}
          </div>
          <div className="table-wrapper">
            {stock.length === 0 ? (
              <p className="empty">このロットの在庫は残っていません（出庫・廃棄済み、またはロットが削除されています）。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>倉庫</th>
                    <th>賞味期限</th>
                    <th style={{ textAlign: 'right' }}>在庫数</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map(r => (
                    <tr key={r.lotId}>
                      <td><WarehouseDot warehouse={warehouseById.get(r.warehouseId)} /></td>
                      <td><ExpiryBadge expiryDate={r.expiryDate} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.quantity.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="dashboard-section">
          <div className="dashboard-section-head">
            <h3 className="dashboard-section-title">履歴（古い順）</h3>
            {trace.firstDate && (
              <span className="dashboard-section-note">
                {formatLedgerDateTime(trace.firstDate)} 〜 {formatLedgerDateTime(trace.lastDate)}
              </span>
            )}
          </div>
          {trace.events.length === 0 ? (
            <div className="table-wrapper">
              <p className="empty">表示できる履歴がありません。</p>
            </div>
          ) : (
            <ol className="trace-timeline">
              {trace.events.map(e => {
                const { txn } = e;
                const from = warehouseById.get(txn.fromWarehouseId ?? '');
                const to = warehouseById.get(txn.toWarehouseId ?? '');
                return (
                  <li key={txn.id} className={`trace-event trace-${e.direction}`}>
                    <span className="trace-dot" aria-hidden="true" />
                    <div className="trace-card">
                      <div className="trace-card-head">
                        <span className={`badge badge-${e.direction}`}>{txn.type}</span>
                        <span className="mono trace-date">{formatLedgerDateTime(txn.date)}</span>
                        <span className={`trace-qty qty-${e.direction}`}>
                          {e.direction === 'in' ? '+' : e.direction === 'out' ? '-' : ''}{txn.quantity.toLocaleString()}
                        </span>
                        <span className="trace-balance">残 {e.balance.toLocaleString()}</span>
                      </div>
                      <div className="trace-card-body">
                        {e.direction === 'move' ? (
                          <span className="trace-warehouses">
                            <WarehouseDot warehouse={from} />
                            <span className="trace-arrow">→</span>
                            <WarehouseDot warehouse={to} />
                          </span>
                        ) : (
                          <span className="trace-warehouses">
                            <WarehouseDot warehouse={e.direction === 'in' ? to : from} />
                          </span>
                        )}
                        {txn.note && <span className="trace-note">{txn.note}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="ロットNo・商品名・SKUで検索..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        {keyword && <button className="btn-ghost-light" onClick={() => setKeyword('')}>条件クリア</button>}
      </div>

      <div className="ledger-summary">
        <span>{candidates.length}件</span>
        <span className="trace-hint">追跡したいロットの「追跡」を押すと、入荷から出庫までの履歴を時系列で表示します。</span>
      </div>

      <div className="table-wrapper">
        {candidates.length === 0 ? (
          <p className="empty">
            {keyword ? '条件に一致するロットがありません。' : '追跡できるロットがありません。ロットを追加すると表示されます。'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>商品名</th>
                <th>SKU</th>
                <th>ロットNo</th>
                <th>賞味期限</th>
                <th style={{ textAlign: 'right' }}>現在庫</th>
                <th style={{ textAlign: 'right' }}>記録件数</th>
                <th>最終記録</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={`${c.productId} ${c.lotNo}`} className={c.stockQuantity === 0 ? 'trace-gone' : ''}>
                  <td><strong>{c.productName}</strong></td>
                  <td className="mono">{c.productSku}</td>
                  <td className="mono">{c.lotNo}</td>
                  <td><ExpiryBadge expiryDate={c.expiryDate} /></td>
                  <td style={{ textAlign: 'right' }}>
                    {c.stockQuantity === 0
                      ? <span className="badge badge-out">在庫なし</span>
                      : c.stockQuantity.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>{c.eventCount}</td>
                  <td className="mono trace-date">{c.lastDate ? formatLedgerDateTime(c.lastDate) : '—'}</td>
                  <td>
                    <button
                      className="btn-trace"
                      onClick={() => onTargetChange({ productId: c.productId, lotNo: c.lotNo })}
                      title={`${c.productName} ロット${c.lotNo} の履歴を表示します`}
                    >追跡</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
