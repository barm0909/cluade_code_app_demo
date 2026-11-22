import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  closingCandidates,
  closingInvoiceInput,
  customerBillingTermsLabel,
  draftSalesDocuments,
  isValidRegistrationNo,
  latestClosingDateAmong,
  localDateKey,
} from './useInventory';
import type {
  Customer,
  IssueSalesDocumentInput,
  PaymentItem,
  SalesDocument,
  SalesDocumentIssuer,
  SalesDocumentItem,
  SalesRow,
} from './useInventory';
import { SalesDocumentPaper } from './SalesDocumentPaper';
import { loadIssuer, saveIssuer } from './salesDocumentIssuer';

interface Props {
  sales: SalesRow[];
  customers: Customer[];
  items: SalesDocumentItem[];
  payments: PaymentItem[];
  /** まとめて発行する。発行できた書類を返す */
  onIssue: (inputs: IssueSalesDocumentInput[]) => SalesDocument[];
  onClose: () => void;
}

const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString()}`;

/**
 * 締め請求。締め日を選ぶと、その日が締め日にあたる得意先 (得意先マスタの締め日。都度請求は対象外) ごとに
 * 対象期間・お支払期限・載せる売上・前回からの繰越を自動で組み立て (closingCandidates)、
 * チェックした得意先の請求書をまとめて発行・印刷する。
 *
 * 紙面のプレビューは発行と同じ buildSalesDocumentItems で組み立てる (draftSalesDocuments) ので、
 * 書類番号・金額は発行されるものと一致する。発行すると issueSalesDocuments が保存直前の状態で
 * 二重請求と繰越を確かめ直す。印刷 CSS は請求書作成と共通 (`.po-overlay`)。
 */
export function ClosingModal({ sales, customers, items, payments, onIssue, onClose }: Props) {
  const [today] = useState(() => localDateKey(new Date().toISOString()));
  const [closingDate, setClosingDate] = useState(() => latestClosingDateAmong(customers, today) || today);
  const [issueDate, setIssueDate] = useState(today);
  const [issuer, setIssuer] = useState<SalesDocumentIssuer>(loadIssuer);
  // 外した得意先。空 = 発行できる得意先を全部選ぶ
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');

  const candidates = useMemo(
    () => closingCandidates(closingDate, customers, sales, items, payments, issueDate),
    [closingDate, customers, sales, items, payments, issueDate],
  );
  const selectable = candidates.filter(c => c.lines.length > 0 && !c.issuedNo);
  const selected = selectable.filter(c => !excluded.has(c.customer.id));
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  const inputs = selected.map(c => closingInvoiceInput(c, issueDate, issuer));
  const drafts = draftSalesDocuments(inputs, items);
  const total = selected.reduce((s, c) => s + c.grandTotal, 0);

  const validation = !closingDate ? '締め日を入力してください'
    : !issueDate ? '発行日を入力してください'
    : !isValidRegistrationNo(issuer.registrationNo.trim()) ? '登録番号は「T」に続けて13桁の数字で入力してください'
    : selected.length === 0 ? '発行する得意先を1件以上選んでください'
    : '';

  const setIssuerField = (key: keyof SalesDocumentIssuer, value: string) => {
    setIssuer(prev => {
      const next = { ...prev, [key]: value };
      saveIssuer(next);
      return next;
    });
  };

  const toggle = (id: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setExcluded(allSelected ? new Set(selectable.map(c => c.customer.id)) : new Set());

  const handleIssue = () => {
    if (validation) return;
    const docs = onIssue(inputs);
    if (docs.length === 0) {
      setError('発行できませんでした。選んだ売上がすでに請求書に載っていないか確認してください。');
      return;
    }
    window.print();
    onClose();
  };

  return createPortal(
    <div className="modal-overlay po-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel modal-po modal-closing" onClick={e => e.stopPropagation()}>
        <h2 className="no-print">締め請求</h2>

        <div className="modal-body">
          <div className="form-grid no-print">
            <label htmlFor="closing-date">
              締め日
              <input id="closing-date" type="date" value={closingDate}
                onChange={e => { setClosingDate(e.target.value); setExcluded(new Set()); setError(''); }} />
            </label>
            <label htmlFor="closing-issue-date">
              発行日
              <input id="closing-issue-date" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </label>
          </div>

          <details className="sd-issuer no-print">
            <summary>発行元（自社）情報 <span className="label-hint">（この端末に保存されます。請求書の作成と共通）</span></summary>
            <div className="form-grid">
              <label htmlFor="closing-issuer-name">
                発行元名
                <input id="closing-issuer-name" value={issuer.name} onChange={e => setIssuerField('name', e.target.value)} />
              </label>
              <label htmlFor="closing-issuer-address">
                住所
                <input id="closing-issuer-address" value={issuer.address} onChange={e => setIssuerField('address', e.target.value)} />
              </label>
              <label htmlFor="closing-issuer-phone">
                電話番号
                <input id="closing-issuer-phone" value={issuer.phone} onChange={e => setIssuerField('phone', e.target.value)} />
              </label>
              <label htmlFor="closing-issuer-contact">
                担当者
                <input id="closing-issuer-contact" value={issuer.contact} onChange={e => setIssuerField('contact', e.target.value)} />
              </label>
              <label htmlFor="closing-issuer-reg">
                登録番号 <span className="label-hint">（T＋13桁・任意）</span>
                <input id="closing-issuer-reg" value={issuer.registrationNo} placeholder="T1234567890123"
                  onChange={e => setIssuerField('registrationNo', e.target.value)} />
              </label>
              <label htmlFor="closing-issuer-bank">
                振込先
                <input id="closing-issuer-bank" value={issuer.bankAccount} placeholder="〇〇銀行 △△支店 普通 1234567"
                  onChange={e => setIssuerField('bankAccount', e.target.value)} />
              </label>
            </div>
          </details>

          <div className="fefo-plan no-print">
            <div className="fefo-plan-head">
              この日が締め日の得意先（{selected.length} / {selectable.length}件を発行）
              {selected.length > 0 && <span className="label-hint"> 今回御請求額の合計 {yen(total)}</span>}
            </div>
            {candidates.length === 0 ? (
              <p className="empty">
                {closingDate} が締め日にあたる得意先はいません。
                <span className="label-hint">（締め日は商品マスタタブの得意先マスタで設定します。都度請求の得意先は対象外です）</span>
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="po-check-col">
                      <input type="checkbox" checked={allSelected} disabled={selectable.length === 0} onChange={toggleAll} aria-label="すべて選択" />
                    </th>
                    <th>得意先</th>
                    <th>対象期間</th>
                    <th style={{ textAlign: 'right' }}>今回御買上額</th>
                    <th style={{ textAlign: 'right' }}>繰越額</th>
                    <th style={{ textAlign: 'right' }}>今回御請求額</th>
                    <th>お支払期限</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => {
                    const disabled = c.lines.length === 0 || !!c.issuedNo;
                    const checked = !disabled && !excluded.has(c.customer.id);
                    return (
                      <tr key={c.customer.id} className={checked ? '' : 'po-row-excluded'}>
                        <td className="po-check-col">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(c.customer.id)}
                            aria-label={`${c.customer.name}の請求書を発行する`}
                          />
                        </td>
                        <td>
                          <strong>{c.customer.name}</strong>
                          <div className="label-hint">{customerBillingTermsLabel(c.customer)}</div>
                          {c.issuedNo && <div className="label-hint">発行済み（{c.issuedNo}）</div>}
                          {!c.issuedNo && c.lines.length === 0 && <div className="label-hint">請求する売上なし</div>}
                        </td>
                        <td className="mono">
                          {c.periodFrom} 〜 {c.periodTo}
                          {c.earlierLines > 0 && (
                            <div><span className="sd-earlier" title="対象期間より前の、まだ請求書に載っていない売上も含めます">前回以前 {c.earlierLines}件</span></div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {yen(c.totals.amountWithTax)}
                          <div className="label-hint">{c.lines.length}行</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{yen(c.balance.carryOver)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{yen(c.grandTotal)}</td>
                        <td className="mono">{c.dueDate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {drafts.length > 0 && <div className="fefo-plan-head no-print">印刷プレビュー（{drafts.length}枚）</div>}
          {drafts.map(doc => <SalesDocumentPaper key={doc.documentId} doc={doc} />)}
        </div>

        <div className="modal-actions no-print">
          {(error || validation) && <p className="field-error sd-error" role="alert">{error || validation}</p>}
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn-primary" disabled={!!validation} onClick={handleIssue}>
            {selected.length > 0 ? `${selected.length}件を発行して印刷` : '発行して印刷'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
