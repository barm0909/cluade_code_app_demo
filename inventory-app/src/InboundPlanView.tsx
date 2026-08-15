import { useMemo, useState } from 'react';
import {
  EMPTY_INBOUND_PLAN_FILTER,
  INBOUND_PLAN_STATUSES,
  csvExportHint,
  csvExportLabel,
  exportInboundPlanCsv,
  inboundPlanRows,
  inboundPlanTotals,
  supplierName,
} from './useInventory';
import type {
  InboundPlan,
  InboundPlanFilter,
  InboundPlanInput,
  InboundPlanStatus,
  Product,
  ReceiveInput,
  ReceiptResult,
  Supplier,
  Warehouse,
} from './useInventory';
import { InboundPlanModal } from './InboundPlanModal';
import { ReceiveInboundModal } from './ReceiveInboundModal';
import { ExpiryBadge, WarehouseDot } from './badges';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  inboundPlans: InboundPlan[];
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  onAdd: (data: InboundPlanInput) => void;
  onUpdate: (id: string, data: InboundPlanInput) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onReceive: (id: string, input: ReceiveInput) => ReceiptResult | null;
}

const STATUS_CLASS: Record<InboundPlanStatus, string> = {
  未入荷: 'status-pending',
  一部入荷: 'status-partial',
  入荷済: 'status-done',
  キャンセル: 'status-canceled',
};

/**
 * 入荷予定タブ。予定の作成・編集・キャンセル・削除と、予定にもとづく入荷を行う。
 * 絞り込み・集計・CSV はすべて useInventory.ts の純粋関数 (inboundPlanRows / inboundPlanTotals /
 * inboundPlanCsv) に任せ、この画面は表示と操作の受け渡しだけを持つ。
 */
