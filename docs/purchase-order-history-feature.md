# 発注書の印刷履歴・再表示機能

発注書として印刷した内容をスナップショットとして保存し、あとから**同じ内容をそのまま再表示・
再印刷できる**読み取り専用の **発注履歴タブ** を追加した機能です（[purchase-order-history.md](spec/purchase-order-history.md)）。

これまで発注書（`PurchaseOrderModal.tsx`）は「その場で印刷する」だけの画面で、印刷した内容を
アプリ側では一切記録していませんでした。ブラウザの印刷ダイアログで「PDFに保存」を選べば
手元にファイルは残りますが、保存し忘れた場合や別の端末で確認したい場合に、アプリの中から
「あの発注書、何を発注したか」を確認する手段がありませんでした。

専用の永続データ（新しいテーブル `purchase_order_prints`、`migrations/0009_purchase_order_prints.sql`）を
追加しています。入出庫帳票（`stock_transactions`）と同じ「1件1行、必要な情報をそのまま
スナップショットとして持たせる」方針で、専用のPDFファイル自体は保存しません（アプリ内で
いつでも同じ見た目を再現でき、そこから改めてブラウザの印刷機能でPDF化できるため）。

---

## データモデル

```ts
// 発注書の印刷履歴。1回の「印刷」操作 (= 1枚の発注書) につき、印刷した明細の数だけ行を作る。
// printGroupId が同じ行は同じ印刷操作 = 同じ発注書に載っていたことを意味する。
interface PurchaseOrderPrintItem {
  id: string;
  printGroupId: string;
  printedAt: string;        // 印刷日時 (ISO)。同じ printGroupId の行はすべて同じ値
  supplierId: string;
  supplierName: string;     // 以下 supplier* は印刷した時点の仕入先マスタのスナップショット
  supplierAddress: string;
  supplierContact: string;
  supplierPhone: string;
  orderDate: string;        // 発注書に入力されていた発注日
  senderName: string;       // 以下 sender* は印刷した時点の発注元 (localStorage) のスナップショット
  senderAddress: string;
  senderPhone: string;
  senderContact: string;
  inboundPlanId: string;    // 元になった入荷予定の id (参考情報。予定が削除されても履歴は残る)
  productName: string;
  productSku: string;
  expectedDate: string;
  quantity: number;
  unitPrice: number;
  amount: number;           // quantity * unitPrice
}
```

- 商品名・仕入先名・発注元情報などはすべて**印刷した時点の値をそのままコピー**して持つ
  （入出庫帳票の商品名・SKUと同じ方針）。あとで商品を改名したり仕入先マスタを編集したりしても、
  発注履歴タブの表示は変わらない。
- 在庫は動かないので `stock_transactions` には何も書かない。`product_id` / `supplier_id` への
  外部キーは張らない（`products` / `suppliers` が PUT で全削除→再挿入される方式のため、他の
  テーブルと同じ理由）。

### 印刷済みロックとの関係

[supplier-feature.md](supplier-feature.md) の「印刷済みロック」で導入した `InboundPlan.printedAt`
（入荷予定側のフラグ）とは別の記録です。役割が違います:

| | 何を記録するか | 目的 |
|---|---|---|
| `InboundPlan.printedAt` | その入荷予定が印刷済みかどうか (真偽値的なタイムスタンプ) | 同じ明細を発注書に二重に載せない (次に開いたときチェックできなくする) |
| `PurchaseOrderPrintItem` | 印刷した内容そのもののスナップショット | あとから同じ発注書を再表示・再印刷する |

どちらも `printPurchaseOrder`（1回の「印刷」操作）が同時に更新する。

---

## 発注書モーダルとの連動

`PurchaseOrderModal.tsx` の「印刷」ボタンは、選択中の明細・仕入先・発注元・発注日をまとめて
`onPrint`（＝ `printPurchaseOrder`）に渡してから `window.print()` を呼ぶ。`printPurchaseOrder` は
1回の呼び出しで:

1. 対象の入荷予定に `printedAt` を記録する（印刷済みロック）
2. 新しい `printGroupId`（`crypto.randomUUID()`）を発行し、選択されていた明細の数だけ
   `PurchaseOrderPrintItem` を組み立てて `purchaseOrderPrints` に追加する

を行う。「印刷ボタンを押した」ことをもって記録するため、実際に印刷ダイアログで印刷を完了したか
キャンセルしたかまでは区別できない（[supplier-feature.md](supplier-feature.md) と同じ簡略化）。

---

## 画面: 発注履歴タブ

`PurchaseOrderHistoryView.tsx`。タブの並びは 原価履歴 の次、一番最後。`CostHistoryView.tsx` /
`LedgerView.tsx` と同じ構成（絞り込み・集計・CSV は `useInventory.ts` の純粋関数に任せ、画面は
表示だけを持つ）。

- キーワード（仕入先名・明細の商品名/SKU）／仕入先／印刷日時の期間で絞り込み
- 一覧は**印刷操作 (`printGroupId`) 単位**。印刷日時の新しい順。列は 印刷日時・発注日・仕入先・
  件数・数量・金額・操作（再表示）
- 行の「再表示」で `PurchaseOrderReprintModal.tsx`（読み取り専用）を開くと、印刷時点の
  スナップショットのまま発注書を再現する。チェックボックスによる選択や明細の追加はできない
  （履歴は確定した記録のため）。ここでの「印刷」は再印刷用で、`purchaseOrderPrints` /
  `InboundPlan.printedAt` のどちらも増減しない
- 印刷履歴が一件もない場合は案内文だけを表示する

---

## 実装

| 関数 | 役割 |
|------|------|
| `printPurchaseOrder(input)` | 発注書を印刷する。入荷予定の `printedAt` 記録と発注履歴への追加を1回で行う |
| `purchaseOrderPrintGroups(prints, filter?)` | 印刷履歴 (1行1明細) を `printGroupId` でまとめ、絞り込んで新しい順に返す |
| `purchaseOrderHistoryCsv(groups)` / `exportPurchaseOrderHistoryCsv` | CSV（`CSV_EXPORTS.purchaseOrderHistory`、`発注履歴_YYYY-MM-DD.csv`、明細1行ごとに1行を出力） |

その他の連動:

- `resetToSample` — 発注履歴に対応するサンプルデータはないため、リセットのたびに空へ戻す
- Worker: `PUT /api/purchase-order-prints`（`purchase_order_prints` テーブルの全置換）、
  `GET /api/state` のレスポンスに `purchaseOrderPrints` を追加

テストは純粋関数が `src/test/purchaseOrderHistory.test.ts`、`printPurchaseOrder` 自体は
`src/test/inboundPlan.test.ts`、画面が `src/test/PurchaseOrderHistoryView.test.tsx` です。
