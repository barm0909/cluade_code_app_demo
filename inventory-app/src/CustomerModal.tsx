import { useState } from 'react';
import type { ClosingDay, Customer, CustomerInput, PaymentDay, PaymentMonths } from './useInventory';
import {
  CLOSING_DAYS,
  EMPTY_CUSTOMER,
  END_OF_MONTH,
  PAYMENT_DAYS,
  closingDayLabel,
  customerClosingDay,
  customerPaymentDay,
  customerPaymentMonths,
  customerValidationError,
} from './useInventory';

interface Props {
  customer: Customer | null; // null = 新規登録
  customers: Customer[]; // 名前・コードの重複チェック用 (マスタ全件)
  onSave: (data: CustomerInput) => void;
  onClose: () => void;
}

const toForm = (c: Customer): CustomerInput => ({
  name: c.name, code: c.code, contact: c.contact, phone: c.phone, email: c.email,
  address: c.address, note: c.note, active: c.active,
  closingDay: customerClosingDay(c), paymentMonths: customerPaymentMonths(c), paymentDay: customerPaymentDay(c),
});

const MONTH_LABELS: Record<PaymentMonths, string> = { 0: '当月', 1: '翌月', 2: '翌々月' };

/**
 * 得意先の登録・編集フォーム。項目が多いので仕入先と同じくモーダル + 2列レイアウトに揃えている。
 *
 * 入力チェックは customerValidationError に任せる。addCustomer / updateCustomer も
 * 同じ関数で弾くので、「エラーは出ないのに保存されない」ということが起こらない。
 */
export function CustomerModal({ customer, customers, onSave, onClose }: Props) {
  // 開くたびにマウントされる (CustomerMasterView が key を付けて出し分ける) ので、初期値は最初の描画で一度だけ作る
  const [form, setForm] = useState<CustomerInput>(() => customer ? toForm(customer) : EMPTY_CUSTOMER);
  const [error, setError] = useState('');

  const set = <K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = customerValidationError(form, customers, customer?.id);
    if (message) { setError(message); return; }
    onSave(form);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>{customer ? '得意先を編集' : '得意先を追加'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label htmlFor="cus-name">
                得意先名
                {/* 必須チェックはブラウザ標準ではなく customerValidationError に任せる
                    (重複エラーと同じ場所・同じ日本語で出すため) */}
                <input id="cus-name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例: みどりストア" />
              </label>
              <label htmlFor="cus-code">
                得意先コード <span className="label-hint">（任意）</span>
                <input id="cus-code" value={form.code} onChange={e => set('code', e.target.value)} placeholder="例: C-001" />
              </label>
              <label htmlFor="cus-contact">
                担当者 <span className="label-hint">（任意）</span>
                <input id="cus-contact" value={form.contact} onChange={e => set('contact', e.target.value)} />
              </label>
              <label htmlFor="cus-phone">
                電話番号 <span className="label-hint">（任意）</span>
                <input id="cus-phone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="例: 03-2222-3333" />
              </label>
              <label className="form-span-2" htmlFor="cus-email">
                メールアドレス <span className="label-hint">（任意）</span>
                <input id="cus-email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="例: order@example.jp" />
              </label>
              <label className="form-span-2" htmlFor="cus-address">
                住所 <span className="label-hint">（任意）</span>
                <input id="cus-address" value={form.address} onChange={e => set('address', e.target.value)} />
              </label>
              <label htmlFor="cus-closing">
                締め日
                <select id="cus-closing" value={customerClosingDay(form)} onChange={e => set('closingDay', Number(e.target.value) as ClosingDay)}>
                  {CLOSING_DAYS.map(d => <option key={d} value={d}>{closingDayLabel(d)}</option>)}
                </select>
              </label>
              <div className="form-pair">
                <label htmlFor="cus-pay-month">
                  お支払期限
                  <select id="cus-pay-month" value={customerPaymentMonths(form)} onChange={e => set('paymentMonths', Number(e.target.value) as PaymentMonths)}>
                    {([0, 1, 2] as PaymentMonths[]).map(m => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
                  </select>
                </label>
                <label htmlFor="cus-pay-day">
                  <span className="label-hint">日</span>
                  <select id="cus-pay-day" aria-label="お支払期限の日" value={customerPaymentDay(form)} onChange={e => set('paymentDay', Number(e.target.value) as PaymentDay)}>
                    {PAYMENT_DAYS.map(d => <option key={d} value={d}>{d === END_OF_MONTH ? '末日' : `${d}日`}</option>)}
                  </select>
                </label>
              </div>
              <label htmlFor="cus-active">
                取引状態
                <select id="cus-active" value={form.active ? 'active' : 'inactive'} onChange={e => set('active', e.target.value === 'active')}>
                  <option value="active">取引中</option>
                  <option value="inactive">取引停止</option>
                </select>
              </label>
              <label className="form-span-2" htmlFor="cus-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="cus-note" value={form.note} onChange={e => set('note', e.target.value)} />
              </label>
            </div>
            <p className="fefo-note">
              取引停止にすると、売上登録の得意先の選択肢から外れます（過去の売上の記録は残ります）。
              締め日を「都度請求」にすると締め請求の対象から外れ、請求書は1枚ずつ作ります。
              お支払期限は締め日（都度請求は請求の対象期間の末日）から数えます。
            </p>
            {error && <span className="field-error" role="alert">{error}</span>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
