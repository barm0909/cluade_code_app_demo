import { useState, useEffect } from 'react';
import type { Supplier, SupplierInput } from './useInventory';
import { EMPTY_SUPPLIER, supplierValidationError } from './useInventory';
import { NumberInput } from './NumberInput';

interface Props {
  supplier: Supplier | null; // null = 新規登録
  suppliers: Supplier[]; // 名前・コードの重複チェック用 (マスタ全件)
  onSave: (data: SupplierInput) => void;
  onClose: () => void;
}

const toForm = (s: Supplier): SupplierInput => ({
  name: s.name, code: s.code, contact: s.contact, phone: s.phone, email: s.email,
  address: s.address, leadTimeDays: s.leadTimeDays, note: s.note, active: s.active,
});

/**
 * 仕入先の登録・編集フォーム。項目が多いので他のマスタ (カテゴリ・倉庫) のような
 * インライン編集ではなくモーダルにし、入荷予定モーダルと同じ2列レイアウトに揃えている。
 *
 * 入力チェックは supplierValidationError に任せる。addSupplier / updateSupplier も
 * 同じ関数で弾くので、「エラーは出ないのに保存されない」ということが起こらない。
 */
export function SupplierModal({ supplier, suppliers, onSave, onClose }: Props) {
  const [form, setForm] = useState<SupplierInput>(() => supplier ? toForm(supplier) : EMPTY_SUPPLIER);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(supplier ? toForm(supplier) : EMPTY_SUPPLIER);
    setError('');
  }, [supplier]);

  const set = <K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = supplierValidationError(form, suppliers, supplier?.id);
    if (message) { setError(message); return; }
    onSave(form);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel" onClick={e => e.stopPropagation()}>
        <h2>{supplier ? '仕入先を編集' : '仕入先を追加'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <label htmlFor="sup-name">
                仕入先名
                {/* 必須チェックはブラウザ標準ではなく supplierValidationError に任せる
                    (重複エラーと同じ場所・同じ日本語で出すため) */}
                <input id="sup-name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例: 山田乳業" />
              </label>
              <label htmlFor="sup-code">
                仕入先コード <span className="label-hint">（任意）</span>
                <input id="sup-code" value={form.code} onChange={e => set('code', e.target.value)} placeholder="例: S-001" />
              </label>
              <label htmlFor="sup-contact">
                担当者 <span className="label-hint">（任意）</span>
                <input id="sup-contact" value={form.contact} onChange={e => set('contact', e.target.value)} />
              </label>
              <label htmlFor="sup-phone">
                電話番号 <span className="label-hint">（任意）</span>
                <input id="sup-phone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="例: 03-1234-5678" />
              </label>
              <label className="form-span-2" htmlFor="sup-email">
                メールアドレス <span className="label-hint">（任意）</span>
                <input id="sup-email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="例: order@example.jp" />
              </label>
              <label className="form-span-2" htmlFor="sup-address">
                住所 <span className="label-hint">（任意）</span>
                <input id="sup-address" value={form.address} onChange={e => set('address', e.target.value)} />
              </label>
              <label htmlFor="sup-lead-time">
                標準リードタイム <span className="label-hint">（日）</span>
                <NumberInput id="sup-lead-time" min={0} value={form.leadTimeDays} onValueChange={v => set('leadTimeDays', v)} />
              </label>
              <label htmlFor="sup-active">
                取引状態
                <select id="sup-active" value={form.active ? 'active' : 'inactive'} onChange={e => set('active', e.target.value === 'active')}>
                  <option value="active">取引中</option>
                  <option value="inactive">取引停止</option>
                </select>
              </label>
              <label className="form-span-2" htmlFor="sup-note">
                備考 <span className="label-hint">（任意）</span>
                <input id="sup-note" value={form.note} onChange={e => set('note', e.target.value)} />
              </label>
            </div>
            <p className="fefo-note">
              標準リードタイムは、入荷予定でこの仕入先を選んだときの入荷予定日（今日＋日数）の初期値になります。
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
