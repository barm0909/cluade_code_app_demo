import { useMemo, useState } from 'react';
import {
  EMPTY_SALES_FILTER,
  NO_CUSTOMER,
  csvExportHint,
  csvExportLabel,
  exportSalesCsv,
  exportSalesSummaryCsv,
  filterSales,
  formatLedgerDateTime,
  salesCustomerSummaries,
  salesDailySummaries,
  salesProductSummaries,
  salesRows,
  salesTotals,
} from './useInventory';
import type {
  Customer,
  Product,
  SaleInput,
  SalesFilter,
  SalesSummary,
  StockTransaction,
  Warehouse,
} from './useInventory';
import { SalesEntryModal } from './SalesEntryModal';
import { WarehouseDot } from './badges';
import { useNotify } from './useConfirm';

interface Props {
  ledger: StockTransaction[];
  products: Product[];
  customers: Customer[];
  warehouses: Warehouse[];
  /** 売上登録 (FEFO出庫 + 実売単価・得意先の記録)。引当結果を返す */
  onRecordSale: (input: SaleInput) => { allocated: number; shortage: number; cost: number };
}

/** 集計の切り口。1列目の見出しだけが変わるので、表そのものは1つで描ける */
const SUMMARY_MODES = {
  product: '商品別',
  customer: '得意先別',
  daily: '日別',
} as const;

type ViewMode = 'detail' | keyof typeof SUMMARY_MODES;

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * 売上管理タブ。帳票の「売上出庫」を売上明細として一覧し、商品別・得意先別・日別に集計する。
 * 「+ 売上を登録」からの売上計上 (FEFO出庫 + 実売単価・得意先の記録) もこの画面から行う。
 *
 * 絞り込み・集計・CSV はすべて useInventory.ts の純粋関数 (salesRows / filterSales /
 * salesTotals / salesProductSummaries / salesCustomerSummaries / salesDailySummaries) に任せ、
 * この画面は表示と操作の受け渡しだけを持つ (原価履歴・在庫分析と同じ構成)。
 */
