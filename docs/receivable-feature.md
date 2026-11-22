# 入金管理・売掛金 機能

発行した請求書 (`salesDocumentItems` の `kind === '請求書'`) に入金を充てて (消込)、請求書ごとの残高・期限超過と
得意先ごとの売掛金残高を出す機能。納品書・請求書 ([sales-document-feature.md](sales-document-feature.md)) の続き。
画面仕様 (非プログラマ向け) は [spec/receivables.md](spec/receivables.md)。

## 構成

| ファイル | 役割 |
|----------|------|
| `src/ReceivableView.tsx` | 「入金管理」タブ。サマリカード、請求書別 / 得意先別 / 入金履歴の切り替え、絞り込み・CSV、入金の削除 |
| `src/PaymentModal.tsx` | 入金登録。得意先・入金日・入金額・振込手数料・方法・備考と、充てる請求書の選択 + 消込プレビュー |
| `src/useInventory.ts` | 型・純粋関数・`recordPayment` / `deletePayment`、`deleteSalesDocument` / `deleteCustomer` のガード |
| `migrations/0016_payments.sql` | `payment_items` テーブル |
| `worker/index.ts` | `GET /api/state` の `paymentItems`、`POST /api/changes` の `payments` |
| `src/DashboardView.tsx` | 「期限超過の売掛金」カードと「未回収アラート」 (props `salesDocumentItems` / `payments`、省略可) |

タブは `納品書・請求書` の右隣 (`App.tsx` の `activeTab === 'receivables'`)。

## データ

`PaymentItem` = 入金の明細1行。**1回の入金 (振込1回) を `receiptId` でまとめ、充てた請求書ごとに1行** に分ける
(`SalesDocumentItem` の `documentId` と同じ「1件1行」方針)。

- `documentId` … 消込先の請求書。`''` は未消込 (前受・過入金)
- `documentNo` … 表示用のスナップショット (請求書を取り消せないので実質変わらないが、検索・CSV のために持つ)
- `amount` + `fee` … その行で請求書を消し込んだ額。`fee` は振込手数料 (先方が差し引いた額)
- `customerId` … 得意先マスタの id (名前は表示時に引く。入金のある得意先は削除できないので切れない)

**保存しないもの**: 請求書の状況 (`未入金`/`一部入金`/`入金済`)、残高、期限超過日数、売掛金残高。
すべて `salesDocumentItems` と `paymentItems` (と `salesRows`) から毎回計算する (入荷予定・受注の状態と同じ)。

**在庫は動かないので帳票 (ledger) には何も書かない。** `resetToSample` で請求書と一緒に空にする。

## 純粋関数

| 関数 | 役割 |
|------|------|
| `receivableRows(items, payments, today?)` | 請求書ごとの `billed` (= `salesDocumentTotals().amountWithTax`) / `paid` / `remaining` / `status` / `overdueDays`。並びはお支払期限 → 発行日 → 番号 (期限なしは最後) |
| `invoicePaymentStatus(billed, paid)` | `billed <= 0` (返品だけの請求書) は入金済 |
| `filterReceivables(rows, filter)` | 既定 `DEFAULT_RECEIVABLE_FILTER` は `status: '未回収'` (未入金 + 一部入金) |
| `customerReceivables(rows, sales, items, payments, customers)` | 得意先ごとの請求残高・期限超過・未請求売上・未消込入金・`balance` |
| `receivableTotals(rows, customerRows, payments, today?)` | サマリカード。`receivedThisMonth` は手数料を含めない |
| `planPayment(rows, input)` | 消込計画。選んだ請求書の残高へ `rows` の並び (期限の早い順) に充て、残りは未消込。手数料は先頭の割当から順に配る |
| `buildPaymentItems(plan, input, receiptId, createdAt)` | 保存する行。未消込があれば `documentId: ''` の行を最後に足す |
| `paymentReceipts(payments, customers, filter?)` | `receiptId` ごとにまとめた入金履歴 |
| `paymentValidationError(input)` | 得意先・入金日必須、入金額は1以上の整数、手数料は0以上の整数 |
| `paidDocumentIds(payments)` | 取消できない請求書 (`SalesDocumentView` の取消ボタン) |
| `receivableCsv` / `customerReceivableCsv` / `paymentCsv` | CSV (`CSV_EXPORTS` の `receivable` / `customerReceivable` / `payment`) |

`PaymentModal` のプレビューと `recordPayment` は同じ `planPayment` を使う。`recordPayment` は保存直前の
`salesDocumentItems` / `paymentItems` から `receivableRows` を作り直して計画し直すので、古いモーダルから
二重に登録しても請求額を超えて消し込まない (超えた分は未消込になる)。

## 決めごと

- **未請求売上**は `salesRows` の `amountWithTax` (帳票1行ごとの端数処理) の合計。請求書は税率ごとに1回の端数処理なので、
  請求後の請求額とは数円ずれうる。得意先なしの売上は含めない。請求済みかは `issuedSalesDocumentNos(items, '請求書')`
- **期限超過**は `dueDate < today` かつ残高 > 0。`today` は端末のローカル日付 (`todayKey()`)
- 請求額を超える消込は作らない (過入金は未消込行)。未消込を後から請求書に充てる操作は無い (削除して登録し直す)
- **入金のある請求書は取消できない**: `deleteSalesDocument` が `false` を返す (戻り値を `boolean` にした)。
  取消すと消込先が宙に浮くため。画面では取消ボタンを disabled にする
- **入金のある得意先は削除できない**: `deleteCustomer` のガードに追加、`CustomerMasterView` に `payments` prop
- 返品 (`売上返品`) は請求書のマイナス行として請求額に入るので、入金管理側は特別扱いしない

## やっていないこと

- 入金の編集 (削除して登録し直す)、未消込の後からの充当
- 1回の入金で複数得意先の消込
- 前回請求額・繰越・入金額を載せる請求書形式、請求の締め処理
- 買掛金・支払管理 (仕入側)

## テスト

- `src/test/receivable.test.ts` … 純粋関数、`recordPayment` / `deletePayment`、取消・得意先削除のガード、リセット、API 保存・復元
- `src/test/ReceivableView.test.tsx` … 集計表示、行からの入金登録 → 状況の変化、未消込の表示、入金履歴からの削除、得意先別
- `src/test/SalesDocumentView.test.tsx` … 入金を充てた請求書の取消ボタンが押せない
- `src/test/DashboardView.test.tsx` … 未回収アラート
