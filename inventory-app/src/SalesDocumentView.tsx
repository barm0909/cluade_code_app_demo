import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  EMPTY_SALES_DOCUMENT_FILTER,
  SALES_DOCUMENT_KINDS,
  csvExportHint,
  csvExportLabel,
  exportSalesDocumentCsv,
  paidDocumentIds,
  salesDocuments,
} from './useInventory';
import type {
  Customer,
  IssueSalesDocumentInput,
  PaymentItem,
  SalesDocument,
  SalesDocumentFilter,
  SalesDocumentItem,
  SalesDocumentKind,
  SalesRow,
} from './useInventory';
import { SalesDocumentModal } from './SalesDocumentModal';
import { SalesDocumentPaper } from './SalesDocumentPaper';
import { useConfirm } from './useConfirm';

interface Props {
  items: SalesDocumentItem[];
  sales: SalesRow[];
  customers: Customer[];
  /** 入金。入金を充てた請求書は取り消せない */
  payments?: PaymentItem[];
  onIssue: (input: IssueSalesDocumentInput) => SalesDocument | null;
  /** 取消。入金があるなどで取り消せなかったときは false */
  onDelete: (documentId: string) => boolean | void;
}

/**
 * 納品書・請求書タブ。上の「納品書を作成」「請求書を作成」で SalesDocumentModal を開き、
 * 下に発行済みの書類を一覧する (発注履歴タブと同じ構成)。絞り込み・集計は純粋関数
 * salesDocuments に任せ、この画面は表示と、再表示・取消・CSV の受け渡しだけを持つ。
 *
 * 再表示は発行した時点のスナップショットをそのまま描く (マスタを変えても書類は変わらない)。
 * そこでの印刷は同じ書類をもう一度出すだけなので、発行履歴は増えない。
 */
export function SalesDocumentView({ items, sales, customers, payments = [], onIssue, onDelete }: Props) {
  const [filter, setFilter] = useState<SalesDocumentFilter>(EMPTY_SALES_DOCUMENT_FILTER);
  const [creating, setCreating] = useState<SalesDocumentKind | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const set = <K extends keyof SalesDocumentFilter>(key: K, value: SalesDocumentFilter[K]) =>
    setFilter(prev => ({ ...prev, [key]: value }));

  const allDocs = useMemo(() => salesDocuments(items), [items]);
  const docs = useMemo(() => salesDocuments(items, filter), [items, filter]);
  const paidIds = useMemo(() => paidDocumentIds(payments), [payments]);
  const openDoc = openId ? allDocs.find(d => d.documentId === openId) ?? null : null;
  const isFiltered = (Object.keys(EMPTY_SALES_DOCUMENT_FILTER) as (keyof SalesDocumentFilter)[])
    .some(k => filter[k] !== EMPTY_SALES_DOCUMENT_FILTER[k]);

  const handleDelete = async (doc: SalesDocument) => {
    const ok = await confirm({
      title: `${doc.kind}の取消`,
      message: `${doc.kind} ${doc.documentNo}（${doc.customerName}）を取り消しますか？`
        + `載っていた売上は、ふたたび${doc.kind}に載せられるようになります。すでに相手に渡した書類は回収・破棄してください。`,
      confirmLabel: '取り消す',
      tone: 'danger',
    });
    if (ok) onDelete(doc.documentId);
  };

  return (
    <>
      <div className="controls ledger-controls">
        <button className="btn-primary" onClick={() => setCreating('納品書')}>+ 納品書を作成</button>
        <button className="btn-primary" onClick={() => setCreating('請求書')}>+ 請求書を作成</button>
        <input
          className="search-input"
          placeholder="書類番号・得意先名・商品名で検索..."
          value={filter.keyword}
          onChange={e => set('keyword', e.target.value)}
        />
        <select aria-label="種類" value={filter.kind} onChange={e => set('kind', e.target.value as SalesDocumentKind | '')}>
          <option value="">全種類</option>
          {SALES_DOCUMENT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <select aria-label="得意先" value={filter.customerId} onChange={e => set('customerId', e.target.value)}>
          <option value="">全得意先</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="ledger-date-range">
          <input type="date" aria-label="発行日（開始）" value={filter.from} max={filter.to || undefined} onChange={e => set('from', e.target.value)} />
          <span>〜</span>
          <input type="date" aria-label="発行日（終了）" value={filter.to} min={filter.from || undefined} onChange={e => set('to', e.target.value)} />
        </label>
        {isFiltered && (
          <button className="btn-ghost-light" onClick={() => setFilter(EMPTY_SALES_DOCUMENT_FILTER)}>条件クリア</button>
        )}
      </div>

      <div className="ledger-summary">
        <span>{docs.length}件{isFiltered ? ` / 全${allDocs.length}件` : ''}</span>
        <button
          className="btn-add-lot"
          disabled={docs.length === 0}
          onClick={() => exportSalesDocumentCsv(docs)}
          title={csvExportHint('salesDocument')}
        >
          {csvExportLabel('salesDocument')}
        </button>
      </div>

      <div className="table-wrapper">
        {allDocs.length === 0 ? (
          <p className="empty">発行した納品書・請求書はまだありません。「納品書を作成」「請求書を作成」から、得意先の売上をまとめて書類にできます。</p>
        ) : docs.length === 0 ? (
          <p className="empty">条件に一致する書類がありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>発行日</th>
                <th>種類</th>
                <th>書類番号</th>
                <th>得意先</th>
                <th>対象</th>
                <th style={{ textAlign: 'right' }}>明細</th>
                <th style={{ textAlign: 'right' }}>金額（税込）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.documentId}>
                  <td className="mono">{d.issueDate}</td>
                  <td>{d.kind}</td>
                  <td className="mono">{d.documentNo}</td>
                  <td><strong>{d.customerName}</strong></td>
                  <td className="mono">{d.periodFrom === d.periodTo ? d.periodFrom : `${d.periodFrom} 〜 ${d.periodTo}`}</td>
                  <td style={{ textAlign: 'right' }}>{d.items.length}</td>
                  <td style={{ textAlign: 'right' }}>¥{d.totals.amountWithTax.toLocaleString()}</td>
                  <td>
                    <button className="btn-edit" onClick={() => setOpenId(d.documentId)}>再表示</button>
                    <button
                      className="btn-delete"
                      disabled={paidIds.has(d.documentId)}
                      title={paidIds.has(d.documentId) ? '入金を充てた請求書は取り消せません（入金管理で入金を削除してください）' : undefined}
                      onClick={() => handleDelete(d)}
                    >取消</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <SalesDocumentModal
          kind={creating}
          sales={sales}
          customers={customers}
          items={items}
          onIssue={onIssue}
          onClose={() => setCreating(null)}
        />
      )}

      {openDoc && createPortal(
        <div className="modal-overlay po-overlay" onClick={() => setOpenId(null)}>
          <div className="modal modal-wide modal-panel modal-po" onClick={e => e.stopPropagation()}>
            <h2 className="no-print">{openDoc.kind}（発行済み） — {openDoc.customerName}</h2>
            <div className="modal-body">
              <SalesDocumentPaper doc={openDoc} />
            </div>
            <div className="modal-actions no-print">
              <button type="button" className="btn-secondary" onClick={() => setOpenId(null)}>閉じる</button>
              <button type="button" className="btn-primary" onClick={() => window.print()}>印刷</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmDialog}
    </>
  );
}
