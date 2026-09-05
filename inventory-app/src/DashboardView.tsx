import { useMemo, useState } from 'react';
import {
  DASHBOARD_EXPIRY_OPTIONS,
  DEFAULT_REORDER_RATIO,
  DISPOSAL_PERIODS,
  EXPIRY_SOON_DAYS,
  REORDER_TARGET_RATIOS,
  categorySummaries,
  csvExportHint,
  csvExportLabel,
  dashboardTotals,
  disposalPeriodStart,
  disposalRows,
  disposalTotals,
  disposalTransactions,
  expectedDateFromLeadTime,
  expiringLotRows,
  exportDisposalCsv,
  exportReorderCsv,
  planDisposal,
  planReorder,
  reorderSuggestions,
  selectableSuppliers,
  warehouseSummaries,
} from './useInventory';
import type {
  Category,
  DisposalPeriod,
  DisposalPlan,
  GroupSummary,
  InboundPlan,
  InboundPlanInput,
  Product,
  ReorderOverride,
  StockTransaction,
  Supplier,
  Warehouse,
} from './useInventory';
import { NumberInput } from './NumberInput';
import { WarehouseDot } from './badges';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  products: Product[];
  categories: Category[];
  warehouses: Warehouse[];
  ledger: StockTransaction[];
  suppliers: Supplier[];
  inboundPlans: InboundPlan[];
  onDispose: (lotIds: string[]) => DisposalPlan;
  /** 発注登録。入荷予定を一括で作り、作成できた件数を返す */
  onCreateOrders: (inputs: InboundPlanInput[]) => number;
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

