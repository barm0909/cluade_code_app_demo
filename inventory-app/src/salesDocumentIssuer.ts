import { EMPTY_SALES_DOCUMENT_ISSUER } from './useInventory';
import type { SalesDocumentIssuer } from './useInventory';

// 納品書・請求書の作成画面 (SalesDocumentModal) と締め請求 (ClosingModal) で共有する発行元 (自社) 情報の保存。
// 発行元は在庫データではなく端末ごとの入力補助なので、発注書の発注元と同じく localStorage に置く。
// 読み書きに失敗しても書類自体は作れるべきなので無視する。

const ISSUER_STORAGE_KEY = 'sales-doc-issuer-info';
// 発注書の発注元 (PurchaseOrderModal)。発行元が未入力のときの初期値に使う (同じ自社情報のはずなので)
const PO_SENDER_STORAGE_KEY = 'po-sender-info';

export function loadIssuer(): SalesDocumentIssuer {
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

export function saveIssuer(issuer: SalesDocumentIssuer) {
  try {
    localStorage.setItem(ISSUER_STORAGE_KEY, JSON.stringify(issuer));
  } catch {
    // 無視 (プライベートブラウズ等で書き込めない場合)
  }
}
