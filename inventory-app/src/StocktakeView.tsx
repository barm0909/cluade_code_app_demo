import { useMemo, useState } from 'react';
import {
  EMPTY_STOCKTAKE_FILTER,
  exportStocktakeCsv,
  stocktakeDiffs,
  stocktakeRows,
  stocktakeTotals,
} from './useInventory';
import type { Category, Product, StocktakeCounts, StocktakeFilter, Warehouse } from './useInventory';
import { ExpiryBadge, WarehouseDot } from './badges';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  products: Product[];
  categories: Category[];
  warehouses: Warehouse[];
  onApply: (counts: StocktakeCounts) => number;
}

function diffClass(diff: number) {
  if (diff > 0) return 'stocktake-over';
  if (diff < 0) return 'stocktake-short';
  return 'stocktake-matched';
}

export function StocktakeView({ products, categories, warehouses, onApply }: Props) {
  const [filter, setFilter] = useState<StocktakeFilter>(EMPTY_STOCKTAKE_FILTER);
  const [counts, setCounts] = useState<StocktakeCounts>({});
  const [diffOnly, setDiffOnly] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const set = <K extends keyof StocktakeFilter>(key: K, value: StocktakeFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const rows = useMemo(() => stocktakeRows(products, filter), [products, filter]);
  // 集計と確定は絞り込みに関係なく「入力済みのカウントすべて」を対象にする
  const allDiffs = useMemo(
    () => stocktakeDiffs(stocktakeRows(products, EMPTY_STOCKTAKE_FILTER), counts),
    [products, counts],
  );
  const totals = useMemo(() => stocktakeTotals(allDiffs), [allDiffs]);

  const visible = useMemo(() => {
    if (!diffOnly) return rows;
    return rows.filter(r => {
      const actual = counts[r.lotId];
      return actual !== undefined && actual !== r.bookQuantity;
    });
  }, [rows, counts, diffOnly]);

  const isFiltered = (Object.keys(EMPTY_STOCKTAKE_FILTER) as (keyof StocktakeFilter)[])
    .some(k => filter[k] !== EMPTY_STOCKTAKE_FILTER[k]);
  const totalLots = products.reduce((s, p) => s + p.lots.length, 0);
  const diffCount = totals.over + totals.short;

  const setCount = (lotId: string, value: string) => {
    setCounts(prev => {
      const next = { ...prev };
      if (value === '') delete next[lotId];
      else next[lotId] = Math.max(0, Math.floor(Number(value) || 0));
      return next;
    });
  };

  // 未入力の行だけ帳簿在庫で埋める (入力済みのカウントは上書きしない)
  const fillWithBook = () => {
    setCounts(prev => {
      const next = { ...prev };
      for (const r of rows) if (next[r.lotId] === undefined) next[r.lotId] = r.bookQuantity;
      return next;
    });
  };

  const handleApply = async () => {
    const ok = await confirm({
      title: '棚卸の確定',
      message: `差異のある${diffCount}件のロットを実数に更新し、入出庫帳票に「棚卸」として記録します。\n（棚卸増 ${totals.over}件 / 棚卸減 ${totals.short}件、差異金額 ${totals.diffValue >= 0 ? '+' : '-'}¥${Math.abs(totals.diffValue).toLocaleString()}）\n\nよろしいですか？`,
      confirmLabel: '確定する',
      tone: 'danger',
    });
    if (!ok) return;
    const applied = onApply(counts);
    setCounts({});
    setDiffOnly(false);
    await notify(`${applied}件のロットの在庫数を更新しました。`, '棚卸の確定');
  };

  if (totalLots === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">ロットがありません。在庫一覧からロットを追加すると棚卸できます。</p>
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
        <select aria-label="カテゴリ" value={filter.categoryId} onChange={e => set('categoryId', e.target.value)}>
          <option value="">全カテゴリ</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="倉庫" value={filter.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
          <option value="">全倉庫</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_STOCKTAKE_FILTER)}>条件クリア</button>
        )}
        <label className="stocktake-toggle">
          <input type="checkbox" checked={diffOnly} onChange={e => setDiffOnly(e.target.checked)} />
          差異のみ表示
        </label>
      </div>

      <div className="ledger-summary stocktake-summary">
        <span>カウント {totals.counted} / {isFiltered ? `${rows.length}（全${totalLots}）` : totalLots} ロット</span>
        <span className="qty-matched">一致 {totals.matched}</span>
        <span className="qty-in">棚卸増 {totals.over}</span>
        <span className="qty-out">棚卸減 {totals.short}</span>
        <span className={totals.diffValue < 0 ? 'qty-out' : 'qty-in'}>
          差異金額 {totals.diffValue >= 0 ? '+' : '-'}¥{Math.abs(totals.diffValue).toLocaleString()}
        </span>
        <div className="stocktake-actions">
          <button className="btn-ghost-light" onClick={fillWithBook} disabled={rows.length === 0}>
            未入力を帳簿在庫で埋める
          </button>
          <button className="btn-ghost-light" onClick={() => setCounts({})} disabled={totals.counted === 0}>
            入力クリア
          </button>
          <button className="btn-add-lot" onClick={() => exportStocktakeCsv(rows, counts, warehouses)} disabled={rows.length === 0}>
            CSVエクスポート
          </button>
          <button className="btn-danger" onClick={handleApply} disabled={diffCount === 0}>
            棚卸を確定（{diffCount}件）
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        {visible.length === 0 ? (
          <p className="empty">{diffOnly ? '差異のあるロットがありません。' : '条件に一致するロットがありません。'}</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>商品名</th>
              <th>SKU</th>
              <th>ロットNo</th>
              <th>賞味期限</th>
              <th>倉庫</th>
              <th style={{ textAlign: 'right' }}>帳簿在庫</th>
              <th style={{ textAlign: 'right' }}>実数</th>
              <th style={{ textAlign: 'right' }}>差異</th>
              <th style={{ textAlign: 'right' }}>差異金額</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const actual = counts[r.lotId];
              const counted = actual !== undefined;
              const diff = counted ? actual - r.bookQuantity : 0;
              return (
                <tr key={r.lotId} className={counted ? diffClass(diff) : ''}>
                  <td><strong>{r.productName}</strong></td>
                  <td className="mono">{r.productSku}</td>
                  <td className="mono">{r.lotNo}</td>
                  <td><ExpiryBadge expiryDate={r.expiryDate} /></td>
                  <td><WarehouseDot warehouse={warehouses.find(w => w.id === r.warehouseId)} /></td>
                  <td style={{ textAlign: 'right' }}>{r.bookQuantity}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      className="stocktake-input"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="—"
                      aria-label={`${r.productName} ロット${r.lotNo} の実数`}
                      value={counted ? actual : ''}
                      onChange={e => setCount(r.lotId, e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {counted
                      ? <span className={diff > 0 ? 'qty-in' : diff < 0 ? 'qty-out' : 'qty-matched'}>{diff > 0 ? `+${diff}` : diff}</span>
                      : <span className="expiry-none">—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {counted && diff !== 0
                      ? <span className={diff > 0 ? 'qty-in' : 'qty-out'}>{diff > 0 ? '+' : '-'}¥{Math.abs(diff * r.costPrice).toLocaleString()}</span>
                      : <span className="expiry-none">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
      {confirmDialog}
      {notifyDialog}
    </>
  );
}
