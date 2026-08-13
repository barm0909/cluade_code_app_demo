import { useMemo, useState } from 'react';
import {
  DASHBOARD_EXPIRY_OPTIONS,
  EXPIRY_SOON_DAYS,
  categorySummaries,
  csvExportHint,
  csvExportLabel,
  dashboardTotals,
  expiringLotRows,
  exportLowStockCsv,
  lowStockRows,
  warehouseSummaries,
} from './useInventory';
import type { Category, GroupSummary, Product, Warehouse } from './useInventory';
import { WarehouseDot } from './badges';

interface Props {
  products: Product[];
  categories: Category[];
  warehouses: Warehouse[];
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

// badges.tsx の ExpiryBadge は 8日以降を日付表示に切り替えるが、
// ここは表示範囲を 14日/30日にも広げられるので常に残日数で見せる
function DaysLeftBadge({ days }: { days: number }) {
  if (days < 0) return <span className="expiry-badge expired">{-days}日経過</span>;
  if (days === 0) return <span className="expiry-badge expiring-today">今日まで</span>;
  const cls = days <= EXPIRY_SOON_DAYS ? 'expiring-soon' : 'ok';
  return <span className={`expiry-badge ${cls}`}>{days}日後</span>;
}

function SummaryTable({ title, rows, unit }: { title: string; rows: GroupSummary[]; unit: string }) {
  return (
    <section className="dashboard-section dashboard-half">
      <h3 className="dashboard-section-title">{title}</h3>
      <div className="table-wrapper">
        {rows.length === 0 ? (
          <p className="empty">{unit}が登録されていません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{unit}</th>
                <th style={{ textAlign: 'right' }}>商品数</th>
                <th style={{ textAlign: 'right' }}>在庫数</th>
                <th style={{ textAlign: 'right' }}>在庫金額（原価）</th>
                <th>構成比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td style={{ textAlign: 'right' }}>{r.productCount}</td>
                  <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{yen(r.costValue)}</td>
                  <td>
                    <div className="share-bar" title={`${(r.share * 100).toFixed(1)}%`}>
                      <div className="share-bar-fill" style={{ width: `${r.share * 100}%` }} />
                      <span className="share-bar-label">{(r.share * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function DashboardView({ products, categories, warehouses }: Props) {
  const [withinDays, setWithinDays] = useState(EXPIRY_SOON_DAYS);

  const totals = useMemo(() => dashboardTotals(products, withinDays), [products, withinDays]);
  const reorder = useMemo(() => lowStockRows(products), [products]);
  const expiring = useMemo(() => expiringLotRows(products, withinDays), [products, withinDays]);
  const byWarehouse = useMemo(() => warehouseSummaries(products, warehouses), [products, warehouses]);
  const byCategory = useMemo(() => categorySummaries(products, categories), [products, categories]);

  const categoryNameById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const restockCost = reorder.reduce((s, r) => s + r.restockCost, 0);
  const expiringValue = expiring.reduce((s, r) => s + r.costValue, 0);

  if (products.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">商品が登録されていません。在庫一覧から商品を追加すると集計が表示されます。</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="stats-row dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">在庫金額（原価）</div>
          <div className="stat-value">{yen(totals.costValue)}</div>
          <div className="stat-sub">売価 {yen(totals.retailValue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在庫数</div>
          <div className="stat-value">{totals.quantity.toLocaleString()}</div>
          <div className="stat-sub">{totals.productCount}商品 / {totals.lotCount}ロット</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">要発注</div>
          <div className={totals.lowStock > 0 ? 'stat-value alert' : 'stat-value'}>{totals.lowStock}</div>
          <div className="stat-sub">うち欠品 {totals.outOfStock}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">期限切れロット</div>
          <div className="stat-value expired-text">{totals.expiredLots}</div>
          <div className="stat-sub">在庫の残っているロット</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">期限間近ロット</div>
          <div className="stat-value warning-text">{totals.expiringLots}</div>
          <div className="stat-sub">{withinDays}日以内</div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">要発注リスト（在庫数 ≦ 発注点）</h3>
          <span className="dashboard-section-note">発注見込金額 {yen(restockCost)}</span>
          <button
            className="btn-add-lot"
            onClick={() => exportLowStockCsv(reorder, categories)}
            disabled={reorder.length === 0}
            title={csvExportHint('reorder')}
          >
            {csvExportLabel('reorder')}
          </button>
        </div>
        <div className="table-wrapper">
          {reorder.length === 0 ? (
            <p className="empty">発注点を下回っている商品はありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th>カテゴリ</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>発注点</th>
                  <th style={{ textAlign: 'right' }}>不足数</th>
                  <th style={{ textAlign: 'right' }}>発注見込金額</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map(r => (
                  <tr key={r.productId} className={r.quantity === 0 ? 'row-expired' : 'row-alert'}>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td>{categoryNameById.get(r.categoryId) ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.quantity === 0
                        ? <span className="badge badge-out">欠品</span>
                        : <span className="qty-low">{r.quantity}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.minQuantity}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {r.shortage > 0 ? <span className="qty-out">{r.shortage}</span> : <span className="expiry-none">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.restockCost > 0 ? yen(r.restockCost) : <span className="expiry-none">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">期限アラート</h3>
          <label className="dashboard-days">
            表示範囲
            <select value={withinDays} onChange={e => setWithinDays(Number(e.target.value))}>
              {DASHBOARD_EXPIRY_OPTIONS.map(d => <option key={d} value={d}>{d}日以内</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">対象在庫金額 {yen(expiringValue)}</span>
        </div>
        <div className="table-wrapper">
          {expiring.length === 0 ? (
            <p className="empty">{withinDays}日以内に期限を迎えるロットはありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th>ロットNo</th>
                  <th>賞味期限</th>
                  <th>残日数</th>
                  <th>倉庫</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>在庫金額（原価）</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map(r => (
                  <tr key={r.lotId} className={r.days < 0 ? 'row-expired' : 'row-expiring'}>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td className="mono">{r.lotNo}</td>
                    <td className="mono">{r.expiryDate}</td>
                    <td><DaysLeftBadge days={r.days} /></td>
                    <td><WarehouseDot warehouse={warehouses.find(w => w.id === r.warehouseId)} /></td>
                    <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{yen(r.costValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="dashboard-columns">
        <SummaryTable title="倉庫別在庫" rows={byWarehouse} unit="倉庫" />
        <SummaryTable title="カテゴリ別在庫" rows={byCategory} unit="カテゴリ" />
      </div>
    </div>
  );
}
