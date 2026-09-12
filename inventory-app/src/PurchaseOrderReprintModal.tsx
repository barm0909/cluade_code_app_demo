import { createPortal } from 'react-dom';
import type { PurchaseOrderPrintGroup } from './useInventory';
import { formatLedgerDateTime } from './useInventory';

interface Props {
  group: PurchaseOrderPrintGroup;
  onClose: () => void;
}

/**
 * 発注履歴タブから開く、過去に印刷した発注書をそのまま再表示・再印刷するための読み取り専用モーダル。
 * PurchaseOrderModal と違い、明細の追加もチェックボックスでの選択もできない
 * (履歴はスナップショットなので編集の余地がない)。ここでの「印刷」は同じ内容をもう一度出すだけで、
 * 新しい発注ではないため印刷履歴も増えず、入荷予定の printedAt にも影響しない。
 *
 * PurchaseOrderModal と同じく document.body に直接ポータルし、印刷 CSS も
 * 共通の `.po-overlay` / `.po-print-area` ルール (App.css) をそのまま使う。
 */
export function PurchaseOrderReprintModal({ group, onClose }: Props) {
  return createPortal(
    <div className="modal-overlay po-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel modal-po" onClick={e => e.stopPropagation()}>
        <h2 className="no-print">発注書（履歴） — {group.supplierName}</h2>

        <div className="modal-body">
          <p className="label-hint no-print">印刷日時：{formatLedgerDateTime(group.printedAt)}</p>

          <div className="po-print-area">
            <h1 className="po-title">発注書</h1>
            <div className="po-header">
              <div className="po-to">
                <div className="po-to-name">{group.supplierName} 御中</div>
                {group.supplierAddress && <div>{group.supplierAddress}</div>}
                {(group.supplierPhone || group.supplierContact) && (
                  <div>{group.supplierContact}{group.supplierContact && group.supplierPhone && ' '}{group.supplierPhone}</div>
                )}
              </div>
              <div className="po-from">
                <div>発注日：{group.orderDate}</div>
                {group.senderName && <div className="po-from-name">{group.senderName}</div>}
                {group.senderAddress && <div>{group.senderAddress}</div>}
                {(group.senderPhone || group.senderContact) && (
                  <div>{group.senderContact}{group.senderContact && group.senderPhone && ' '}{group.senderPhone}</div>
                )}
              </div>
            </div>

            <p className="po-lead">下記のとおり発注いたします。</p>

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
                {group.items.map(i => (
                  <tr key={i.id}>
                    <td>{i.productName}</td>
                    <td className="mono">{i.productSku}</td>
                    <td className="mono">{i.expectedDate}</td>
                    <td style={{ textAlign: 'right' }}>{i.quantity.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{i.unitPrice > 0 ? `¥${i.unitPrice.toLocaleString()}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{i.amount > 0 ? `¥${i.amount.toLocaleString()}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>合計</td>
                  <td style={{ textAlign: 'right' }}>{group.totalQuantity.toLocaleString()}</td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>¥{group.totalAmount.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="modal-actions no-print">
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>印刷</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
