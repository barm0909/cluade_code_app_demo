import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_WAREHOUSE_ID, expectedDateFromLeadTime, purchaseOrderTotals } from './useInventory';
import type { InboundPlanInput, PrintPurchaseOrderInput, Product, PurchaseOrderRow, Supplier, Warehouse } from './useInventory';
import { NumberInput } from './NumberInput';

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
  products: Product[];
  warehouses: Warehouse[];
  onAddPlan: (data: InboundPlanInput) => void;
  onPrint: (input: PrintPurchaseOrderInput) => void;
  onClose: () => void;
}

/**
 * 仕入先マスタから開く発注書の作成・プレビュー・印刷画面。
 * 「明細を追加」で新しい入荷予定をその場で登録でき（ロットNo・賞味期限は発注時点では
 * 未定なので空のまま — 発注提案 (docs/reorder-feature.md) と同じ扱い）、rows は
 * 呼び出し側 (SupplierMasterView) が inboundPlans から都度組み直すので、追加した明細は
 * 即座にプレビューに反映される。すでにある未入荷・一部入荷の予定を印刷するだけの用途にも使える。
 *
 * rows はその仕入先の未入荷・一部入荷の予定を**全部**含む（前回すでに発注書を出した分も
 * 含めて毎回全部載る）ので、行ごとのチェックボックスで今回印刷する明細だけを選べるように
 * している。選択状態は「外した id の集合」として持つ（新しく増えた行や明細追加で作った行が
 * 自動的にチェック済みになるように — 何もしなければ全部選択されているのが基本）。
 *
 * 「印刷」を押すと、そのとき選択されている明細・仕入先・発注元情報を `onPrint`（＝
 * `printPurchaseOrder`）に渡してから `window.print()` を呼ぶ。呼び出し側は
 * (1) 対象の `plan.printedAt` を記録して次回チェックできなくし（二重発注の防止）、
 * (2) 印刷内容のスナップショットを発注履歴 (`purchaseOrderPrints`) に残す。
 * 実際に印刷ダイアログで印刷したか・キャンセルしたかまでは検知できないので、
 * 「印刷ボタンを押した = 発注書として出した」という簡略化した扱いにしている。
 *
 * ブラウザの印刷機能 (window.print) を使い、`.po-print-area` だけを印刷するよう
 * App.css の @media print で他の要素を隠す。PDF化はブラウザの「PDFに保存」を使う想定なので、
 * 専用ライブラリは追加しない。
 *
 * 他のモーダルと違い document.body に直接ポータルする。印刷時は #root ごと隠すので、
 * アプリ本体の中に留めると（非表示でも高さは残るため）印刷が無駄に複数ページに分かれてしまう。
 */