export function InboundPlanView({ inboundPlans, products, warehouses, suppliers, onAdd, onUpdate, onCancel, onDelete, onReceive }: Props) {
  const [filter, setFilter] = useState<InboundPlanFilter>(EMPTY_INBOUND_PLAN_FILTER);
  // 編集対象は id で持ち、常に最新の予定を引き直す (入荷して残数が変わっても表示がずれないように)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const set = <K extends keyof InboundPlanFilter>(key: K, value: InboundPlanFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const rows = useMemo(
    () => inboundPlanRows(inboundPlans, products, filter, suppliers),
    [inboundPlans, products, filter, suppliers],
  );
  const totals = useMemo(() => inboundPlanTotals(rows), [rows]);
  const isFiltered = (Object.keys(EMPTY_INBOUND_PLAN_FILTER) as (keyof InboundPlanFilter)[])
    .some(k => filter[k] !== EMPTY_INBOUND_PLAN_FILTER[k]);

  const editingPlan = editingId && editingId !== 'new' ? inboundPlans.find(p => p.id === editingId) ?? null : null;
  const receivingPlan = receivingId ? inboundPlans.find(p => p.id === receivingId) ?? null : null;
  const receivingProduct = receivingPlan ? products.find(p => p.id === receivingPlan.productId) ?? null : null;

  const handleReceive = (plan: InboundPlan, input: ReceiveInput) => {
    const result = onReceive(plan.id, input);
    if (!result) return;
    notify(
      `${result.quantity} を入荷しました（ロット ${result.lotNo}）。`
      + (result.merged ? '既存ロットに加算しました。' : '新しいロットを作成しました。')
      + `\n残数：${result.remaining}`
      + (result.remaining === 0 ? '（入荷済）' : ''),
      '入荷',
    );
  };

  return (
    <>
      <div className="controls ledger-controls">
        <input
          className="search-input"
          placeholder="商品名・SKU・ロットNo・仕入先で検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <label className="ledger-date-range">
          <input type="date" aria-label="予定日（開始）" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="予定日（終了）" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        <select aria-label="状態" value={filter.status} onChange={e => set('status', e.target.value as InboundPlanStatus | '')}>
          <option value="">全状態</option>
          {INBOUND_PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="入荷先倉庫" value={filter.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
          <option value="">全倉庫</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="仕入先" value={filter.supplierId} onChange={e => set('supplierId', e.target.value)}>
          <option value="">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_INBOUND_PLAN_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{rows.length}件{isFiltered ? ` / 全${inboundPlans.length}件` : ''}</span>
        <span>予定 {totals.planned.toLocaleString()}</span>
        <span className="qty-in">入荷済 {totals.received.toLocaleString()}</span>
        <span className="qty-move">残 {totals.remaining.toLocaleString()}</span>
        {totals.overdue > 0 && <span className="qty-out">遅延 {totals.overdue}件</span>}
        <div className="stocktake-actions">
          <button
            className="btn-add-lot"
            disabled={rows.length === 0}
            onClick={() => exportInboundPlanCsv(rows, warehouses)}
            title={csvExportHint('inbound')}
          >
            {csvExportLabel('inbound')}
          </button>
          <button className="btn-primary" onClick={() => setEditingId('new')}>+ 入荷予定を追加</button>
        </div>
      </div>

      <div className="table-wrapper">
        {rows.length === 0 ? (
          <p className="empty">
            {inboundPlans.length === 0
              ? '入荷予定がありません。「+ 入荷予定を追加」から登録してください。'
              : '条件に一致する入荷予定がありません。'}
          </p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>入荷予定日</th>
              <th>商品名</th>
              <th>SKU</th>
              <th>ロットNo</th>
              <th>賞味期限</th>
              <th>入荷先</th>
              <th>仕入先</th>
              <th style={{ textAlign: 'right' }}>予定</th>
              <th style={{ textAlign: 'right' }}>入荷済</th>
              <th style={{ textAlign: 'right' }}>残</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.plan.id} className={r.overdue ? 'row-expiring' : ''}>
                <td className="mono">
                  {r.plan.expectedDate}
                  {r.overdue && <span className="inbound-overdue" title="入荷予定日を過ぎています">遅延</span>}
                </td>
                <td><strong>{r.productName}</strong></td>
                <td className="mono">{r.productSku}</td>
                <td className="mono">{r.plan.lotNo}</td>
                <td><ExpiryBadge expiryDate={r.plan.expiryDate} /></td>
                <td><WarehouseDot warehouse={warehouses.find(w => w.id === r.plan.warehouseId)} /></td>
                <td>{r.supplierName || '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.plan.quantity}</td>
                <td style={{ textAlign: 'right' }}>{r.plan.receivedQuantity}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.remaining}</td>
                <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{r.status}</span></td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn-receive"
                      disabled={r.remaining === 0}
                      title={r.remaining === 0 ? 'この予定に入荷できる残数はありません' : '予定の内容でロットに入庫します'}
                      onClick={() => setReceivingId(r.plan.id)}
                    >入荷</button>
                    <button
                      className="btn-edit"
                      disabled={r.status === 'キャンセル'}
                      onClick={() => setEditingId(r.plan.id)}
                    >編集</button>
                    <button
                      className="btn-move"
                      disabled={r.remaining === 0}
                      title={r.remaining === 0 ? '残数のない予定は取消できません' : '残りの入荷を取り消します（入荷済の分は在庫に残ります）'}
                      onClick={async () => {
                        const ok = await confirm({
                          title: '入荷予定の取消',
                          message: `${r.productName} の入荷予定（${r.plan.expectedDate}・残 ${r.remaining}）を取り消します。\n入荷済みの ${r.plan.receivedQuantity} は在庫・帳票にそのまま残ります。`,
                          confirmLabel: '取消する',
                          tone: 'danger',
                        });
                        if (ok) onCancel(r.plan.id);
                      }}
                    >取消</button>
                    <button
                      className="btn-delete"
                      onClick={async () => {
                        const ok = await confirm({
                          message: `${r.productName} の入荷予定（${r.plan.expectedDate}）を削除しますか？\n記録が残らないため、履歴を残したい場合は「取消」を使ってください。`,
                          confirmLabel: '削除',
                          tone: 'danger',
                        });
                        if (ok) onDelete(r.plan.id);
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
        <InboundPlanModal
          plan={editingPlan}
          products={products}
          warehouses={warehouses}
          suppliers={suppliers}
          onSave={data => editingId === 'new' ? onAdd(data) : onUpdate(editingId, data)}
          onClose={() => setEditingId(null)}
        />
      )}
      {receivingPlan && receivingProduct && (
        <ReceiveInboundModal
          plan={receivingPlan}
          product={receivingProduct}
          warehouses={warehouses}
          supplierName={supplierName(suppliers, receivingPlan.supplierId)}
          onReceive={input => handleReceive(receivingPlan, input)}
          onClose={() => setReceivingId(null)}
        />
      )}
      {confirmDialog}
      {notifyDialog}
    </>
  );
}
