import { createPortal } from 'react-dom';
import { isValidJanCode } from './useInventory';
import type { Product } from './useInventory';
import { BarcodeSvg } from './BarcodeSvg';

interface Props {
  products: Product[];
  onClose: () => void;
}

/**
 * バーコード表 (商品マスタの「バーコード表」から開く)。JANコードを登録した商品のバーコードを並べて表示・印刷する。
 * スキャナーがなくても、この画面を PC に出してスマホのカメラで読めば読み取りを確かめられる。値札・棚札の印刷にも使える。
 * 印刷 CSS は発注書・請求書と共通 (`.po-overlay` / `.po-print-area`)。
 */
export function BarcodeSheetModal({ products, onClose }: Props) {
  const withJan = products
    .filter(p => p.janCode && isValidJanCode(p.janCode))
    .sort((a, b) => a.name.localeCompare(b.name));
  const missing = products.length - withJan.length;

  return createPortal(
    <div className="modal-overlay po-overlay" onClick={onClose}>
      <div className="modal modal-wide modal-panel modal-po" onClick={e => e.stopPropagation()}>
        <h2 className="no-print">バーコード表</h2>
        <div className="modal-body">
          <p className="fefo-note no-print">
            JANコードを登録した商品のバーコードです。印刷して値札・棚札に使ったり、画面に出したままスマホの「カメラで読む」で
            読み取りを試したりできます。
            {missing > 0 && `（JANコード未登録の商品 ${missing}件は載りません）`}
          </p>
          <div className="po-print-area barcode-sheet">
            {withJan.length === 0 ? (
              <p className="empty">JANコードを登録した商品がありません。商品マスタの編集でJANコードを登録してください。</p>
            ) : withJan.map(p => (
              <div key={p.id} className="barcode-card">
                <div className="barcode-card-name">{p.name}</div>
                <div className="barcode-card-sku mono">{p.sku}</div>
                <BarcodeSvg code={p.janCode!} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions no-print">
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn-primary" disabled={withJan.length === 0} onClick={() => window.print()}>印刷</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
