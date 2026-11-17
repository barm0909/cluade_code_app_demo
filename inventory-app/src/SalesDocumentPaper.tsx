import { REDUCED_TAX_RATE } from './useInventory';
import type { SalesDocument } from './useInventory';

interface Props {
  doc: SalesDocument;
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

/**
 * 納品書・請求書の紙面。発行前のプレビュー (SalesDocumentModal) と、発行済みの再表示
 * (SalesDocumentView の再表示モーダル) の両方がこれを描くので、両者の見た目は食い違わない。
 * 印刷は発注書と同じ `.po-print-area` の印刷 CSS (App.css) を使う。
 *
 * 適格請求書の記載事項に合わせ、税率ごとの対象金額と消費税額、軽減税率の対象品目 (※)、
 * 発行元の登録番号を載せる。
 */
export function SalesDocumentPaper({ doc }: Props) {
  const isInvoice = doc.kind === '請求書';
  const { totals, issuer } = doc;
  const hasReduced = doc.items.some(i => i.taxRate === REDUCED_TAX_RATE);

  return (
    <div className="po-print-area sd-paper">
      <h1 className="po-title">{doc.kind}</h1>
      <div className="po-header">
        <div className="po-to">
          <div className="po-to-name">{doc.customerName || '（得意先未選択）'} 御中</div>
          {doc.customerAddress && <div>{doc.customerAddress}</div>}
          {doc.customerContact && <div>{doc.customerContact} 様</div>}
        </div>
        <div className="po-from">
          <div>No. {doc.documentNo}</div>
          <div>発行日：{doc.issueDate}</div>
          {issuer.name && <div className="po-from-name">{issuer.name}</div>}
          {issuer.address && <div>{issuer.address}</div>}
          {(issuer.phone || issuer.contact) && (
            <div>{issuer.contact}{issuer.contact && issuer.phone && ' '}{issuer.phone}</div>
          )}
          {issuer.registrationNo && <div>登録番号：{issuer.registrationNo}</div>}
        </div>
      </div>

      <p className="po-lead">
        {isInvoice ? '下記のとおりご請求申し上げます。' : '下記のとおり納品いたしました。'}
      </p>

      <div className="sd-summary">
        <div className="sd-summary-main">
          <span>{isInvoice ? 'ご請求金額（税込）' : '合計金額（税込）'}</span>
          <strong>{yen(totals.amountWithTax)}</strong>
        </div>
        <div className="sd-summary-sub">
          {isInvoice ? (
            <>
              <span>対象期間：{doc.periodFrom} 〜 {doc.periodTo}</span>
              {doc.dueDate && <span>お支払期限：{doc.dueDate}</span>}
            </>
          ) : (
            <span>納品日：{doc.periodFrom === doc.periodTo ? doc.periodFrom : `${doc.periodFrom} 〜 ${doc.periodTo}`}</span>
          )}
        </div>
      </div>

      <table className="po-table">
        <thead>
          <tr>
            {isInvoice && <th>納品日</th>}
            <th>商品名</th>
            <th>SKU</th>
            <th style={{ textAlign: 'right' }}>数量</th>
            <th style={{ textAlign: 'right' }}>単価</th>
            <th style={{ textAlign: 'right' }}>金額</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.length === 0 ? (
            <tr><td colSpan={isInvoice ? 6 : 5} className="empty">明細がありません。</td></tr>
          ) : doc.items.map(i => (
            <tr key={i.id}>
              {isInvoice && <td className="mono">{i.deliveryDate}</td>}
              <td>{i.productName}{i.taxRate === REDUCED_TAX_RATE && ' ※'}</td>
              <td className="mono">{i.productSku}</td>
              <td style={{ textAlign: 'right' }}>{i.quantity.toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>{yen(i.unitPrice)}</td>
              <td style={{ textAlign: 'right' }}>{yen(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="sd-totals">
        <tbody>
          <tr><th>小計（税抜）</th><td>{yen(totals.amount)}</td></tr>
          {totals.byTaxRate.map(b => (
            <tr key={b.taxRate}>
              <th>{b.taxRate}%対象{b.taxRate === REDUCED_TAX_RATE ? '（軽減税率）' : ''}</th>
              <td>{yen(b.amount)}（消費税 {yen(b.tax)}）</td>
            </tr>
          ))}
          <tr><th>消費税</th><td>{yen(totals.tax)}</td></tr>
          <tr className="sd-totals-grand"><th>合計（税込）</th><td>{yen(totals.amountWithTax)}</td></tr>
        </tbody>
      </table>

      {hasReduced && <p className="sd-note">※は軽減税率（8%）対象品目です。</p>}
      {isInvoice && issuer.bankAccount && (
        <div className="sd-bank">
          <div className="sd-bank-head">お振込先</div>
          <div>{issuer.bankAccount}</div>
        </div>
      )}
    </div>
  );
}
