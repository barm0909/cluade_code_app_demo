# 受注（出荷予定）機能

## 概要

これまで販売側は「売上登録（＝その場で出庫）」しかなく、**まだ出荷していない注文**を持つ手段がありませんでした。
仕入側には 発注提案 → 入荷予定 → 入荷 という「予定 → 実績」の流れがあるのに、販売側にはその「予定」がない非対称な状態でした。

受注タブはその「予定」にあたります。得意先から受けた注文を **受注（出荷予定）** として登録し、

- 出荷予定日の早い順に **今の在庫で足りるか（引当）** を見込みで確認でき、
- 出荷するときは受注の得意先・単価のまま **FEFO で売上出庫** でき（分割出荷可）、
- 出荷した分はそのまま **売上管理** に並びます。

画面の仕様（操作者向け）は [spec/sales-order.md](spec/sales-order.md) を参照してください。

## データ

新しいテーブル `sales_orders`（`migrations/0013_sales_orders.sql`）を1つ追加します。
帳票（`stock_transactions`）の形は変えません。出荷は売上登録と同じ `売上出庫` 行になるので、`type` の CHECK を広げる作り直しも不要です。

```ts
interface SalesOrder {
  id: string;
  customerId: string;      // 得意先マスタの id
  productId: string;
  expectedDate: string;    // 出荷予定日 YYYY-MM-DD
  quantity: number;        // 受注数量
  shippedQuantity: number; // 出荷済数量 (分割出荷の累計)
  unitPrice: number;       // 受注単価 (税抜)。0 は未入力
  warehouseId: string;     // 出荷元倉庫。'' は全倉庫
  note: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

入荷予定（`InboundPlan`）と同じ設計方針です。

- **状態は保存しない。** `salesOrderStatus` が `shippedQuantity` / `quantity` / `canceledAt` から 未出荷 / 一部出荷 / 出荷済 / キャンセル を導出する。
- **得意先は id 参照。** 改名しても紐づけは切れない。受注が1件でもある得意先は削除できない（`deleteCustomer`・`CustomerMasterView` の両方で止める）。
- **受注単価 0 は「未入力」。** 出荷時は帳票に `unitPrice` を書かず（`saleFields` の既存ルール）、売上管理は販売定価で概算する。受注一覧の金額も販売定価で概算し `estimatedPrice` を立てる。
- 外部キーは張らない（`products` / `customers` は全削除→再挿入で保存されるため）。商品削除時の受注の削除はフロントの `deleteProduct` が行う。

## 引当（見込み）

引当は **保存しない** 計算です（`salesOrderAllocations(orders, products)`）。

1. 受注残のある受注を出荷予定日 → 登録日時 → id の順に並べる
2. 商品ごとに作業用のロットのコピーを用意し、受注ごとに `planFefoShipment(受注残, { warehouseId })` で割り付ける
3. 割り付けた分を作業用ロットから減らす（後の受注は残りから引く）

`planFefoShipment` をそのまま使うので、期限切れロットの除外・倉庫の絞り込み・FEFO 順は出荷と完全に同じです。
予約をロットに書き込まない理由は、売上登録・FEFO出庫・廃棄・棚卸など在庫を減らす経路が多く、
予約を保存すると全経路で整合を取る必要が出るためです。毎回計算すれば在庫の変化が自動で反映されます。

`salesOrderRows` は **絞り込みの前に全受注で引当を計算** してから絞り込みます
（絞り込みで先の受注が隠れても、その受注が押さえる在庫は変わらないため）。

引当は「見込み」なので、出荷（`planSalesOrderShipment`）は他の受注のために見込んだ在庫も引けます。
どの受注から先に出すかは出荷する人の判断に任せています。

## 出荷

`shipSalesOrder(id, { quantity, includeExpired?, note? })`

1. `planSalesOrderShipment(order, product, input)` で数量を受注残に丸め（過出荷しない）、受注の出荷元倉庫から FEFO で引き当てる
2. 実際の在庫の減算と帳票への記録は `shipFefo` に任せる（`type: '売上出庫'`、`unitPrice` = 受注単価、`customerId` = 受注の得意先、
   備考は入力が空なら `受注出荷（得意先名）`）。`costUnitPrice` / `taxRate` は `saleFields` が既存どおり写し取る
3. `shippedQuantity` に実際に引けた数量を足す

在庫が足りなければ引けた分だけ出荷します（画面は不足があると確定ボタンを押せないので、通常は数量を減らして分割出荷します）。
1つも引けない・受注残がない・キャンセル済み・資材の場合は何もせず `null` を返します。

`ShipSalesOrderModal` のプレビューは同じ `planSalesOrderShipment` と `saleAmounts` を使うので、
表示されるロット・金額・消費税（ロットごとの端数処理）は実際に記録される内容と一致します。

## 既存機能への影響

| 箇所 | 変更 |
|------|------|
| `deleteProduct` | その商品の受注も削除する（入荷予定と同じ） |
| `deleteWarehouse` / `WarehouseMasterView` | 出荷待ちの受注が出荷元にしている倉庫は削除できない |
| `deleteCustomer` / `CustomerMasterView` | 受注が1件でもある得意先は削除できない |
| `resetToSample` | サンプルの受注（`SAMPLE_SALES_ORDERS`）に戻す |
| 売上管理 | 変更なし（出荷は普通の売上出庫として並ぶ） |
| ダッシュボード・発注提案 | 変更なし（受注は見ない。今後の拡張候補） |

## 実装

| 関数 | 役割 |
|------|------|
| `salesOrderStatus(order)` | 状態を導出する |
| `remainingShipment(order)` | 受注残（キャンセル・出荷済は 0） |
| `isOverdueSalesOrder(order, today?)` | 出荷予定日を過ぎて受注残があるか |
| `salesOrderValidationError(input, products, customers)` | 入力チェック（モーダルとミューテーションで共有）。資材は不可 |
| `salesOrderAllocations(orders, products)` | 引当の見込み（受注 id → `{ allocated, shortage }`） |
| `salesOrderRows(orders, products, customers, filter?)` | 一覧の行（引当・概算単価つき）を出荷予定日順に返す |
| `salesOrderTotals(rows)` | 件数・受注・出荷済・受注残（金額）・遅延・在庫不足・キャンセル |
| `salesOrderCsv(rows, warehouses)` / `exportSalesOrderCsv` | CSV（`CSV_EXPORTS.salesOrder` = 受注一覧） |
| `salesOrderCountByCustomer(orders)` | 得意先ごとの受注件数（得意先の削除可否） |
| `planSalesOrderShipment(order, product, input)` | 出荷の引当計画（モーダルと `shipSalesOrder` で共有） |
| `salesOrderShipmentNote(customerName)` | 出荷の帳票の既定の備考 |
| `addSalesOrder` / `updateSalesOrder` / `cancelSalesOrder` / `deleteSalesOrder` | 受注の CRUD（在庫は動かない・帳票にも記録しない） |
| `shipSalesOrder(id, input)` | 出荷（`shipFefo` で売上出庫 + `shippedQuantity` の加算） |

画面は `SalesOrderView.tsx`（受注タブ。入荷予定と売上管理の間）、`SalesOrderModal.tsx`、`ShipSalesOrderModal.tsx`。

保存は `PUT /api/sales-orders`（`worker/index.ts` の `replaceSalesOrders`、`GET /api/state` は `salesOrders` を返す）。
受注を持たない旧サーバーのレスポンスでは空の受注で始まります。

> **デプロイ前に** `npm run db:migrate:remote` で `0013_sales_orders.sql` を本番 D1 に適用してください。
> `GET /api/state` は `sales_orders` を読むので、未適用のままデプロイすると状態の読み込みが失敗します。

## テスト

- `src/test/salesOrder.test.ts` — 純粋関数（状態・引当の優先順・倉庫/期限切れの扱い・行/合計/CSV・出荷計画）と、
  ミューテーション（登録・出荷・分割出荷・過出荷の丸め・在庫不足・キャンセル・削除制約・永続化）
- `src/test/SalesOrderView.test.tsx` — 一覧・引当表示・絞り込み・出荷モーダルのプレビューと確定・登録フォーム
