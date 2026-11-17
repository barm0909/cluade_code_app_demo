import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  EMPTY_SALES_DOCUMENT_ISSUER,
  draftSalesDocument,
  issuedSalesDocumentNos,
  localDateKey,
  nextMonthEnd,
  previousMonthRange,
  salesDocumentLines,
  salesDocumentValidationError,
} from './useInventory';
import type {
  Customer,
  IssueSalesDocumentInput,
  SalesDocument,
  SalesDocumentIssuer,
  SalesDocumentItem,
  SalesDocumentKind,
  SalesRow,
} from './useInventory';
import { SalesDocumentPaper } from './SalesDocumentPaper';

const ISSUER_STORAGE_KEY = 'sales-doc-issuer-info';
// 発注書の発注元 (PurchaseOrderModal)。発行元が未入力のときの初期値に使う (同じ自社情報のはずなので)
const PO_SENDER_STORAGE_KEY = 'po-sender-info';

// 発行元は在庫データではなく端末ごとの入力補助なので、発注書の発注元と同じく localStorage に置く。
// 読み書きに失敗しても書類自体は作れるべきなので無視する。
function loadIssuer(): SalesDocumentIssuer {
  try {
    const raw = localStorage.getItem(ISSUER_STORAGE_KEY);
    if (raw) return { ...EMPTY_SALES_DOCUMENT_ISSUER, ...JSON.parse(raw) };
    const po = localStorage.getItem(PO_SENDER_STORAGE_KEY);
    if (po) {
      const { name = '', address = '', phone = '', contact = '' } = JSON.parse(po);
      return { ...EMPTY_SALES_DOCUMENT_ISSUER, name, address, phone, contact };
    }
  } catch {
    // 無視
  }
  return EMPTY_SALES_DOCUMENT_ISSUER;
}

function saveIssuer(issuer: SalesDocumentIssuer) {
  try {
    localStorage.setItem(ISSUER_STORAGE_KEY, JSON.stringify(issuer));
  } catch {
    // 無視 (プライベートブラウズ等で書き込めない場合)
  }
}

/** その得意先のまだ指定種類の書類に載っていない売上のうち、いちばん新しい納品日 (なければ今日) */
function latestUnissuedDay(sales: SalesRow[], customerId: string, issued: Map<string, string>, today: string): string {
  let latest = '';
  for (const r of sales) {
    if (r.customerId !== customerId || issued.has(r.txnId)) continue;
    const day = localDateKey(r.date);
    if (day > latest) latest = day;
  }
  return latest || today;
}

interface Props {
  kind: SalesDocumentKind;
  sales: SalesRow[];
  customers: Customer[];
  items: SalesDocumentItem[];
  onIssue: (input: IssueSalesDocumentInput) => SalesDocument | null;
  onClose: () => void;
}

/**
 * 納品書・請求書の作成画面。得意先と納品日 (請求書は対象期間) を選ぶと、その売上が
 * 同じ日・商品・単価・税率ごとに1行へまとまった候補 (salesDocumentLines) が並び、
 * チェックした行だけが下の紙面プレビューに載る。プレビューは発行時と同じ
 * draftSalesDocument で組み立てるので、書類番号・金額・消費税は発行されるものと一致する。
 *
 * すでに同じ種類の書類に載っている売上は選べない (二重請求の防止)。発注書と同様、
 * 「発行して印刷」= 発行したものとして扱い、実際に印刷したかどうかは追わない。
 * 印刷 CSS は発注書と共通 (`.po-overlay` を付けて document.body に直接ポータルする)。
 */
