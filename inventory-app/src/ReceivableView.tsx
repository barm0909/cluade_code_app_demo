import { useMemo, useState } from 'react';
import {
  DEFAULT_RECEIVABLE_FILTER,
  EMPTY_PAYMENT_FILTER,
  INVOICE_PAYMENT_STATUSES,
  csvExportHint,
  csvExportLabel,
  customerReceivables,
  exportCustomerReceivableCsv,
  exportPaymentCsv,
  exportReceivableCsv,
  filterReceivables,
  paymentReceipts,
  receivableRows,
  receivableTotals,
} from './useInventory';
import type {
  Customer,
  InvoicePaymentStatus,
  PaymentFilter,
  PaymentInput,
  PaymentItem,
  PaymentPlan,
  PaymentReceipt,
  ReceivableFilter,
  ReceivableStatusFilter,
  SalesDocumentItem,
  SalesRow,
} from './useInventory';
import { PaymentModal } from './PaymentModal';
import { useConfirm, useNotify } from './useConfirm';

interface Props {
  items: SalesDocumentItem[];
  payments: PaymentItem[];
  sales: SalesRow[];
  customers: Customer[];
  /** 入金登録。登録できなかったときは null */
  onRecordPayment: (input: PaymentInput) => PaymentPlan | null;
  onDeletePayment: (receiptId: string) => void;
}

const MODES = {
  invoice: '請求書別',
  customer: '得意先別',
  payment: '入金履歴',
} as const;

type Mode = keyof typeof MODES;

const STATUS_CLASS: Record<InvoicePaymentStatus, string> = {
  未入金: 'status-pending',
  一部入金: 'status-partial',
  入金済: 'status-done',
};

const STATUS_FILTERS: { value: ReceivableStatusFilter; label: string }[] = [
  { value: '未回収', label: '未回収（未入金・一部入金）' },
  { value: '期限超過', label: '期限超過' },
  ...INVOICE_PAYMENT_STATUSES.map(s => ({ value: s, label: s })),
  { value: '', label: 'すべて' },
];

const yen = (v: number) => `${v < 0 ? '-' : ''}¥${Math.abs(Math.round(v)).toLocaleString()}`;

/**
 * 入金管理タブ (納品書・請求書の右隣)。発行した請求書に入金を充てて (消込)、
 * 請求書ごとの残高・期限超過と、得意先ごとの売掛金残高を見る。
 * 集計・絞り込み・CSV は useInventory.ts の純粋関数 (receivableRows / customerReceivables /
 * receivableTotals / filterReceivables / paymentReceipts) に任せ、この画面は表示と
 * 入金登録・削除の受け渡しだけを持つ (売上管理・納品書・請求書と同じ構成)。
 */
