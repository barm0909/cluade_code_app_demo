# 納品書・請求書 機能

売上 (帳票の `売上出庫`) を得意先ごとにまとめて、納品書・請求書として印刷する機能。
発注書 (`PurchaseOrderModal`) / 発注履歴 (`PurchaseOrderHistoryView`) の販売側の対になっている。
画面仕様 (非プログラマ向け) は [spec/sales-document.md](spec/sales-document.md)。

## 構成

| ファイル | 役割 |
|----------|------|
| `src/SalesDocumentView.tsx` | 「納品書・請求書」タブ。作成ボタン、発行済み書類の一覧 (絞り込み・CSV)、再表示モーダル、取消 |
| `src/SalesDocumentModal.tsx` | 作成画面。得意先・納品日 (請求書は対象期間・支払期限)・発行日・発行元を入力し、候補行を選んで発行 |
| `src/SalesDocumentPaper.tsx` | 紙面。作成画面のプレビューと再表示の両方がこれを描く |
| `src/useInventory.ts` | 型・純粋関数・`issueSalesDocument` / `deleteSalesDocument` |
| `migrations/0014_sales_documents.sql` | `sales_document_items` テーブル |
| `worker/index.ts` | `GET /api/state` の `salesDocumentItems`、`PUT /api/sales-documents` |

タブは `売上管理` の右隣 (`App.tsx` の `activeTab === 'salesDocs'`)。

## データ

`SalesDocumentItem` = 発行した書類の明細1行。同じ `documentId` の行が1枚の書類で、得意先・発行元・期間などの
ヘッダ情報は各行にそのまま持たせる (`PurchaseOrderPrintItem` と同じ「1件1行・スナップショット」方針)。
マスタを後から変えても発行済みの書類は変わらない。

- `txnIds` … その行にまとめた帳票 (売上出庫) の id。D1 では `txn_ids` に JSON 配列の文字列で持つ
- `kind` … `納品書` / `請求書`。`dueDate` と `issuerBankAccount` は請求書だけが持つ (納品書は空文字)
- 状態は `useInventory` の `salesDocumentItems`。`resetToSample` で帳票と一緒に空にする (帳票の id を参照しているため)

**在庫は動かないので帳票 (ledger) には何も書かない。**

## 流れ

1. `salesRows(ledger, products, customers)` (売上管理と同じ関数。`App.tsx` の `sales`) を `SalesDocumentView` に渡す
2. `salesDocumentLines(sales, customerId, from, to, issued)` が候補行を作る
   - 得意先一致・納品日 (`localDateKey`) が期間内の売上だけ。得意先なしの売上は対象外
   - **同じ納品日・商品・単価・税率** をまとめて1行に (FEFO でロットごとに帳票が分かれるため)
   - `issued` (= `issuedSalesDocumentNos(items, kind)`) に含まれる売上は `issuedNo` 付きの別の行にし、未発行の売上と混ぜない
   - 単価・税率・推定フラグは `SalesRow` のものをそのまま使う (販売単価未記録 → 販売定価で代用、の規則を1か所に保つため)
3. モーダルはチェックした行で `IssueSalesDocumentInput` を作り、`draftSalesDocument(input, items)` で紙面プレビューを描く
4. 「発行して印刷」→ `issueSalesDocument(input)` → `window.print()`
   - `issueSalesDocument` は保存直前の `salesDocumentItems` で `issuedNo` を付け直してから `salesDocumentValidationError` で検証する
     (古い候補からの二重発行を防ぐ)。NG なら `null`
   - `buildSalesDocumentItems` で行を作って追記・保存。プレビューも同じ関数 (`documentId` だけ `preview`) なので、
     書類番号・金額はプレビューと一致する
5. 一覧は `salesDocuments(items, filter)` が `documentId` ごとにまとめる。「取消」は `deleteSalesDocument(documentId)`。
   入金を充てた請求書は取り消せない (`deleteSalesDocument` が `false` を返し、画面は `paidDocumentIds(payments)` で取消ボタンを disabled にする。
   [receivable-feature.md](receivable-feature.md))

## 消費税

`salesDocumentTotals` は **税率ごとに税抜金額を合計してから `taxAmount` (Math.round) で1回だけ丸める** (適格請求書の端数処理)。
`salesRows` / `salesTotals` は帳票1行ごとに丸めるので、同じ売上でも書類の消費税は数円ずれることがある。意図的。

## 書類番号

`nextSalesDocumentNo(kind, issueDate, items)` = `D`(納品書) / `I`(請求書) + `YYYYMMDD` + `-` + 3桁連番。
連番は同じ接頭辞・日付の既存番号の最大 + 1。取り消した最大番号は再利用されうる (spec に注意書きあり)。

## 発行元情報

自社名・住所・電話・担当者・登録番号 (`T` + 13桁、`isValidRegistrationNo`)・振込先。発注書の発注元と同じく
在庫データではないので `localStorage` (`sales-doc-issuer-info`) に置く。未保存なら発注書の `po-sender-info` から初期値を取る。

## 印刷

発注書と同じく `document.body` へポータルし、`.po-overlay` / `.po-print-area` の `@media print` ルール (App.css) で
紙面だけを印刷する。紙面固有のスタイルは `.sd-*`。

## やっていないこと

- 締め請求・繰越型の請求書は別機能: [billing-closing-feature.md](billing-closing-feature.md)。入金管理・消込: [receivable-feature.md](receivable-feature.md)
- 書類の部分修正 (取消して出し直す)
- 返品・値引き行 (売上にその概念がないため)

## テスト

- `src/test/salesDocument.test.ts` … 純粋関数と `issueSalesDocument` / `deleteSalesDocument`、API 保存・復元
- `src/test/SalesDocumentView.test.tsx` … 発行→一覧→二重発行の防止、行の除外、登録番号の検証、取消、再表示
