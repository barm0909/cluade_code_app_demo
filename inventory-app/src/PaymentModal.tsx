import { useMemo, useState } from 'react';
import { PAYMENT_METHODS, planPayment, todayKey } from './useInventory';
import type { Customer, PaymentInput, PaymentMethod, PaymentPlan, ReceivableRow } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  /** 全請求書の入金状況 (receivableRows)。選んだ得意先の残高のある請求書だけを候補に出す */
  receivables: ReceivableRow[];
  customers: Customer[];
  /** 開いたときに選んでおく得意先 (請求書・得意先の行の「入金登録」から) */
  initialCustomerId?: string;
  /** 開いたときにチェックしておく請求書。省略時はその得意先の残高のある請求書すべて */
  initialDocumentIds?: string[];
  onSubmit: (input: PaymentInput) => PaymentPlan | null;
  onClose: () => void;
}

const yen = (v: number) => `${v < 0 ? '-' : ''}¥${Math.abs(Math.round(v)).toLocaleString()}`;

/**
 * 入金登録。得意先・入金日・入金額 (+ 振込手数料) を入れ、充てる請求書を選ぶと、
 * お支払期限の早い順にどの請求書へいくら充てるか (消込) をプレビューする。
 * 充てきれない分は未消込 (前受・過入金) として残る。
 * プレビューは recordPayment と同じ planPayment で組み立てるので、表示と保存は食い違わない。
 */
export function PaymentModal({ receivables, customers, initialCustomerId = '', initialDocumentIds, onSubmit, onClose }: Props) {
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [method, setMethod] = useState<PaymentMethod>('振込');
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0);
  const [note, setNote] = useState('');
  // チェックを外した請求書。得意先を切り替えたときに新しい候補が既定でチェック済みになるよう「除外」で持つ
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (!initialDocumentIds) return new Set();
    const keep = new Set(initialDocumentIds);
    return new Set(receivables.filter(r => !keep.has(r.documentId)).map(r => r.documentId));
  });

  const open = useMemo(
    () => receivables.filter(r => r.customerId === customerId && r.remaining > 0),
    [receivables, customerId],
  );
  const documentIds = open.filter(r => !excluded.has(r.documentId)).map(r => r.documentId);
  const selectedRemaining = open.filter(r => !excluded.has(r.documentId)).reduce((s, r) => s + r.remaining, 0);

  const input: PaymentInput = { customerId, paymentDate, method, amount, fee, documentIds, note };
  const plan = planPayment(receivables, input);
  const appliedById = new Map(plan.allocations.map(a => [a.documentId, a]));
  const unapplied = plan.unappliedAmount + plan.unappliedFee;

  // 取引停止の得意先でも、残高があれば入金は受ける (選択肢から外さない)
  const customerOptions = customers.filter(c =>
    c.active || c.id === customerId || receivables.some(r => r.customerId === c.id && r.remaining > 0));

  const toggle = (documentId: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(documentId)) next.delete(documentId); else next.add(documentId);
    return next;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (plan.error) return;
    if (onSubmit(input)) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>入金を登録</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label htmlFor="payment-customer">
                得意先
                <select id="payment-customer" value={customerId} onChange={e => setCustomerId(e.target.value)} required>
                  <option value="">選択してください</option>
                  {customerOptions.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : '（取引停止）'}</option>)}
                </select>
              </label>
              <label htmlFor="payment-date">
                入金日
                <input id="payment-date" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required />
              </label>
              <label htmlFor="payment-amount">
                入金額
                <NumberInput id="payment-amount" min={1} step={1} value={amount} onValueChange={setAmount} required />
              </label>
              <label htmlFor="payment-fee">
                振込手数料 <span className="label-hint">（差し引かれた額）</span>
                <NumberInput id="payment-fee" min={0} step={1} value={fee} onValueChange={setFee} />
              </label>
              <label htmlFor="payment-method">
                入金方法
                <select id="payment-method" value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label htmlFor="payment-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="payment-note" value={note} onChange={e => setNote(e.target.value)} placeholder="例: 11月分" />
              </label>
            </div>

            <div className="fefo-plan" aria-label="消込プレビュー">
              <div className="fefo-plan-head">
                充てる請求書（お支払期限の早い順に充てます）
                {selectedRemaining > 0 && (
                  <button
                    type="button"
                    className="btn-ghost-light payment-fill"
                    onClick={() => setAmount(Math.max(0, selectedRemaining - fee))}
                  >選んだ請求書の残高 {yen(selectedRemaining)} を入金額に入れる</button>
                )}
              </div>
              {!customerId ? (
                <p className="lot-empty">得意先を選んでください。</p>
              ) : open.length === 0 ? (
                <p className="lot-empty">この得意先に未回収の請求書はありません。入金はすべて未消込（前受）として残ります。</p>
              ) : (
                <table className="lot-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>請求書番号</th>
                      <th>お支払期限</th>
                      <th style={{ textAlign: 'right' }}>残高</th>
                      <th style={{ textAlign: 'right' }}>今回の消込</th>
                      <th style={{ textAlign: 'right' }}>消込後の残高</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map(r => {
                      const a = appliedById.get(r.documentId);
                      const checked = !excluded.has(r.documentId);
                      return (
                        <tr key={r.documentId}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${r.documentNo} に充てる`}
                              checked={checked}
                              onChange={() => toggle(r.documentId)}
                            />
                          </td>
                          <td className="mono">{r.documentNo}</td>
                          <td className="mono">
                            {r.dueDate || '—'}
                            {r.overdueDays > 0 && <span className="inbound-overdue">{r.overdueDays}日超過</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>{yen(r.remaining)}</td>
                          <td style={{ textAlign: 'right' }}>{a ? yen(a.applied) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{yen(a ? a.remainingAfter : r.remaining)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {!plan.error && (
                <p className="fefo-note">
                  消込 {yen(plan.total - unapplied)}（入金 {yen(amount)} + 手数料 {yen(fee)}）
                  {unapplied > 0 && <> ／ <strong className="qty-out">未消込 {yen(unapplied)}</strong>（前受・過入金として残します）</>}
                </p>
              )}
            </div>
            {plan.error && customerId && amount > 0 && <p className="field-error">{plan.error}</p>}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary" disabled={!!plan.error}>登録する</button>
          </div>
        </form>
      </div>
    </div>
  );
}
