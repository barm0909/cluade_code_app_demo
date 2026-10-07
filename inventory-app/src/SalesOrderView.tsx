import { useMemo, useState } from 'react';
import {
  EMPTY_SALES_ORDER_FILTER,
  SALES_ORDER_STATUSES,
  csvExportHint,
  csvExportLabel,
  customerName,
  exportSalesOrderCsv,
  salesOrderRows,
  salesOrderTotals,
} from './useInventory';
import type {
  Customer,
  Product,
  SalesOrder,
  SalesOrderFilter,
  SalesOrderInput,
  SalesOrderStatus,
  ShipOrderInput,
  ShipOrderResult,
  Warehouse,
} from './useInventory';
import { SalesOrderModal } from './SalesOrderModal';
import { ShipSalesOrderModal } from './ShipSalesOrderModal';
import { WarehouseDot } from './badges';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  salesOrders: SalesOrder[];
  products: Product[];
  customers: Customer[];
  warehouses: Warehouse[];
  onAdd: (data: SalesOrderInput) => void;
  onUpdate: (id: string, data: SalesOrderInput) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onShip: (id: string, input: ShipOrderInput) => ShipOrderResult | null;
}

const STATUS_CLASS: Record<SalesOrderStatus, string> = {
  未出荷: 'status-pending',
  一部出荷: 'status-partial',
  出荷済: 'status-done',
  キャンセル: 'status-canceled',
};

/**
 * 受注タブ。受注 (出荷予定) の作成・編集・キャンセル・削除と、受注にもとづく出荷を行う。
 * 絞り込み・引当・集計・CSV はすべて useInventory.ts の純粋関数 (salesOrderRows / salesOrderTotals /
 * salesOrderCsv) に任せ、この画面は表示と操作の受け渡しだけを持つ (入荷予定タブと同じ構成)。
 */
