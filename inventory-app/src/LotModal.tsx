import { useState, useEffect } from 'react';
import type { Lot } from './useInventory';
import { generateLotNo } from './useInventory';

interface Props {
  lot: Lot | null;
  onSave: (data: Omit<Lot, 'id'>) => void;
  onClose: () => void;
}

const EMPTY = { lotNo: '', expiryDate: '', quantity: 0 };
const LOT_PATTERN = /^\d{8}$/;

export function LotModal({ lot, onSave, onClose }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [lotError, setLotError] = useState('');

  useEffect(() => {
    setForm(lot ? { lotNo: lot.lotNo, expiryDate: lot.expiryDate ?? '', quantity: lot.quantity } : EMPTY);
    setLotError('');
  }, [lot]);

  const handleExpiryChange = (val: string) => {
    setForm(f => ({
      ...f,
      expiryDate: val,
      lotNo: f.lotNo === '' || f.lotNo === generateLotNo(f.expiryDate || undefined)
        ? generateLotNo(val || undefined)
        : f.lotNo,
    }));
    setLotError('');
  };

  const handleLotNoChange = (val: string) => {
    // 半角数字のみ入力可、8桁まで
    const digits = val.replace(/[^\d]/g, '').slice(0, 8);
    setForm(f => ({ ...f, lotNo: digits }));
    setLotError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!LOT_PATTERN.test(form.lotNo)) {
      setLotError('半角数字8桁で入力してください');
      return;
    }
    const { expiryDate, ...rest } = form;
    onSave({ ...rest, ...(expiryDate ? { expiryDate } : {}) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{lot ? 'ロットを編集' : 'ロットを追加'}</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="lot-expiry">
            賞味期限 <span className="label-hint">（任意 — 入力するとロットNoを自動生成）</span>
            <input id="lot-expiry" type="date" value={form.expiryDate} onChange={e => handleExpiryChange(e.target.value)} />
          </label>
          <label htmlFor="lot-no">
            ロットNo <span className="label-hint">（半角数字8桁）</span>
            <input
              id="lot-no"
              required
              value={form.lotNo}
              onChange={e => handleLotNoChange(e.target.value)}
              placeholder="例: 20261231"
              inputMode="numeric"
              maxLength={8}
            />
            {lotError && <span className="field-error">{lotError}</span>}
          </label>
          <label htmlFor="lot-qty">在庫数 <input id="lot-qty" type="number" min={0} required value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: +e.target.value }))} /></label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
