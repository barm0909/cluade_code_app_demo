# 入荷予定機能

発注済みでまだ届いていない在庫を**入荷予定**として登録し、届いたらその予定から
ロットを作って在庫に反映する（＝入荷する）機能です。

これまで入庫は「在庫一覧でロットを手で追加する」しかなく、ロットNo・賞味期限・倉庫を
毎回入力し直す必要がありました。入荷予定はその内容を先に決めておける場所で、
入荷時は数量を確認するだけで済みます。分割入荷（20個の予定のうち8個が先に到着）にも対応します。

FEFO出庫と違い**専用の永続データを持つ**ため、マイグレーション（`migrations/0004_inbound_plans.sql`）と
Worker API（`PUT /api/inbound-plans`）を追加しています。

---

## データモデル

```ts
interface InboundPlan {
  id: string;
  productId: string;
  expectedDate: string;      // 入荷予定日 YYYY-MM-DD
  quantity: number;          // 予定数量
  receivedQuantity: number;  // 入荷済数量 (分割入荷の累計)
  warehouseId: string;       // 入荷先倉庫
  lotNo: string;             // 予定ロットNo (入荷時の既定値)
  expiryDate?: string;       // 予定賞味期限
  supplier: string;
  note: string;
  canceledAt?: string;       // キャンセル日時。未設定なら有効
  createdAt: string;
  updatedAt: string;
}
```

**状態（`未入荷` / `一部入荷` / `入荷済` / `キャンセル`）は保存していません。**
`inboundPlanStatus(plan)` が `receivedQuantity` と `quantity`（と `canceledAt`）から導出するので、
入荷の記録と状態表示がずれることがありません。キャンセルだけは操作の結果なので
`canceledAt` として保存します。

`product_id` には外部キーを張っていません。`PUT /api/products` が products を
全削除→再挿入する方式のため、`ON DELETE CASCADE` を付けると商品保存のたびに
予定が消えてしまうからです。商品削除時の予定削除はフロント側（`deleteProduct`）が行います。

---

## 画面

タブ構成は `ダッシュボード / 在庫一覧 / **入荷予定** / 商品マスタ / 棚卸 / 入出庫帳票`。

- `InboundPlanView.tsx` — 一覧・絞り込み（キーワード / 予定日範囲 / 状態 / 倉庫）・集計・CSV。
  絞り込みと集計は純粋関数 `inboundPlanRows` / `inboundPlanTotals` に任せている
  （`LedgerView` / `StocktakeView` / `DashboardView` と同じ構成）
- `InboundPlanModal.tsx` — 予定の作成・編集。ロットNoは賞味期限から自動生成（`LotModal` と同じ挙動）
- `ReceiveInboundModal.tsx` — 入荷。予定の内容を初期値にしつつ、実際に届いたものに合わせて
  数量・倉庫・ロットNo・賞味期限・備考を上書きできる

入荷予定日を過ぎても残数がある行には「遅延」バッジを付け、行を `row-expiring` で色付けします。

両モーダルは入力欄が多いので、`modal modal-wide modal-panel` + `.modal-body` の構成で
**見出しと `.modal-actions` を固定し、本文だけをスクロール**させています（`max-height: calc(100vh - 48px)`）。
入力欄は `.form-grid` で2列、横いっぱいにしたい項目だけ `.form-span-2`（560px 以下では1列に戻ります）。
新しくモーダルを足すときも、入力欄が5つを超えるならこの構成に合わせてください。

---

## 入荷のルール

`planReceipt(plan, product, input)`（純粋関数）が「どのロットにいくつ積むか」を決めます。
入荷モーダルのプレビューと `receiveInboundPlan` が同じ関数を共有しているので、
確定したら別のロットに入っていた、ということは起こりません。

1. 数量は `remainingInbound(plan)`（＝ `quantity - receivedQuantity`）を上限に丸める。
   **過入荷は受け付けない**（予定を増やすか、在庫一覧のロット行から入庫してもらう）
2. ロットNo・入荷先倉庫・賞味期限が**すべて一致**する既存ロットがあれば、そのロットへ加算する。
   分割入荷が同じロットにまとまるのはこの動きによる
3. 一致するロットがなければ新しいロットを作る
4. `receivedQuantity` に加算し、`quantity` に達した時点で状態が `入荷済` になる

## 帳票への記録

在庫が動くのは「入荷」のときだけです。予定の作成・編集・取消・削除は帳票に記録しません。

入荷1回につき `入荷` を1件記録します（`toWarehouseId` は入荷先倉庫、`note` は入力した備考、
未入力なら `入荷予定（仕入先）`）。

```
2026/08/14 17:10  入荷  食パン  BR-001  20260818  +12  販売倉庫  入荷予定（朝日ベーカリー）
```

---

## 実装

| 関数 | 役割 |
|------|------|
| `inboundPlanStatus(plan)` / `remainingInbound(plan)` / `isOverdueInboundPlan(plan, today?)` | 状態・残数・遅延の導出 |
| `inboundPlanRows(plans, products, filter?)` | 絞り込み＋商品情報の解決。予定日昇順（同日は登録順）。商品マスタにない予定は除外 |
| `inboundPlanTotals(rows)` | 件数・予定・入荷済・残・遅延件数（キャンセルは数量集計から除外） |
| `inboundPlanCsv(rows, warehouses)` / `exportInboundPlanCsv` | CSV（`CSV_EXPORTS.inbound`、`入荷予定_YYYY-MM-DD.csv`） |
| `planReceipt(plan, product, input)` | 入荷でどのロットがどう増えるかを返す。状態は変更しない |
| `addInboundPlan` / `updateInboundPlan` / `cancelInboundPlan` / `deleteInboundPlan` | 予定の CRUD。キャンセル済みは編集不可、`receivedQuantity` は編集対象外 |
| `receiveInboundPlan(id, input)` | 入荷。ロット反映・予定更新・帳票記録を行い `ReceiptResult` を返す（入荷できなければ `null`） |

その他の連動:

- `deleteProduct` — その商品の入荷予定も削除する（入荷済みの在庫・帳票は残る）
- `deleteWarehouse` — ロットに加えて**入荷待ちの予定が入荷先にしている倉庫**も削除できない
  （`WarehouseMasterView` 側でもボタンを無効化）
- `resetToSample` — `SAMPLE_INBOUND_PLANS`（`seed.sql` と同期）に戻す

テストは純粋関数とミューテーターが `src/test/inboundPlan.test.ts`、画面が
`src/test/InboundPlanView.test.tsx` です。