export function DashboardView({ products, categories, warehouses, ledger, suppliers, inboundPlans, onDispose, onCreateOrders }: Props) {
  const [withinDays, setWithinDays] = useState(EXPIRY_SOON_DAYS);
  // 廃棄するロットの選択。期限アラートに出ている行だけを対象にする
  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(new Set());
  const [disposalPeriod, setDisposalPeriod] = useState<DisposalPeriod>('今月');
  // 発注提案: 目標在庫の倍率と、発注する商品の選択・行ごとの上書き (数量・仕入先)
  const [targetRatio, setTargetRatio] = useState<number>(DEFAULT_REORDER_RATIO);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [orderOverrides, setOrderOverrides] = useState<Record<string, ReorderOverride>>({});
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const totals = useMemo(() => dashboardTotals(products, withinDays), [products, withinDays]);
  const reorder = useMemo(
    () => reorderSuggestions(products, inboundPlans, suppliers, warehouses, { targetRatio }),
    [products, inboundPlans, suppliers, warehouses, targetRatio],
  );
  const expiring = useMemo(() => expiringLotRows(products, withinDays), [products, withinDays]);
  const byWarehouse = useMemo(() => warehouseSummaries(products, warehouses), [products, warehouses]);
  const byCategory = useMemo(() => categorySummaries(products, categories), [products, categories]);

  // 廃棄ロス: サマリカードは常に今月、一覧は選んだ期間で集計する
  const monthlyDisposal = useMemo(
    () => disposalTotals(disposalRows(disposalTransactions(ledger, disposalPeriodStart('今月')), products)),
    [ledger, products],
  );
  const disposals = useMemo(
    () => disposalRows(disposalTransactions(ledger, disposalPeriodStart(disposalPeriod)), products),
    [ledger, products, disposalPeriod],
  );
  const disposalSum = useMemo(() => disposalTotals(disposals), [disposals]);

  const categoryNameById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);

  // 発注登録の内容。確認ダイアログのプレビューと実行がこの1つの結果を共有する
  const reorderPlan = useMemo(
    () => planReorder(reorder, selectedProductIds, suppliers, orderOverrides),
    [reorder, selectedProductIds, suppliers, orderOverrides],
  );
  // 発注できる行 (推奨・上書き後の数量が1以上) だけを一括選択の対象にする
  const orderableRows = useMemo(
    () => reorder.filter(r => (orderOverrides[r.productId]?.quantity ?? r.suggestedQuantity) > 0),
    [reorder, orderOverrides],
  );
  const orderCostTotal = reorder.reduce((s, r) => s + r.orderCost, 0);
  const expiringValue = expiring.reduce((s, r) => s + r.costValue, 0);

  // 表示中の行だけを選択済みとして扱う (表示範囲を狭めた行・廃棄済みの行が残らないように)
  const selected = useMemo(
    () => expiring.filter(r => selectedLotIds.has(r.lotId)),
    [expiring, selectedLotIds],
  );
  const disposalPlan = useMemo(
    () => planDisposal(products, selected.map(r => r.lotId)),
    [products, selected],
  );
  const expiredRows = expiring.filter(r => r.days < 0);
  const allSelected = expiring.length > 0 && selected.length === expiring.length;

  const toggleLot = (lotId: string) => {
    setSelectedLotIds(prev => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  };

  const selectLots = (lotIds: string[]) => setSelectedLotIds(new Set(lotIds));

  const toggleProduct = (productId: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const setOverride = (productId: string, patch: ReorderOverride) => {
    setOrderOverrides(prev => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
    // 数量や仕入先をいじった行は「発注する気がある行」なので、そのまま選択状態にする
    setSelectedProductIds(prev => prev.has(productId) ? prev : new Set(prev).add(productId));
  };

  const handleCreateOrders = async () => {
    const { targets, quantity, orderCost, noSupplier } = reorderPlan;
    const ok = await confirm({
      title: '選択した商品の発注登録',
      message: `${targets.length}商品（合計${quantity.toLocaleString()}個・${yen(orderCost)}）の入荷予定を作成します。`
        + (noSupplier > 0 ? `\n\n※ ${noSupplier}件は仕入先が未設定です。入荷予定タブであとから設定できます。` : '')
        + '\n\n作成される入荷予定はまだ在庫ではありません。'
        + '\n実際に届いたら入荷予定タブで「入荷」を行ってください。',
      confirmLabel: '発注登録する',
    });
    if (!ok) return;
    const created = onCreateOrders(reorderPlan.inputs);
    setSelectedProductIds(new Set());
    setOrderOverrides({});
    await notify(
      `${created}件の入荷予定を作成しました。\n合計${quantity.toLocaleString()}個 / ${yen(orderCost)}\n\n入荷予定タブで内容を確認・修正できます。`,
      '発注登録',
    );
  };

  const handleDispose = async () => {
    const { targets, quantity, costValue, expiredCount, notExpiredCount } = disposalPlan;
    const ok = await confirm({
      title: '選択したロットの廃棄',
      message: `${targets.length}ロット（${quantity.toLocaleString()}個・${yen(costValue)}）を廃棄します。`
        + `\n（期限切れ ${expiredCount}件 / 期限内 ${notExpiredCount}件）`
        + (notExpiredCount > 0 ? '\n\n※ まだ期限の来ていないロットが含まれています。' : '')
        + '\n\n廃棄したロットは在庫一覧から取り除かれ、入出庫帳票に「廃棄」として記録されます。'
        + '\nこの操作は取り消せません。よろしいですか？',
      confirmLabel: '廃棄する',
      tone: 'danger',
    });
    if (!ok) return;
    const done = onDispose(targets.map(t => t.lotId));
    setSelectedLotIds(new Set());
    await notify(
      `${done.targets.length}ロット（${done.quantity.toLocaleString()}個）を廃棄しました。\n廃棄ロス金額: ${yen(done.costValue)}`,
      '廃棄',
    );
  };

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
        <div className="stat-card">
          <div className="stat-label">今月の廃棄ロス</div>
          <div className={monthlyDisposal.costValue > 0 ? 'stat-value expired-text' : 'stat-value'}>
            {yen(monthlyDisposal.costValue)}
          </div>
          <div className="stat-sub">{monthlyDisposal.count}件 / {monthlyDisposal.quantity.toLocaleString()}個</div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">発注提案（在庫数 ≦ 発注点）</h3>
          <label className="dashboard-days">
            目標在庫
            <select value={targetRatio} onChange={e => setTargetRatio(Number(e.target.value))}>
              {REORDER_TARGET_RATIOS.map(r => <option key={r} value={r}>発注点の{r}倍</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">発注見込金額 {yen(orderCostTotal)}</span>
          {reorder.length > 0 && (
            <div className="dashboard-actions">
              <button
                className="btn-ghost-light"
                onClick={() => setSelectedProductIds(new Set(orderableRows.map(r => r.productId)))}
                disabled={orderableRows.length === 0}
                title="推奨発注数が1以上の商品をまとめて選択します"
              >
                発注が要る商品を選択（{orderableRows.length}件）
              </button>
              <button
                className="btn-primary"
                onClick={handleCreateOrders}
                disabled={reorderPlan.targets.length === 0}
                title="選択した商品の入荷予定をまとめて作成します"
              >
                選択した商品を発注登録（{reorderPlan.targets.length}件）
              </button>
            </div>
          )}
          <button
            className="btn-add-lot"
            onClick={() => exportReorderCsv(reorder, categories)}
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
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      checked={orderableRows.length > 0 && reorderPlan.targets.length === orderableRows.length}
                      onChange={e => setSelectedProductIds(e.target.checked ? new Set(orderableRows.map(r => r.productId)) : new Set())}
                      disabled={orderableRows.length === 0}
                      aria-label="発注する商品をすべて選択"
                    />
                  </th>
                  <th>商品名</th>
                  <th>カテゴリ</th>
                  <th style={{ textAlign: 'right' }}>在庫数</th>
                  <th style={{ textAlign: 'right' }}>発注点</th>
                  <th style={{ textAlign: 'right' }}>入荷予定残</th>
                  <th style={{ textAlign: 'right' }}>不足数</th>
                  <th style={{ textAlign: 'right' }}>発注数</th>
                  <th>仕入先</th>
                  <th>入荷予定日</th>
                  <th style={{ textAlign: 'right' }}>発注見込金額</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map(r => {
                  const override = orderOverrides[r.productId];
                  const quantity = override?.quantity ?? r.suggestedQuantity;
                  const supplierId = override?.supplierId ?? r.supplierId;
                  const supplier = suppliers.find(x => x.id === supplierId);
                  return (
                    <tr key={r.productId} className={r.quantity === 0 ? 'row-expired' : 'row-alert'}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.has(r.productId)}
                          onChange={() => toggleProduct(r.productId)}
                          disabled={quantity <= 0}
                          aria-label={`${r.productName}を発注する`}
                        />
                      </td>
                      <td>
                        <strong>{r.productName}</strong>
                        <div className="mono cell-sub">{r.productSku}</div>
                      </td>
                      <td>{categoryNameById.get(r.categoryId) ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.quantity === 0
                          ? <span className="badge badge-out">欠品</span>
                          : <span className="qty-low">{r.quantity}</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.minQuantity}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.incoming > 0
                          ? <span className="badge badge-ordered" title="発注済みでまだ届いていない数量">発注済 {r.incoming}</span>
                          : <span className="expiry-none">—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {r.projectedShortage > 0
                          ? <span className="qty-out">{r.projectedShortage}</span>
                          : <span className="expiry-none">—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <NumberInput
                          className="cell-input-qty"
                          min={0}
                          value={quantity}
                          onValueChange={v => setOverride(r.productId, { quantity: v })}
                          aria-label={`${r.productName}の発注数`}
                        />
                      </td>
                      <td>
                        <select
                          className="cell-input-select"
                          value={supplierId}
                          onChange={e => setOverride(r.productId, { supplierId: e.target.value })}
                          aria-label={`${r.productName}の仕入先`}
                        >
                          <option value="">仕入先未設定</option>
                          {selectableSuppliers(suppliers, supplierId).map(sp => (
                            <option key={sp.id} value={sp.id}>{sp.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="mono">
                        {supplierId === r.supplierId
                          ? r.expectedDate
                          : <span title="選んだ仕入先の標準リードタイムで引き直されます">{expectedDateFromLeadTime(supplier)}</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {quantity > 0 ? yen(quantity * r.unitPrice) : <span className="expiry-none">—</span>}
                      </td>
                    </tr>
                  );
                })}
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
          {expiring.length > 0 && (
            <div className="dashboard-actions">
              <button
                className="btn-ghost-light"
                onClick={() => selectLots(expiredRows.map(r => r.lotId))}
                disabled={expiredRows.length === 0}
                title="期限切れのロットだけを選択します"
              >
                期限切れを選択（{expiredRows.length}件）
              </button>
              <button
                className="btn-danger"
                onClick={handleDispose}
                disabled={disposalPlan.targets.length === 0}
                title="選択したロットを全量廃棄し、入出庫帳票に記録します"
              >
                選択したロットを廃棄（{disposalPlan.targets.length}件）
              </button>
            </div>
          )}
        </div>
        <div className="table-wrapper">
          {expiring.length === 0 ? (
            <p className="empty">{withinDays}日以内に期限を迎えるロットはありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      aria-label="すべてのロットを選択"
                      checked={allSelected}
                      onChange={e => selectLots(e.target.checked ? expiring.map(r => r.lotId) : [])}
                    />
                  </th>
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
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        aria-label={`${r.productName} ロット${r.lotNo} を選択`}
                        checked={selectedLotIds.has(r.lotId)}
                        onChange={() => toggleLot(r.lotId)}
                      />
                    </td>
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

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">廃棄ロス（商品別）</h3>
          <label className="dashboard-days">
            集計期間
            <select
              aria-label="廃棄ロスの集計期間"
              value={disposalPeriod}
              onChange={e => setDisposalPeriod(e.target.value as DisposalPeriod)}
            >
              {DISPOSAL_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <span className="dashboard-section-note">
            廃棄ロス金額 {yen(disposalSum.costValue)}（{disposalSum.count}件 / {disposalSum.quantity.toLocaleString()}個）
          </span>
          <button
            className="btn-add-lot"
            onClick={() => exportDisposalCsv(disposals)}
            disabled={disposals.length === 0}
            title={csvExportHint('disposal')}
          >
            {csvExportLabel('disposal')}
          </button>
        </div>
        <div className="table-wrapper">
          {disposals.length === 0 ? (
            <p className="empty">{disposalPeriod}の廃棄はありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>廃棄件数</th>
                  <th style={{ textAlign: 'right' }}>廃棄数量</th>
                  <th style={{ textAlign: 'right' }}>廃棄金額（原価）</th>
                </tr>
              </thead>
              <tbody>
                {disposals.map(r => (
                  <tr key={r.productId}>
                    <td><strong>{r.productName}</strong></td>
                    <td className="mono">{r.productSku}</td>
                    <td style={{ textAlign: 'right' }}>{r.count}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      <span className="qty-out">{yen(r.costValue)}</span>
                    </td>
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
      {confirmDialog}
      {notifyDialog}
    </div>
  );
}