export function SalesDocumentModal({ kind, sales, customers, items, onIssue, onClose }: Props) {
  const isInvoice = kind === '請求書';
  const [today] = useState(() => localDateKey(new Date().toISOString()));
  const issued = useMemo(() => issuedSalesDocumentNos(items, kind), [items, kind]);

  // 売上のある得意先を先に並べ、その先頭を初期値にする
  const customerOptions = useMemo(() => {
    const withSales = new Set(sales.map(r => r.customerId).filter(Boolean));
    return [...customers].sort((a, b) => Number(withSales.has(b.id)) - Number(withSales.has(a.id)));
  }, [customers, sales]);

  const [customerId, setCustomerId] = useState(() => customerOptions[0]?.id ?? '');
  const [deliveryDate, setDeliveryDate] = useState(() => latestUnissuedDay(sales, customerOptions[0]?.id ?? '', issued, today));
  const [period, setPeriod] = useState(() => previousMonthRange());
  const [dueDate, setDueDate] = useState(() => nextMonthEnd(previousMonthRange().to));
  const [issueDate, setIssueDate] = useState(today);
  const [issuer, setIssuer] = useState<SalesDocumentIssuer>(loadIssuer);
  // 書類から外した候補行の key。空 = 全部載せる (発注書と同じく既定は全選択)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');

  const customer = customers.find(c => c.id === customerId);
  const from = isInvoice ? period.from : deliveryDate;
  const to = isInvoice ? period.to : deliveryDate;

  const lines = useMemo(
    () => salesDocumentLines(sales, customerId, from, to, issued),
    [sales, customerId, from, to, issued],
  );
  const selectable = lines.filter(l => !l.issuedNo);
  const selected = selectable.filter(l => !excluded.has(l.key));
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  const input: IssueSalesDocumentInput = {
    kind,
    issueDate,
    customer: customer ?? { id: '', name: '', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true },
    periodFrom: from,
    periodTo: to,
    dueDate,
    issuer,
    lines: selected,
  };
  const validation = salesDocumentValidationError(input);
  const doc = draftSalesDocument(input, items);

  const setIssuerField = (key: keyof SalesDocumentIssuer, value: string) => {
    setIssuer(prev => {
      const next = { ...prev, [key]: value };
      saveIssuer(next);
      return next;
    });
  };

  const changeCustomer = (id: string) => {
    setCustomerId(id);
    setExcluded(new Set());
    if (!isInvoice) setDeliveryDate(latestUnissuedDay(sales, id, issued, today));
  };

  const toggle = (key: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAll = () => setExcluded(allSelected ? new Set(selectable.map(l => l.key)) : new Set());

  const handleIssue = () => {
    if (validation) return;
    const result = onIssue(input);
    if (!result) {
      setError('発行できませんでした。選んだ売上がすでに別の書類に載っていないか確認してください。');
      return;
    }
    window.print();
    onClose();
  };

  return createPortal(
    <div className="modal-overlay po-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel modal-po" onClick={e => e.stopPropagation()}>
        <h2 className="no-print">{kind}を作成</h2>

        <div className="modal-body">
          <div className="form-grid no-print">
            <label htmlFor="sd-customer">
              得意先
              <select id="sd-customer" value={customerId} onChange={e => changeCustomer(e.target.value)}>
                {customerOptions.length === 0 && <option value="">得意先がありません</option>}
                {customerOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.active ? '' : '（取引停止）'}</option>
                ))}
              </select>
            </label>
            {isInvoice ? (
              <>
                <label htmlFor="sd-from">
                  対象期間（開始）
                  <input id="sd-from" type="date" value={period.from} max={period.to || undefined}
                    onChange={e => { setPeriod(p => ({ ...p, from: e.target.value })); setExcluded(new Set()); }} />
                </label>
                <label htmlFor="sd-to">
                  対象期間（終了）
                  <input id="sd-to" type="date" value={period.to} min={period.from || undefined}
                    onChange={e => { setPeriod(p => ({ ...p, to: e.target.value })); setExcluded(new Set()); }} />
                </label>
                <label htmlFor="sd-due">
                  お支払期限
                  <input id="sd-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </label>
              </>
            ) : (
              <label htmlFor="sd-delivery">
                納品日
                <input id="sd-delivery" type="date" value={deliveryDate}
                  onChange={e => { setDeliveryDate(e.target.value); setExcluded(new Set()); }} />
              </label>
            )}
            <label htmlFor="sd-issue-date">
              発行日
              <input id="sd-issue-date" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </label>
          </div>

          <details className="sd-issuer no-print">
            <summary>発行元（自社）情報 <span className="label-hint">（この端末に保存されます）</span></summary>
            <div className="form-grid">
              <label htmlFor="sd-issuer-name">
                発行元名
                <input id="sd-issuer-name" value={issuer.name} onChange={e => setIssuerField('name', e.target.value)} />
              </label>
              <label htmlFor="sd-issuer-address">
                住所
                <input id="sd-issuer-address" value={issuer.address} onChange={e => setIssuerField('address', e.target.value)} />
              </label>
              <label htmlFor="sd-issuer-phone">
                電話番号
                <input id="sd-issuer-phone" value={issuer.phone} onChange={e => setIssuerField('phone', e.target.value)} />
              </label>
              <label htmlFor="sd-issuer-contact">
                担当者
                <input id="sd-issuer-contact" value={issuer.contact} onChange={e => setIssuerField('contact', e.target.value)} />
              </label>
              <label htmlFor="sd-issuer-reg">
                登録番号 <span className="label-hint">（T＋13桁・任意）</span>
                <input id="sd-issuer-reg" value={issuer.registrationNo} placeholder="T1234567890123"
                  onChange={e => setIssuerField('registrationNo', e.target.value)} />
              </label>
              <label htmlFor="sd-issuer-bank">
                振込先 <span className="label-hint">（請求書に記載）</span>
                <input id="sd-issuer-bank" value={issuer.bankAccount} placeholder="〇〇銀行 △△支店 普通 1234567"
                  onChange={e => setIssuerField('bankAccount', e.target.value)} />
              </label>
            </div>
          </details>

          <div className="fefo-plan no-print">
            <div className="fefo-plan-head">載せる売上（{selected.length} / {selectable.length}件）</div>
            {lines.length === 0 ? (
              <p className="empty">
                {isInvoice ? 'この期間に' : 'この日に'}この得意先の売上がありません。
                <span className="label-hint">（得意先を指定せずに登録した売上は書類にできません）</span>
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="po-check-col">
                      <input type="checkbox" checked={allSelected} disabled={selectable.length === 0} onChange={toggleAll} aria-label="すべて選択" />
                    </th>
                    <th>納品日</th>
                    <th>商品名</th>
                    <th style={{ textAlign: 'right' }}>数量</th>
                    <th style={{ textAlign: 'right' }}>単価</th>
                    <th style={{ textAlign: 'right' }}>金額</th>
                    <th>税率</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => {
                    const locked = !!l.issuedNo;
                    const checked = !locked && !excluded.has(l.key);
                    return (
                      <tr key={l.key} className={checked ? '' : 'po-row-excluded'}>
                        <td className="po-check-col">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggle(l.key)}
                            aria-label={locked
                              ? `${l.productName}（${l.deliveryDate}）は${kind} ${l.issuedNo} に記載済みのため選択できません`
                              : `${l.productName}（${l.deliveryDate}）を${kind}に載せる`}
                          />
                        </td>
                        <td className="mono">{l.deliveryDate}</td>
                        <td>
                          {l.productName}
                          {locked && <span className="label-hint"> 発行済み（{l.issuedNo}）</span>}
                          {l.estimatedPrice && <span className="label-hint" title="販売単価が記録されていないため、商品の販売定価で計算しています"> 定価で計算</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{l.quantity.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>¥{l.unitPrice.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>¥{l.amount.toLocaleString()}</td>
                        <td>{l.taxRate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <SalesDocumentPaper doc={doc} />
        </div>

        <div className="modal-actions no-print">
          {(error || validation) && <p className="field-error sd-error" role="alert">{error || validation}</p>}
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn-primary" disabled={!!validation} onClick={handleIssue}>発行して印刷</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
