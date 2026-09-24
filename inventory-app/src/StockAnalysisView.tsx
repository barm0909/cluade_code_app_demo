import { useMemo, useState } from 'react';
import {
  ANALYSIS_PERIODS,
  DEFAULT_ANALYSIS_PERIOD,
  DEFAULT_SAFETY_STOCK_DAYS,
  DEFAULT_STAGNANT_DAYS,
  EMPTY_STOCK_ANALYSIS_FILTER,
  SAFETY_STOCK_DAYS_OPTIONS,
  STAGNANT_THRESHOLDS,
  csvExportHint,
  csvExportLabel,
  exportStockAnalysisCsv,
  filterStockAnalysis,
  localDateKey,
  minQuantitySuggestions,
  planMinQuantities,
  stagnantRows,
  stockAnalysisRows,
  stockAnalysisTotals,
} from './useInventory';
import type {
  AbcRank,
  Category,
  InboundPlan,
  MinQuantityUpdate,
  Product,
  StockAnalysisFilter,
  StockTransaction,
  Supplier,
} from './useInventory';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  products: Product[];
  categories: Category[];
  ledger: StockTransaction[];
  inboundPlans: InboundPlan[];
  suppliers: Supplier[];
  /** 発注点の一括更新。実際に変わった商品数を返す */
  onApplyMinQuantities: (updates: MinQuantityUpdate[]) => number;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

const RANKS: AbcRank[] = ['A', 'B', 'C'];

/** ABCランクのバッジ。A=売れ筋、C=動きが鈍い、という色の意味を倉庫ドットなどと揃える */
function RankBadge({ rank }: { rank: AbcRank }) {
  return <span className={`abc-badge abc-${rank.toLowerCase()}`}>{rank}</span>;
}

/** 在庫日数。出庫実績がないと「何日で捌けるか」が計算できないので「—」にする */
function daysOfStockLabel(days: number | null): string {
  if (days == null) return '—';
  if (days >= 999) return '999日以上';
  return `${Math.round(days)}日`;
}

/**
 * 在庫分析タブ。商品ごとの出庫実績 (帳票) と現在庫から、ABCランク・在庫回転率・
 * 滞留日数を出し、出庫ペースに合わせた発注点の見直しまでを1画面にまとめる。
 *
 * 集計はすべて useInventory.ts の純粋関数 (stockAnalysisRows / stagnantRows /
 * stockAnalysisTotals / minQuantitySuggestions / planMinQuantities) に任せ、
 * この画面は表示と選択状態だけを持つ (DashboardView と同じ構成)。
 */