export function SalesView({ ledger, products, customers, warehouses, onRecordSale }: Props) {
  const [filter, setFilter] = useState<SalesFilter>(EMPTY_SALES_FILTER);
  const [mode, setMode] = useState<ViewMode>('detail');
  const [entryOpen, setEntryOpen] = useState(false);
  const { notify, notifyDialog } = useNotify();

  const set = <K extends keyof SalesFilter>(key: K, value: SalesFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const allRows = useMemo(() => salesRows(ledger, products, customers), [ledger, products, customers]);
  const filtered = useMemo(() => filterSales(allRows, filter), [allRows, filter]);
  const totals = useMemo(() => salesTotals(filtered), [filtered]);
  const summaries: SalesSummary[] = useMemo(() => {
    if (mode === 'product') return salesProductSummaries(filtered);
    if (mode === 'customer') return salesCustomerSummaries(filtered);
    if (mode === 'daily') return salesDailySummaries(filtered);
    return [];
  }, [mode, filtered]);
  const isFiltered = useMemo(
    () => (Object.keys(EMPTY_SALES_FILTER) as (keyof SalesFilter)[]).some(k => filter[k] !== EMPTY_SALES_FILTER[k]),
    [filter],
  );
  const estimatedCount = useMemo(() => filtered.filter(r => r.estimatedPrice || r.estimatedCost).length, [filtered]);

  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);

  const handleRecordSale = async (input: SaleInput) => {
    const product = products.find(p => p.id === input.productId);
    const plan = onRecordSale(input);
    if (plan.allocated === 0) {
      await notify('在庫が引き当てられなかったため、売上は登録されませんでした。', '売上登録');
      return;
    }
    const amount = input.unitPrice * plan.allocated;
    await notify(
      `${product?.name ?? '商品'}を${plan.allocated}個 出庫し、売上として記録しました。`
      + `\n売上金額 ${yen(amount)} / 原価 ${yen(plan.cost)} / 粗利 ${yen(amount - plan.cost)}`
      + (plan.shortage > 0 ? `\n（在庫不足のため ${plan.shortage} は出庫できていません）` : ''),
      '売上登録',
    );
  };

  return (
    <div className="dashboard">
      <div className="stats-row dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">売上高</div>
          <div className="stat-value">{yen(totals.amount)}</div>
          <div className="stat-sub">{totals.count}件 / {totals.quantity.toLocaleString()}個</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">売上原価</div>
          <div className="stat-value">{yen(totals.cost)}</div>
          <div className="stat-sub">出庫した時点のロット原価</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">粗利</div>
          <div className={totals.profit < 0 ? 'stat-value alert' : 'stat-value'}>{yen(totals.profit)}</div>
          <div className="stat-sub">売上高 − 売上原価</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">粗利率</div>
          <div className="stat-value">{percent(totals.profitRate)}</div>
          <div className="stat-sub">平均単価 {yen(totals.averageUnitPrice)}</div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">売上実績</h3>
          <span className="dashboard-section-note">
            帳票の「売上出庫」から組み立てています（移動・調整出庫・廃棄は売上に含みません）
          </span>
          <button className="btn-primary" onClick={() => setEntryOpen(true)} disabled={products.length === 0}>
            + 売上を登録
          </button>
        </div>

        <div className="controls ledger-controls">
          <input
            className="search-input"
            placeholder="商品名・SKU・得意先で検索..."
            value={filter.keyword}
            onChange={e => set('keyword', e.target.value)}
          />
          <label className="ledger-date-range">
            <input type="date" aria-label="開始日" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
            <span>〜</span>
            <input type="date" aria-label="終了日" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
          </label>
          <select aria-label="得意先" value={filter.customerId} onChange={e => set('customerId', e.target.value)}>
            <option value="">全得意先</option>
            <option value={NO_CUSTOMER}>得意先なし</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="倉庫" value={filter.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
            <option value="">全倉庫</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {isFiltered && (
            <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_SALES_FILTER)}>条件クリア</button>
          )}
        </div>

        <div className="sales-modes" role="group" aria-label="表示の切り替え">
          <button
            className={mode === 'detail' ? 'sales-mode active' : 'sales-mode'}
            onClick={() => setMode('detail')}
          >明細</button>
          {(Object.keys(SUMMARY_MODES) as (keyof typeof SUMMARY_MODES)[]).map(m => (
            <button
              key={m}
              className={mode === m ? 'sales-mode active' : 'sales-mode'}
              onClick={() => setMode(m)}
            >{SUMMARY_MODES[m]}</button>
          ))}
        </div>

        <div className="ledger-summary">
          <span>{filtered.length}件{isFiltered ? ` / 全${allRows.length}件` : ''}</span>
          {estimatedCount > 0 && (
            <span className="stat-sub" title="実売単価や出庫時の原価が記録されていない売上は、商品の販売定価・現在原価で代用しています">
              うち概算 {estimatedCount}件
            </span>
          )}
          {mode === 'detail' ? (
            <button
              className="btn-add-lot"
              disabled={filtered.length === 0}
              onClick={() => exportSalesCsv(filtered, warehouses)}
              title={csvExportHint('sales')}
            >
              {csvExportLabel('sales')}
            </button>
          ) : (
            <button
              className="btn-add-lot"
              disabled={summaries.length === 0}
              onClick={() => exportSalesSummaryCsv(summaries, SUMMARY_MODES[mode])}
              title={csvExportHint('salesSummary')}
            >
              {csvExportLabel('salesSummary')}
            </button>
          )}
        </div>

        <div className="table-wrapper">
          {filtered.length === 0 ? (
            <p className="empty">
              {allRows.length === 0
                ? '売上の記録がありません。「+ 売上を登録」から売上を計上すると、ここに記録されます。'
                : '条件に一致する売上がありません。'}
            </p>
          ) : mode === 'detail' ? (
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th>ロットNo</th>
                  <th>倉庫</th>
                  <th>得意先</th>
                  <th style={{ textAlign: 'right' }}>数量</th>
                  <th style={{ textAlign: 'right' }}>売上単価</th>
                  <th style={{ textAlign: 'right' }}>売上金額</th>
                  <th style={{ textAlign: 'right' }}>原価</th>
                  <th style={{ textAlign: 'right' }}>粗利</th>
                  <th style={{ textAlign: 'right' }}>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.txnId}>
                    <td className="mono">{formatLedgerDateTime(r.date)}</td>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td className="mono">{r.lotNo}</td>
                    <td><WarehouseDot warehouse={warehouseById.get(r.warehouseId)} /></td>
                    <td>{r.customerName || <span className="stat-sub">得意先なし</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      {yen(r.unitPrice)}
                      {r.estimatedPrice && <span className="stat-sub" title="実売単価が記録されていないため、商品の販売定価で代用しています">（概算）</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{yen(r.amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {yen(r.cost)}
                      {r.estimatedCost && <span className="stat-sub" title="出庫時点の原価が記録されていないため、商品の現在原価で代用しています">（概算）</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className={r.profit >= 0 ? 'qty-in' : 'qty-out'}>{yen(r.profit)}</td>
                    <td style={{ textAlign: 'right' }}>{percent(r.profitRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{SUMMARY_MODES[mode]}</th>
                  <th style={{ textAlign: 'right' }}>件数</th>
                  <th style={{ textAlign: 'right' }}>数量</th>
                  <th style={{ textAlign: 'right' }}>売上金額</th>
                  <th style={{ textAlign: 'right' }}>原価</th>
                  <th style={{ textAlign: 'right' }}>粗利</th>
                  <th style={{ textAlign: 'right' }}>粗利率</th>
                  <th>構成比</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(s => (
                  <tr key={s.key}>
                    <td>
                      <strong>{s.label}</strong>
                      {s.sub && <span className="stat-sub"> {s.sub}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{s.count.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{s.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{yen(s.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{yen(s.cost)}</td>
                    <td style={{ textAlign: 'right' }} className={s.profit >= 0 ? 'qty-in' : 'qty-out'}>{yen(s.profit)}</td>
                    <td style={{ textAlign: 'right' }}>{percent(s.profitRate)}</td>
                    <td>
                      <div className="share-bar" title={`売上高の ${percent(s.share)}`}>
                        <div className="share-bar-fill" style={{ width: `${s.share * 100}%` }} />
                        <span className="share-bar-label">{percent(s.share)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {entryOpen && (
        <SalesEntryModal
          products={products}
          customers={customers}
          warehouses={warehouses}
          onSubmit={handleRecordSale}
          onClose={() => setEntryOpen(false)}
        />
      )}
      {notifyDialog}
    </div>
  );
}
