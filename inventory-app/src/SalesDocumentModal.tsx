import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AS_NEEDED_CLOSING,
  balanceForward,
  billingPeriod,
  customerBillingTermsLabel,
  customerClosingDay,
  draftSalesDocument,
  issuedSalesDocumentNos,
  latestClosingDate,
  localDateKey,
  paymentDueDate,
  previousMonthRange,
  salesDocumentLines,
  salesDocumentValidationError,
} from './useInventory';
import { loadIssuer, saveIssuer } from './salesDocumentIssuer';
import type {
  Customer,
  IssueSalesDocumentInput,
  PaymentItem,
  SalesDocument,
  SalesDocumentIssuer,
  SalesDocumentItem,
  SalesDocumentKind,
  SalesRow,
} from './useInventory';
import { SalesDocumentPaper } from './SalesDocumentPaper';

/**
 * 請求書の対象期間とお支払期限の初期値。締め日のある得意先は today 以前で直近の締めの期間、
 * 都度請求の得意先 (と得意先未選択) は前月1日〜末日。お支払期限は得意先の支払条件から決める。
 */
function invoiceDefaults(customer: Customer | undefined, today: string): { period: { from: string; to: string }; dueDate: string } {
  const day = customer ? customerClosingDay(customer) : AS_NEEDED_CLOSING;
  const period = day === AS_NEEDED_CLOSING ? previousMonthRange() : billingPeriod(day, latestClosingDate(day, today));
  return { period, dueDate: paymentDueDate(customer ?? {}, period.to) };
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
  /** 入金。請求書の繰越 (前回御請求額・御入金額) の計算に使う (省略時は入金なし) */
  payments?: PaymentItem[];
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
export function SalesDocumentModal({ kind, sales, customers, items, payments = [], onIssue, onClose }: Props) {
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
  const [period, setPeriod] = useState(() => invoiceDefaults(customers.find(c => c.id === customerOptions[0]?.id), today).period);
  const [dueDate, setDueDate] = useState(() => invoiceDefaults(customers.find(c => c.id === customerOptions[0]?.id), today).dueDate);
  const [issueDate, setIssueDate] = useState(today);
  const [issuer, setIssuer] = useState<SalesDocumentIssuer>(loadIssuer);
  // 書類から外した候補行の key。空 = 全部載せる (発注書と同じく既定は全選択)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');

  const customer = customers.find(c => c.id === customerId);
  const from = isInvoice ? period.from : deliveryDate;
  const to = isInvoice ? period.to : deliveryDate;

  const lines = useMemo(
    // 返品は請求書でだけ差し引く (納品書は届けたものの書類なので返品を載せない)
    () => salesDocumentLines(sales, customerId, from, to, issued, { includeReturns: isInvoice }),
    [sales, customerId, from, to, issued, isInvoice],
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
    // 請求書は前回からの繰越を載せる (発行時に issueSalesDocument が計算し直す)
    ...(isInvoice && customer ? { balanceForward: balanceForward(customer.id, items, payments, issueDate) } : {}),
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
    else {
      const defaults = invoiceDefaults(customers.find(c => c.id === id), today);
      setPeriod(defaults.period);
      setDueDate(defaults.dueDate);
    }
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
              {isInvoice && customer && <span className="label-hint">{customerBillingTermsLabel(customer)}</span>}
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
                          {l.isReturn && <span className="return-badge">返品</span>}
                          {locked && <span className="label-hint"> 発行済み（{l.issuedNo}）</span>}
                          {l.estimatedPrice && <span className="label-hint" title="販売単価が記録されていないため、商品の販売定価で計算しています"> 定価で計算</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{l.quantity.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>¥{l.unitPrice.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{l.amount < 0 ? '-' : ''}¥{Math.abs(l.amount).toLocaleString()}</td>
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