export function StockAnalysisView({ products, categories, ledger, inboundPlans, suppliers, onApplyMinQuantities }: Props) {
  const [days, setDays] = useState<number>(DEFAULT_ANALYSIS_PERIOD);
  const [stagnantDays, setStagnantDays] = useState<number>(DEFAULT_STAGNANT_DAYS);
  const [safetyDays, setSafetyDays] = useState<number>(DEFAULT_SAFETY_STOCK_DAYS);
  const [filter, setFilter] = useState<StockAnalysisFilter>(EMPTY_STOCK_ANALYSIS_FILTER);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const set = <K extends keyof StockAnalysisFilter>(key: K, value: StockAnalysisFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const allRows = useMemo(() => stockAnalysisRows(products, ledger, { days }), [products, ledger, days]);
  const filtered = useMemo(() => filterStockAnalysis(allRows, filter), [allRows, filter]);
  // 資材は売らないので ABC の表からは外し、下に別の表で出す (rank が null)
  const rankedRows = useMemo(() => filtered.filter(r => r.rank), [filtered]);
  const materialRows = useMemo(() => filtered.filter(r => !r.rank), [filtered]);
  const totals = useMemo(() => stockAnalysisTotals(allRows, { days, stagnantDays }), [allRows, days, stagnantDays]);
  const stagnant = useMemo(() => stagnantRows(allRows, stagnantDays), [allRows, stagnantDays]);
  const suggestions = useMemo(
    () => minQuantitySuggestions(allRows, products, inboundPlans, suppliers, { safetyDays }),
    [allRows, products, inboundPlans, suppliers, safetyDays],
  );
  const plan = useMemo(() => planMinQuantities(suggestions, selectedProductIds), [suggestions, selectedProductIds]);

  const categoryNameById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const isFiltered = useMemo(
    () => (Object.keys(EMPTY_STOCK_ANALYSIS_FILTER) as (keyof StockAnalysisFilter)[])
      .some(k => filter[k] !== EMPTY_STOCK_ANALYSIS_FILTER[k]),
    [filter],
  );
  const allSuggestionsSelected = suggestions.length > 0 && plan.targets.length === suggestions.length;

  const toggleProduct = (productId: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleApply = async () => {
    const { targets, updates, raised, lowered } = plan;
    const ok = await confirm({
      title: '発注点の一括更新',
      message: `${targets.length}商品の発注点（最低在庫数）を提案値に更新します。`
        + `\n（引き上げ ${raised}件 / 引き下げ ${lowered}件）`
        + '\n\n発注点はダッシュボードの要発注・発注提案の基準になります。'
        + '\n在庫は動かないので、入出庫帳票には記録されません。',
      confirmLabel: '更新する',
    });
    if (!ok) return;
    const applied = onApplyMinQuantities(updates);
    setSelectedProductIds(new Set());
    await notify(`${applied}商品の発注点を更新しました。\n商品マスタでも確認・修正できます。`, '発注点の更新');
  };

  if (products.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">商品が登録されていません。在庫一覧から商品を追加すると分析が表示されます。</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="stats-row dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">在庫金額（原価）</div>
          <div className="stat-value">{yen(totals.stockValue)}</div>
          <div className="stat-sub">{totals.productCount}商品</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">期間の出庫金額</div>
          <div className="stat-value">{yen(totals.outboundValue)}</div>
          <div className="stat-sub">直近{days}日 / {totals.outboundQuantity.toLocaleString()}個</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在庫日数</div>
          <div className="stat-value">{daysOfStockLabel(totals.daysOfStock)}</div>
          <div className="stat-sub">今の出庫ペースで捌ける日数</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Aランク商品</div>
          <div className="stat-value">{totals.rankCounts.A}</div>
          <div className="stat-sub">
            B {totals.rankCounts.B} / C {totals.rankCounts.C}
            {totals.materialCount > 0 && ` / 資材 ${totals.materialCount}（対象外）`}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">滞留在庫</div>
          <div className={totals.stagnantValue > 0 ? 'stat-value alert' : 'stat-value'}>{yen(totals.stagnantValue)}</div>
          <div className="stat-sub">{totals.stagnantCount}商品 / {stagnantDays}日以上動きなし</div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">ABC分析（出庫金額の構成比）</h3>
          <label className="dashboard-days">
            集計期間
            <select value={days} onChange={e => setDays(Number(e.target.value))}>
              {ANALYSIS_PERIODS.map(d => <option key={d} value={d}>直近{d}日</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">A = 上位70% / B = 90%まで / C = 残り（販売品だけでランク付け）</span>
        </div>

        <div className="controls ledger-controls">
          <input
            className="search-input"
            placeholder="商品名・SKUで検索..."
            value={filter.keyword}
            onChange={e => set('keyword', e.target.value)}
          />
          <select aria-label="カテゴリ" value={filter.categoryId} onChange={e => set('categoryId', e.target.value)}>
            <option value="">全カテゴリ</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="ABCランク" value={filter.rank} onChange={e => set('rank', e.target.value as AbcRank | '')}>
            <option value="">全ランク</option>
            {RANKS.map(r => <option key={r} value={r}>{r}ランク</option>)}
          </select>
          {isFiltered && (
            <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_STOCK_ANALYSIS_FILTER)}>条件クリア</button>
          )}
        </div>

        <div className="ledger-summary">
          <span>{filtered.length}件{isFiltered ? ` / 全${allRows.length}件` : ''}</span>
          <button
            className="btn-add-lot"
            disabled={filtered.length === 0}
            onClick={() => exportStockAnalysisCsv(filtered, categories)}
            title={csvExportHint('analysis')}
          >
            {csvExportLabel('analysis')}
          </button>
        </div>

        <div className="table-wrapper">
          {rankedRows.length === 0 ? (
            <p className="empty">条件に一致する販売品がありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ランク</th>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th>カテゴリ</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>在庫金額</th>
                  <th style={{ textAlign: 'right' }}>期間出庫数</th>
                  <th style={{ textAlign: 'right' }}>出庫金額</th>
                  <th>構成比</th>
                  <th style={{ textAlign: 'right' }}>回転率</th>
                  <th style={{ textAlign: 'right' }}>在庫日数</th>
                  <th>最終出庫</th>
                </tr>
              </thead>
              <tbody>
                {rankedRows.map(r => (
                  <tr key={r.productId}>
                    <td>{r.rank && <RankBadge rank={r.rank} />}</td>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td>{categoryNameById.get(r.categoryId) ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{yen(r.stockValue)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.outboundQuantity.toLocaleString()}
                      {r.disposalQuantity > 0 && (
                        <span className="stat-sub"> （廃棄{r.disposalQuantity.toLocaleString()}）</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{yen(r.outboundValue)}</td>
                    <td>
                      <div className="share-bar" title={`累計 ${(r.cumulativeShare * 100).toFixed(1)}%`}>
                        <div className="share-bar-fill" style={{ width: `${r.share * 100}%` }} />
                        <span className="share-bar-label">{(r.share * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.turnoverRate.toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{daysOfStockLabel(r.daysOfStock)}</td>
                    <td className="mono">
                      {r.lastOutboundAt
                        ? localDateKey(r.lastOutboundAt)
                        : <span className="stat-sub">実績なし</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {materialRows.length > 0 && (<>
          <h4 className="analysis-subtitle">資材（ABCランクの対象外）</h4>
          <div className="table-wrapper">
            <table aria-label="資材">
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th>カテゴリ</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>在庫金額</th>
                  <th style={{ textAlign: 'right' }}>期間出庫数</th>
                  <th style={{ textAlign: 'right' }}>出庫金額</th>
                  <th style={{ textAlign: 'right' }}>回転率</th>
                  <th style={{ textAlign: 'right' }}>在庫日数</th>
                  <th>最終出庫</th>
                </tr>
              </thead>
              <tbody>
                {materialRows.map(r => (
                  <tr key={r.productId}>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td>{categoryNameById.get(r.categoryId) ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{yen(r.stockValue)}</td>
                    <td style={{ textAlign: 'right' }}>{r.outboundQuantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{yen(r.outboundValue)}</td>
                    <td style={{ textAlign: 'right' }}>{r.turnoverRate.toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{daysOfStockLabel(r.daysOfStock)}</td>
                    <td className="mono">
                      {r.lastOutboundAt
                        ? localDateKey(r.lastOutboundAt)
                        : <span className="stat-sub">実績なし</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">滞留在庫（在庫はあるのに動いていない商品）</h3>
          <label className="dashboard-days">
            判定
            <select value={stagnantDays} onChange={e => setStagnantDays(Number(e.target.value))}>
              {STAGNANT_THRESHOLDS.map(d => <option key={d} value={d}>{d}日以上</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">滞留金額 {yen(totals.stagnantValue)}</span>
        </div>
        <div className="table-wrapper">
          {stagnant.length === 0 ? (
            <p className="empty">{stagnantDays}日以上動いていない在庫はありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>在庫金額</th>
                  <th>最終出庫</th>
                  <th style={{ textAlign: 'right' }}>滞留日数</th>
                </tr>
              </thead>
              <tbody>
                {stagnant.map(r => (
                  <tr key={r.productId}>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{yen(r.stockValue)}</td>
                    <td className="mono">
                      {r.lastOutboundAt
                        ? localDateKey(r.lastOutboundAt)
                        : <span className="stat-sub">実績なし</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.stagnantDays == null
                        ? <span className="expiry-badge expired">出庫なし</span>
                        : <span className="expiry-badge expired">{r.stagnantDays}日</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">発注点の見直し提案</h3>
          <label className="dashboard-days">
            安全在庫
            <select value={safetyDays} onChange={e => setSafetyDays(Number(e.target.value))}>
              {SAFETY_STOCK_DAYS_OPTIONS.map(d => <option key={d} value={d}>{d}日分</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">提案値 = 1日あたり出庫数 ×（リードタイム + 安全在庫日数）</span>
          {suggestions.length > 0 && (
            <div className="dashboard-actions">
              <button
                className="btn-ghost-light"
                onClick={() => setSelectedProductIds(
                  allSuggestionsSelected ? new Set() : new Set(suggestions.map(s => s.productId)),
                )}
              >
                {allSuggestionsSelected ? '選択を解除' : `すべて選択（${suggestions.length}件）`}
              </button>
              <button
                className="btn-primary"
                onClick={handleApply}
                disabled={plan.targets.length === 0}
                title="選択した商品の発注点（最低在庫数）を提案値に更新します"
              >
                選択した{plan.targets.length}件を反映
              </button>
            </div>
          )}
        </div>
        <div className="table-wrapper">
          {suggestions.length === 0 ? (
            <p className="empty">
              直近{days}日の出庫実績から見直しが必要な商品はありません。
              （期間内に出庫のなかった商品は、欠品を避けるため提案の対象外です）
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      aria-label="すべて選択"
                      checked={allSuggestionsSelected}
                      onChange={() => setSelectedProductIds(
                        allSuggestionsSelected ? new Set() : new Set(suggestions.map(s => s.productId)),
                      )}
                    />
                  </th>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>1日あたり出庫</th>
                  <th style={{ textAlign: 'right' }}>リードタイム</th>
                  <th style={{ textAlign: 'right' }}>現在の発注点</th>
                  <th style={{ textAlign: 'right' }}>提案値</th>
                  <th style={{ textAlign: 'right' }}>差</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map(s => (
                  <tr key={s.productId}>
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        aria-label={`${s.productName}を選択`}
                        checked={selectedProductIds.has(s.productId)}
                        onChange={() => toggleProduct(s.productId)}
                      />
                    </td>
                    <td><strong>{s.productName}</strong></td>
                    <td className="mono">{s.productSku}</td>
                    <td style={{ textAlign: 'right' }}>{s.dailyOutbound.toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {s.leadTimeDays}日
                      {s.supplierName && <span className="stat-sub"> （{s.supplierName}）</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{s.currentMinQuantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.suggestedMinQuantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={s.diff > 0 ? 'qty-in' : 'qty-out'}>
                        {s.diff > 0 ? '▲' : '▼'}{Math.abs(s.diff).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {confirmDialog}
      {notifyDialog}
    </div>
  );
}
