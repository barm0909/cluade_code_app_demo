import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PurchaseOrderRow, PurchaseOrderTotals, Supplier } from './useInventory';

interface SenderInfo {
  name: string;
  address: string;
  phone: string;
  contact: string;
}

const EMPTY_SENDER: SenderInfo = { name: '', address: '', phone: '', contact: '' };
const SENDER_STORAGE_KEY = 'po-sender-info';

// 自社情報は在庫データではなく端末ごとの入力補助なので、DB ではなく localStorage に置く。
// 読み書きに失敗しても発注書自体は表示できるべきなので無視する。
function loadSenderInfo(): SenderInfo {
  try {
    const raw = localStorage.getItem(SENDER_STORAGE_KEY);
    return raw ? { ...EMPTY_SENDER, ...JSON.parse(raw) } : EMPTY_SENDER;
  } catch {
    return EMPTY_SENDER;
  }
}

function saveSenderInfo(info: SenderInfo) {
  try {
    localStorage.setItem(SENDER_STORAGE_KEY, JSON.stringify(info));
  } catch {
    // 無視 (プライベートブラウズ等で書き込めない場合)
  }
}

interface Props {
  supplier: Supplier;
  rows: PurchaseOrderRow[];
  totals: PurchaseOrderTotals;
  onClose: () => void;
}

/**
 * 仕入先マスタから開く発注書のプレビュー兼印刷画面。
 * ブラウザの印刷機能 (window.print) を使い、`.po-print-area` だけを印刷するよう
 * App.css の @media print で他の要素を隠す。PDF化はブラウザの「PDFに保存」を使う想定なので、
 * 専用ライブラリは追加しない。
 *
 * 他のモーダルと違い document.body に直接ポータルする。印刷時は #root ごと隠すので、
 * アプリ本体の中に留めると（非表示でも高さは残るため）印刷が無駄に複数ページに分かれてしまう。
 */
export function PurchaseOrderModal({ supplier, rows, totals, onClose }: Props) {
  const [sender, setSender] = useState<SenderInfo>(loadSenderInfo);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));

  const setSenderField = (key: keyof SenderInfo, value: string) => {
    setSender(prev => {
      const next = { ...prev, [key]: value };
      saveSenderInfo(next);
      return next;
    });
  };

  return createPortal(
    <div className="modal-overlay po-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel modal-po" onClick={e => e.stopPropagation()}>
        <h2 className="no-print">発注書 — {supplier.name}</h2>

        <div className="modal-body">
          <div className="form-grid no-print">
            <label htmlFor="po-date">
              発注日
              <input id="po-date" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </label>
            <label htmlFor="po-sender-name">
              発注元（自社）名 <span className="label-hint">（この端末に保存されます）</span>
              <input id="po-sender-name" value={sender.name} onChange={e => setSenderField('name', e.target.value)} />
            </label>
            <label htmlFor="po-sender-address">
              発注元 住所
              <input id="po-sender-address" value={sender.address} onChange={e => setSenderField('address', e.target.value)} />
            </label>
            <label htmlFor="po-sender-phone">
              発注元 電話番号
              <input id="po-sender-phone" value={sender.phone} onChange={e => setSenderField('phone', e.target.value)} />
            </label>
            <label htmlFor="po-sender-contact">
              発注元 担当者
              <input id="po-sender-contact" value={sender.contact} onChange={e => setSenderField('contact', e.target.value)} />
            </label>
          </div>

          <div className="po-print-area">
            <h1 className="po-title">発注書</h1>
            <div className="po-header">
              <div className="po-to">
                <div className="po-to-name">{supplier.name} 御中</div>
                {supplier.address && <div>{supplier.address}</div>}
                {(supplier.phone || supplier.contact) && (
                  <div>{supplier.contact}{supplier.contact && supplier.phone && ' '}{supplier.phone}</div>
                )}
              </div>
              <div className="po-from">
                <div>発注日：{orderDate}</div>
                {sender.name && <div className="po-from-name">{sender.name}</div>}
                {sender.address && <div>{sender.address}</div>}
                {(sender.phone || sender.contact) && (
                  <div>{sender.contact}{sender.contact && sender.phone && ' '}{sender.phone}</div>
                )}
              </div>
            </div>

            <p className="po-lead">下記のとおり発注いたします。</p>

            {rows.length === 0 ? (
              <p className="empty">発注が必要な入荷予定がありません。</p>
            ) : (
              <table className="po-table">
                <thead>
                  <tr>
                    <th>商品名</th>
                    <th>SKU</th>
                    <th>入荷予定日</th>
                    <th style={{ textAlign: 'right' }}>数量</th>
                    <th style={{ textAlign: 'right' }}>単価</th>
                    <th style={{ textAlign: 'right' }}>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.plan.id}>
                      <td>{r.productName}</td>
                      <td className="mono">{r.productSku}</td>
                      <td className="mono">{r.plan.expectedDate}</td>
                      <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{r.unitPrice > 0 ? `¥${r.unitPrice.toLocaleString()}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.amount > 0 ? `¥${r.amount.toLocaleString()}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>合計</td>
                    <td style={{ textAlign: 'right' }}>{totals.quantity.toLocaleString()}</td>
                    <td></td>
                    <td style={{ textAlign: 'right' }}>¥{totals.amount.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        <div className="modal-actions no-print">
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn-primary" disabled={rows.length === 0} onClick={() => window.print()}>印刷</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