export function PurchaseOrderModal({ supplier, rows, products, warehouses, onAddPlan, onPrint, onClose }: Props) {
  const [sender, setSender] = useState<SenderInfo>(loadSenderInfo);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newLine, setNewLine] = useState(() => ({
    productId: products[0]?.id ?? '',
    quantity: 0,
    unitPrice: 0,
    expectedDate: expectedDateFromLeadTime(supplier),
    warehouseId: warehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID) ? DEFAULT_WAREHOUSE_ID : (warehouses[0]?.id ?? ''),
  }));
  // 印刷対象から外した行の plan.id。空 = 全部印刷対象 (デフォルト全選択)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());

  const setSenderField = (key: keyof SenderInfo, value: string) => {
    setSender(prev => {
      const next = { ...prev, [key]: value };
      saveSenderInfo(next);
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 発注書として印刷済みの明細はチェックできない (二重発注の防止)。「すべて選択」も
  // 印刷済み以外の行だけを対象にする
  const selectableRows = rows.filter(r => !r.plan.printedAt);
  const excludedInSelectable = selectableRows.filter(r => excludedIds.has(r.plan.id));
  const allSelected = selectableRows.length > 0 && excludedInSelectable.length === 0;
  const toggleAll = () => setExcludedIds(allSelected ? new Set(selectableRows.map(r => r.plan.id)) : new Set());

  const selectedRows = useMemo(
    () => rows.filter(r => !r.plan.printedAt && !excludedIds.has(r.plan.id)),
    [rows, excludedIds],
  );
  const totals = useMemo(() => purchaseOrderTotals(selectedRows), [selectedRows]);

  const canAddLine = newLine.productId !== '' && newLine.quantity > 0 && newLine.warehouseId !== '';

  const handleAddLine = () => {
    if (!canAddLine) return;
    onAddPlan({
      productId: newLine.productId,
      expectedDate: newLine.expectedDate,
      quantity: newLine.quantity,
      warehouseId: newLine.warehouseId,
      lotNo: '',
      supplierId: supplier.id,
      unitPrice: newLine.unitPrice,
      note: '',
    });
    setNewLine(l => ({ ...l, quantity: 0 })); // 商品・倉庫・単価・日付は続けて追加しやすいよう残す
  };

  const handlePrint = () => {
    if (selectedRows.length === 0) return;
    onPrint({ supplier, orderDate, sender, rows: selectedRows });
    window.print();
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

          {products.length > 0 && (
            <div className="fefo-plan no-print">
              <div className="fefo-plan-head">明細を追加</div>
              <div className="form-grid">
                <label htmlFor="po-new-product">
                  商品
                  <select id="po-new-product" value={newLine.productId} onChange={e => setNewLine(l => ({ ...l, productId: e.target.value }))}>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}（{p.sku}）</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="po-new-qty">
                  数量
                  <NumberInput id="po-new-qty" min={1} value={newLine.quantity} onValueChange={v => setNewLine(l => ({ ...l, quantity: v }))} />
                </label>
                <label htmlFor="po-new-warehouse">
                  入荷先倉庫
                  <select id="po-new-warehouse" value={newLine.warehouseId} onChange={e => setNewLine(l => ({ ...l, warehouseId: e.target.value }))}>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="po-new-date">
                  入荷予定日
                  <input id="po-new-date" type="date" value={newLine.expectedDate} onChange={e => setNewLine(l => ({ ...l, expectedDate: e.target.value }))} />
                </label>
                <label htmlFor="po-new-price">
                  仕入単価 (円) <span className="label-hint">（任意）</span>
                  <NumberInput id="po-new-price" min={0} value={newLine.unitPrice} onValueChange={v => setNewLine(l => ({ ...l, unitPrice: v }))} />
                </label>
              </div>
              <button type="button" className="btn-primary" style={{ marginTop: 10 }} disabled={!canAddLine} onClick={handleAddLine}>+ 明細を追加</button>
            </div>
          )}

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
                    <th className="po-check-col no-print">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="すべて選択" />
                    </th>
                    <th>商品名</th>
                    <th>SKU</th>
                    <th>入荷予定日</th>
                    <th style={{ textAlign: 'right' }}>数量</th>
                    <th style={{ textAlign: 'right' }}>単価</th>
                    <th style={{ textAlign: 'right' }}>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const locked = !!r.plan.printedAt;
                    const checked = !locked && !excludedIds.has(r.plan.id);
                    return (
                      <tr key={r.plan.id} className={checked ? '' : 'po-row-excluded no-print'}>
                        <td className="po-check-col no-print">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggleRow(r.plan.id)}
                            aria-label={locked
                              ? `${r.productName}（${r.plan.expectedDate}）はすでに発注書で印刷済みのため選択できません`
                              : `${r.productName}（${r.plan.expectedDate}）を印刷対象にする`}
                          />
                        </td>
                        <td>{r.productName}</td>
                        <td className="mono">{r.productSku}</td>
                        <td className="mono">
                          {r.plan.expectedDate}
                          {locked && <span className="label-hint"> 印刷済み（{r.plan.printedAt!.slice(0, 10)}）</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{r.unitPrice > 0 ? `¥${r.unitPrice.toLocaleString()}` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{r.amount > 0 ? `¥${r.amount.toLocaleString()}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="po-check-col no-print"></td>
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
          <button type="button" className="btn-primary" disabled={selectedRows.length === 0} onClick={handlePrint}>印刷</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
