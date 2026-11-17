# 返品 機能

売上返品 (得意先から戻ってきた商品) と仕入返品 (仕入先へ返す商品) を帳票に記録する機能。
画面仕様 (非プログラマ向け) は [spec/returns.md](spec/returns.md)。

## 帳票の区分

`TransactionType` に `売上返品` (入庫側) と `仕入返品` (出庫側) を追加した。

- `transactionDirection` は `売上返品` → `in`、`仕入返品` → `out`
- `INBOUND_TYPES` / `OUTBOUND_TYPES` / `outboundTypesFor` は **手で選べる区分** のリストなので、返品は入れていない
  (元取引にひもづける専用の画面からだけ記録する)。返品は `RETURN_TYPES`、全区分は `ALL_TRANSACTION_TYPES`
- `StockTransaction.returnOfTxnId` … 返品の元取引。売上返品は元の `売上出庫` (必須)、仕入返品は元の `入荷` (見つかったときだけ)
- D1: `migrations/0015_returns.sql` で `stock_transactions` を作り直して CHECK を広げ、`return_of_txn_id` 列を追加
  (SQLite は CHECK を ALTER できない。0012 と同じ手順)。`worker/index.ts` の読み書きも対応

## 売上返品

`planSalesReturn(products, ledger, input)` → `returnSale(input)`。`SalesReturnModal` のプレビューも同じ関数。

- 返品できる数量 = 元の売上数量 − `returnedQuantities(ledger)` の合計 (`returnableSaleQuantity`)。超えた分は丸める
- 戻すロット: 元の売上と同じ `lotNo`。戻し先倉庫に同じ `lotNo` + 倉庫 + 賞味期限のロットがあれば加算、なければ新規作成。
  賞味期限は同じ商品・同じ `lotNo` のロットから、なければ `lotNo` (YYYYMMDD) から復元
- ロットの原価: 元の売上の `costUnitPrice` (なければ商品の現在原価)。加算時は `mergedLotUnitPrice` で加重平均 (入荷と同じ)
- 帳票: `売上返品` を1件。元の売上の `unitPrice` / `customerId` / `costUnitPrice` / `taxRate` をそのまま写し、`toWarehouseId` = 戻し先
- 商品が削除されている売上は返品できない (戻すロットを作れないため)

### 集計への反映

- `salesRows` は `売上返品` を **マイナスの行** (`isReturn: true`、数量・金額・消費税・原価・粗利がマイナス) にする。
  合計・商品別/得意先別/日別の集計はそのまま足すだけで返品が差し引かれる。粗利率は元の売上と同じ値になる
- `salesTotals` に `returnCount` / `returnAmount` (税抜・プラス) を追加
- `customerUsage` は返品を件数・最終売上日に数えず、数量・金額・粗利だけ差し引く
- `taxAmount` は符号つきで丸める (絶対値を丸めて符号を戻す)。`Math.round(-2.5) = -2` のままだと、売上と返品で税額が1円ずれるため
- `salesDocumentLines` は返品を別キーのマイナス行にまとめる (`isReturn`)。`includeReturns: false` で除外でき、
  納品書はこれを使う (請求書だけが返品を差し引く)。紙面は数量がマイナスの行に「（返品）」を付ける
- `stockAnalysisRows` は期間内の売上返品を出庫数・売上数から差し引く (下限0)。最終出庫日は動かさない

## 仕入返品

`purchaseReturnDefaults(product, lot, ledger)` で初期値 (そのロットの `入荷` の仕入先と元取引、ロット原価) を出し、
`planPurchaseReturn(products, suppliers, input)` → `returnToSupplier(input)`。

- 数量はロットの在庫まで。仕入先は必須
- ロットの数量を減らす (0 になっても残す — ロット行の出庫・FEFO出庫と同じ)
- 帳票: `仕入返品` を1件。`fromWarehouseId` / `supplierId` / `unitPrice` (返品単価。0 なら持たない) / `returnOfTxnId` (元の入荷)
- `costHistoryRows` は `入荷` だけを見るので原価履歴には載らない
- `stockAnalysisRows` は仕入返品を出庫数にも最終出庫日にも数えない (需要ではない)

## やっていないこと

- 返品の取消 (帳票の訂正の仕組みがまだない)
- 受注の出荷済数量・入荷予定の入荷済数量を戻すこと
- 返品金額の入金・相殺管理

## テスト

- `src/test/returns.test.ts` … 区分、純粋関数、集計への反映、`returnSale` / `returnToSupplier`
- `src/test/SalesView.test.tsx` (売上返品の表示と入力)、`src/test/PurchaseReturnModal.test.tsx`