export function SalesOrderView({ salesOrders, products, customers, warehouses, onAdd, onUpdate, onCancel, onDelete, onShip }: Props) {
  const [filter, setFilter] = useState<SalesOrderFilter>(EMPTY_SALES_ORDER_FILTER);
  // 編集・出荷の対象は id で持ち、常に最新の受注を引き直す (出荷して残数が変わっても表示がずれないように)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const set = <K extends keyof SalesOrderFilter>(key: K, value: SalesOrderFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const rows = useMemo(
    () => salesOrderRows(salesOrders, products, customers, filter),
    [salesOrders, products, customers, filter],
  );
  const totals = useMemo(() => salesOrderTotals(rows), [rows]);
  const isFiltered = (Object.keys(EMPTY_SALES_ORDER_FILTER) as (keyof SalesOrderFilter)[])
    .some(k => filter[k] !== EMPTY_SALES_ORDER_FILTER[k]);

  const editingOrder = editingId && editingId !== 'new' ? salesOrders.find(o => o.id === editingId) ?? null : null;
  const shippingOrder = shippingId ? salesOrders.find(o => o.id === shippingId) ?? null : null;
  const shippingProduct = shippingOrder ? products.find(p => p.id === shippingOrder.productId) ?? null : null;

  const handleShip = (order: SalesOrder, input: ShipOrderInput) => {
    const result = onShip(order.id, input);
    if (!result) return;
    const lots = result.plan.allocations.map(a => `${a.lotNo}: ${a.quantity}`).join('、');
    notify(
      `${result.plan.allocated} を出荷しました（${result.plan.allocations.length}ロットから引当）。\n${lots}`
      + `\n受注残：${result.remaining}`
      + (result.remaining === 0 ? '（出荷済）' : ''),
      '出荷',
    );
  };

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="商品名・SKU・得意先で検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <label className="ledger-date-range">
          <input type="date" aria-label="出荷予定日（開始）" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="出荷予定日（終了）" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        <select aria-label="状態" value={filter.status} onChange={e => set('status', e.target.value as SalesOrderStatus | '')}>
          <option value="">全状態</option>
          {SALES_ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="得意先" value={filter.customerId} onChange={e => set('customerId', e.target.value)}>
          <option value="">全得意先</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_SALES_ORDER_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{rows.length}件{isFiltered ? ` / 全${salesOrders.length}件` : ''}</span>
        <span>受注 {totals.ordered.toLocaleString()}</span>
        <span className="qty-in">出荷済 {totals.shipped.toLocaleString()}</span>
        <span className="qty-move">残 {totals.remaining.toLocaleString()}（¥{totals.remainingAmount.toLocaleString()}）</span>
        {totals.short > 0 && <span className="qty-out">在庫不足 {totals.short}件</span>}
        {totals.overdue > 0 && <span className="qty-out">遅延 {totals.overdue}件</span>}
        <div className="stocktake-actions">
          <button
            className="btn-add-lot"
            disabled={rows.length === 0}
            onClick={() => exportSalesOrderCsv(rows, warehouses)}
            title={csvExportHint('salesOrder')}
          >
            {csvExportLabel('salesOrder')}
          </button>
          <button className="btn-primary" onClick={() => setEditingId('new')}>+ 受注を登録</button>
        </div>
      </div>

      <div className="table-wrapper">
        {rows.length === 0 ? (
          <p className="empty">
            {salesOrders.length === 0
              ? '受注がありません。「+ 受注を登録」から登録してください。'
              : '条件に一致する受注がありません。'}
          </p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>出荷予定日</th>
              <th>得意先</th>
              <th>商品名</th>
              <th>SKU</th>
              <th>出荷元</th>
              <th style={{ textAlign: 'right' }}>受注単価</th>
              <th style={{ textAlign: 'right' }}>受注</th>
              <th style={{ textAlign: 'right' }}>出荷済</th>
              <th style={{ textAlign: 'right' }}>残</th>
              <th>引当</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.order.id} className={r.shortage > 0 ? 'row-alert' : r.overdue ? 'row-expiring' : ''}>
                <td className="mono">
                  {r.order.expectedDate}
                  {r.overdue && <span className="inbound-overdue" title="出荷予定日を過ぎています">遅延</span>}
                </td>
                <td>{r.customerName || '—'}</td>
                <td><strong>{r.productName}</strong></td>
                <td className="mono">{r.productSku}</td>
                <td>
                  {r.order.warehouseId
                    ? <WarehouseDot warehouse={warehouses.find(w => w.id === r.order.warehouseId)} />
                    : '全倉庫'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.estimatedPrice
                    ? <span title="受注単価が未入力のため販売定価を表示しています">¥{r.unitPrice.toLocaleString()}（概算）</span>
                    : `¥${r.unitPrice.toLocaleString()}`}
                </td>
                <td style={{ textAlign: 'right' }}>{r.order.quantity}</td>
                <td style={{ textAlign: 'right' }}>{r.order.shippedQuantity}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.remaining}</td>
                <td>
                  {r.remaining === 0
                    ? '—'
                    : r.shortage > 0
                      ? <span className="qty-out" title="出荷予定日の早い受注から順に在庫を割り当てたとき、足りない数量です">不足 {r.shortage}</span>
                      : <span className="qty-in">引当可</span>}
                </td>
                <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{r.status}</span></td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn-ship"
                      disabled={r.remaining === 0}
                      title={r.remaining === 0 ? 'この受注に出荷できる残数はありません' : '賞味期限の近いロットから引き当てて売上出庫します'}
                      onClick={() => setShippingId(r.order.id)}
                    >出荷</button>
                    <button
                      className="btn-edit"
                      disabled={r.status === 'キャンセル'}
                      onClick={() => setEditingId(r.order.id)}
                    >編集</button>
                    <button
                      className="btn-move"
                      disabled={r.remaining === 0}
                      title={r.remaining === 0 ? '残数のない受注は取消できません' : '残りの出荷を取り消します（出荷済の分は売上に残ります）'}
                      onClick={async () => {
                        const ok = await confirm({
                          title: '受注の取消',
                          message: `${r.customerName || '得意先'} の ${r.productName}（${r.order.expectedDate}・残 ${r.remaining}）の受注を取り消します。\n出荷済みの ${r.order.shippedQuantity} は売上・帳票にそのまま残ります。`,
                          confirmLabel: '取消する',
                          tone: 'danger',
                        });
                        if (ok) onCancel(r.order.id);
                      }}
                    >取消</button>
                    <button
                      className="btn-delete"
                      onClick={async () => {
                        const ok = await confirm({
                          message: `${r.customerName || '得意先'} の ${r.productName}（${r.order.expectedDate}）の受注を削除しますか？\n記録が残らないため、履歴を残したい場合は「取消」を使ってください。`,
                          confirmLabel: '削除',
                          tone: 'danger',
                        });
                        if (ok) onDelete(r.order.id);
                      }}
                    >削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {editingId !== null && (
        <SalesOrderModal
          order={editingOrder}
          products={products}
          customers={customers}
          warehouses={warehouses}
          onSave={data => editingId === 'new' ? onAdd(data) : onUpdate(editingId, data)}
          onClose={() => setEditingId(null)}
        />
      )}
      {shippingOrder && shippingProduct && (
        <ShipSalesOrderModal
          order={shippingOrder}
          product={shippingProduct}
          customerName={customerName(customers, shippingOrder.customerId)}
          warehouses={warehouses}
          onShip={input => handleShip(shippingOrder, input)}
          onClose={() => setShippingId(null)}
        />
      )}
      {confirmDialog}
      {notifyDialog}
    </>
  );
}