export function ReceivableView({ items, payments, sales, customers, onRecordPayment, onDeletePayment }: Props) {
  const [mode, setMode] = useState<Mode>('invoice');
  const [filter, setFilter] = useState<ReceivableFilter>(DEFAULT_RECEIVABLE_FILTER);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(EMPTY_PAYMENT_FILTER);
  const [entry, setEntry] = useState<{ customerId: string; documentIds?: string[] } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { notify, notifyDialog } = useNotify();

  const receivables = useMemo(() => receivableRows(items, payments), [items, payments]);
  const byCustomer = useMemo(
    () => customerReceivables(receivables, sales, items, payments, customers),
    [receivables, sales, items, payments, customers],
  );
  const totals = useMemo(() => receivableTotals(receivables, byCustomer, payments), [receivables, byCustomer, payments]);
  const filteredInvoices = useMemo(() => filterReceivables(receivables, filter), [receivables, filter]);
  const allReceipts = useMemo(() => paymentReceipts(payments, customers), [payments, customers]);
  const receipts = useMemo(() => paymentReceipts(payments, customers, paymentFilter), [payments, customers, paymentFilter]);

  const invoiceFiltered = (Object.keys(DEFAULT_RECEIVABLE_FILTER) as (keyof ReceivableFilter)[])
    .some(k => filter[k] !== DEFAULT_RECEIVABLE_FILTER[k]);
  const paymentFiltered = (Object.keys(EMPTY_PAYMENT_FILTER) as (keyof PaymentFilter)[])
    .some(k => paymentFilter[k] !== EMPTY_PAYMENT_FILTER[k]);
  const setF = <K extends keyof ReceivableFilter>(key: K, value: ReceivableFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));
  const setPF = <K extends keyof PaymentFilter>(key: K, value: PaymentFilter[K]) =>
    setPaymentFilter(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (input: PaymentInput) => {
    const plan = onRecordPayment(input);
    if (!plan) {
      notify('入金を登録できませんでした。入力内容を確認してください。', '入金登録');
      return null;
    }
    return plan;
  };

  const handleDelete = async (r: PaymentReceipt) => {
    const ok = await confirm({
      title: '入金の削除',
      message: `${r.paymentDate} ${r.customerName} の入金 ${yen(r.amount)} を削除しますか？`
        + (r.applied.length > 0 ? `充てていた請求書（${r.applied.map(a => a.documentNo).join('、')}）の残高は元に戻ります。` : ''),
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (ok) onDeletePayment(r.receiptId);
  };

  return (
    <>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">売掛金残高</div>
          <div className="stat-value">{yen(totals.balance)}</div>
          <div className="stat-sub">請求残高 + 未請求売上 − 未消込入金</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">請求残高</div>
          <div className="stat-value">{yen(totals.invoiceBalance)}</div>
          <div className="stat-sub">未回収の請求書 {totals.openInvoices}枚</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">期限超過</div>
          <div className={totals.overdue > 0 ? 'stat-value expired-text' : 'stat-value'}>{yen(totals.overdue)}</div>
          <div className="stat-sub">{totals.overdueInvoices}枚</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">未請求売上（税込）</div>
          <div className="stat-value">{yen(totals.unbilled)}</div>
          <div className="stat-sub">まだ請求書に載せていない売上</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今月の入金</div>
          <div className="stat-value">{yen(totals.receivedThisMonth)}</div>
          <div className="stat-sub">未消込 {yen(totals.unapplied)}</div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h3 className="dashboard-section-title">入金・売掛金</h3>
          <span className="dashboard-section-note">
            発行した請求書に入金を充てて残高を管理します（在庫・入出庫帳票は動きません）
          </span>
          <button className="btn-primary" onClick={() => setEntry({ customerId: '' })} disabled={customers.length === 0}>
            + 入金を登録
          </button>
        </div>

        <div className="sales-modes" role="group" aria-label="表示の切り替え">
          {(Object.keys(MODES) as Mode[]).map(m => (
            <button key={m} className={mode === m ? 'sales-mode active' : 'sales-mode'} onClick={() => setMode(m)}>
              {MODES[m]}
            </button>
          ))}
        </div>

        {mode === 'invoice' && (<>
          <div className="controls ledger-controls">
            <input
              className="search-input"
              placeholder="請求書番号・得意先名で検索..."
              value={filter.keyword}
              onChange={e => setF('keyword', e.target.value)}
            />
            <select aria-label="得意先" value={filter.customerId} onChange={e => setF('customerId', e.target.value)}>
              <option value="">全得意先</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="入金状況" value={filter.status} onChange={e => setF('status', e.target.value as ReceivableStatusFilter)}>
              {STATUS_FILTERS.map(s => <option key={s.label} value={s.value}>{s.label}</option>)}
            </select>
            {invoiceFiltered && (
              <button className="btn-ghost-light" onClick={() => setFilter(DEFAULT_RECEIVABLE_FILTER)}>条件クリア</button>
            )}
          </div>
          <div className="ledger-summary">
            <span>{filteredInvoices.length}件 / 請求書 全{receivables.length}件</span>
            <button
              className="btn-add-lot"
              disabled={filteredInvoices.length === 0}
              onClick={() => exportReceivableCsv(filteredInvoices)}
              title={csvExportHint('receivable')}
            >{csvExportLabel('receivable')}</button>
          </div>
          <div className="table-wrapper">
            {receivables.length === 0 ? (
              <p className="empty">発行した請求書がありません。「納品書・請求書」タブで請求書を発行すると、ここで入金を管理できます。</p>
            ) : filteredInvoices.length === 0 ? (
              <p className="empty">条件に一致する請求書がありません。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>請求書番号</th>
                    <th>得意先</th>
                    <th>発行日</th>
                    <th>お支払期限</th>
                    <th style={{ textAlign: 'right' }}>請求額（税込）</th>
                    <th style={{ textAlign: 'right' }}>入金済</th>
                    <th style={{ textAlign: 'right' }}>残高</th>
                    <th>状況</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(r => (
                    <tr key={r.documentId} className={r.overdueDays > 0 ? 'row-alert' : ''}>
                      <td className="mono">{r.documentNo}</td>
                      <td><strong>{r.customerName}</strong></td>
                      <td className="mono">{r.issueDate}</td>
                      <td className="mono">
                        {r.dueDate || '—'}
                        {r.overdueDays > 0 && <span className="inbound-overdue" title="お支払期限を過ぎています">{r.overdueDays}日超過</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{yen(r.billed)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.paid > 0 ? yen(r.paid) : '—'}
                        {r.lastPaymentDate && <div className="stat-sub">最終 {r.lastPaymentDate}</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        <span className={r.remaining > 0 ? 'qty-out' : ''}>{yen(r.remaining)}</span>
                      </td>
                      <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{r.status}</span></td>
                      <td>
                        <button
                          className="btn-edit"
                          disabled={r.remaining <= 0}
                          onClick={() => setEntry({ customerId: r.customerId, documentIds: [r.documentId] })}
                        >入金登録</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}

        {mode === 'customer' && (<>
          <div className="ledger-summary">
            <span>{byCustomer.length}得意先</span>
            <button
              className="btn-add-lot"
              disabled={byCustomer.length === 0}
              onClick={() => exportCustomerReceivableCsv(byCustomer)}
              title={csvExportHint('customerReceivable')}
            >{csvExportLabel('customerReceivable')}</button>
          </div>
          <div className="table-wrapper">
            {byCustomer.length === 0 ? (
              <p className="empty">売掛金はありません（得意先つきの売上・請求書・入金がまだありません）。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>得意先</th>
                    <th style={{ textAlign: 'right' }}>請求残高</th>
                    <th style={{ textAlign: 'right' }}>うち期限超過</th>
                    <th style={{ textAlign: 'right' }}>未請求売上（税込）</th>
                    <th style={{ textAlign: 'right' }}>未消込入金</th>
                    <th style={{ textAlign: 'right' }}>売掛金残高</th>
                    <th>最終入金日</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.map(c => (
                    <tr key={c.customerId} className={c.overdue > 0 ? 'row-alert' : ''}>
                      <td><strong>{c.customerName}</strong></td>
                      <td style={{ textAlign: 'right' }}>
                        {yen(c.invoiceBalance)}
                        {c.openInvoices > 0 && <div className="stat-sub">{c.openInvoices}枚</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {c.overdue > 0 ? <span className="qty-out">{yen(c.overdue)}</span> : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{c.unbilled !== 0 ? yen(c.unbilled) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{c.unapplied > 0 ? yen(c.unapplied) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{yen(c.balance)}</td>
                      <td className="mono">{c.lastPaymentDate || '—'}</td>
                      <td>
                        <button className="btn-edit" onClick={() => setEntry({ customerId: c.customerId })}>入金登録</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}

        {mode === 'payment' && (<>
          <div className="controls ledger-controls">
            <input
              className="search-input"
              placeholder="得意先名・請求書番号・備考で検索..."
              value={paymentFilter.keyword}
              onChange={e => setPF('keyword', e.target.value)}
            />
            <select aria-label="得意先" value={paymentFilter.customerId} onChange={e => setPF('customerId', e.target.value)}>
              <option value="">全得意先</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="ledger-date-range">
              <input type="date" aria-label="入金日（開始）" value={paymentFilter.from} max={paymentFilter.to || undefined} onChange={e => setPF('from', e.target.value)} />
              <span>〜</span>
              <input type="date" aria-label="入金日（終了）" value={paymentFilter.to} min={paymentFilter.from || undefined} onChange={e => setPF('to', e.target.value)} />
            </label>
            {paymentFiltered && (
              <button className="btn-ghost-light" onClick={() => setPaymentFilter(EMPTY_PAYMENT_FILTER)}>条件クリア</button>
            )}
          </div>
          <div className="ledger-summary">
            <span>{receipts.length}件{paymentFiltered ? ` / 全${allReceipts.length}件` : ''}</span>
            <span>入金 {yen(receipts.reduce((s, r) => s + r.amount, 0))}</span>
            <button
              className="btn-add-lot"
              disabled={receipts.length === 0}
              onClick={() => exportPaymentCsv(receipts)}
              title={csvExportHint('payment')}
            >{csvExportLabel('payment')}</button>
          </div>
          <div className="table-wrapper">
            {allReceipts.length === 0 ? (
              <p className="empty">入金の記録はまだありません。「+ 入金を登録」から登録できます。</p>
            ) : receipts.length === 0 ? (
              <p className="empty">条件に一致する入金がありません。</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>入金日</th>
                    <th>得意先</th>
                    <th>方法</th>
                    <th style={{ textAlign: 'right' }}>入金額</th>
                    <th style={{ textAlign: 'right' }}>手数料</th>
                    <th>消込先</th>
                    <th>備考</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map(r => (
                    <tr key={r.receiptId}>
                      <td className="mono">{r.paymentDate}</td>
                      <td><strong>{r.customerName}</strong></td>
                      <td>{r.method}</td>
                      <td style={{ textAlign: 'right' }}>{yen(r.amount)}</td>
                      <td style={{ textAlign: 'right' }}>{r.fee > 0 ? yen(r.fee) : '—'}</td>
                      <td>
                        {r.applied.map(a => (
                          <div key={a.documentId}><span className="mono">{a.documentNo}</span> {yen(a.amount)}</div>
                        ))}
                        {r.unapplied > 0 && <div className="qty-out">未消込 {yen(r.unapplied)}</div>}
                      </td>
                      <td>{r.note}</td>
                      <td><button className="btn-delete" onClick={() => handleDelete(r)}>削除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}
      </section>

      {entry && (
        <PaymentModal
          receivables={receivables}
          customers={customers}
          initialCustomerId={entry.customerId}
          initialDocumentIds={entry.documentIds}
          onSubmit={handleSubmit}
          onClose={() => setEntry(null)}
        />
      )}
      {confirmDialog}
      {notifyDialog}
    </>
  );
}
