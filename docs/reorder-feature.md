# 発注提案機能（要発注リスト → 入荷予定）

ダッシュボードの要発注リストを、**そのまま発注（入荷予定の一括作成）まで行える画面**に拡張した機能です。

これまで「発注点を下回っている商品」は一覧とCSVで見えるだけで、実際に発注するには
入荷予定タブへ移動して1件ずつ手で登録し直す必要がありました。そのうえ要発注リストは
**すでに出している発注（入荷予定）を考慮していなかった**ため、発注済みの商品がいつまでも
「不足」として並び、二重発注の元になっていました。

専用の永続データは増やしていません。作られるのは既存の `inbound_plans`（入荷予定）で、
DBマイグレーションも Worker API の追加も不要です。

---

## できること

1. 要発注の各商品について、**未入荷の入荷予定の残数を差し引いた**本当の不足数を見る
2. 目標在庫（発注点の1 / 1.5 / 2倍）から**推奨発注数**を出す
3. 直近の入荷予定から**仕入先・入荷先倉庫・仕入単価**を引き継ぐ
4. 数量と仕入先をその場で直し、選んだ商品を**まとめて入荷予定として登録**する

発注登録は**在庫を1つも動かしません**。在庫になるのは、入荷予定タブで実際に「入荷」したときです
（入出庫帳票にも、発注登録は記録されません）。

---

## 計算

```
見込在庫   ＝ 合計在庫 ＋ 入荷予定残
不足数     ＝ 発注点 − 見込在庫                    ※ マイナスなら0
推奨発注数 ＝ 発注点 × 目標倍率 − 見込在庫         ※ マイナスなら0
```

- **入荷予定残**は、キャンセルされていない予定の `remainingInbound`（予定数量 − 入荷済数量）の合計です。
- **目標倍率**は `REORDER_TARGET_RATIOS`（`[1, 1.5, 2]`）から画面で選びます。既定は `DEFAULT_REORDER_RATIO = 2`。
  発注点ぎりぎりまでしか戻さないとすぐまた発注点を割るため、既定では発注点の2倍を目標にします。
- 対象になる商品は従来どおり `lowStockRows`（`合計在庫 ≦ 発注点`）で、並び順も同じです。
  入荷予定で足りている商品も**リストからは消えません**（「発注済 ◯」バッジと推奨発注数0で並びます）。

### 既定値の引き継ぎ

その商品の**直近に作られた入荷予定**（`createdAt` が最大、キャンセル済みを除く）から引き継ぎます。

| 引き継ぐもの | 引き継げないときの既定 |
|--------------|------------------------|
| 仕入先 | 空文字（未設定）。**取引停止（`active: false`）・削除済みの仕入先は引き継ぎません** |
| 入荷先倉庫 | `DEFAULT_WAREHOUSE_ID`（無ければ先頭の倉庫） |
| 仕入単価 | 商品の `costPrice`（前回の予定の単価が未入力 = 0 のときも同じ） |

入荷予定日は `expectedDateFromLeadTime(supplier)`（今日 + 標準リードタイム）です。
画面で仕入先を選び直すと、その仕入先のリードタイムで引き直されます（入荷予定フォームと同じ規則）。

### 作られる入荷予定

| フィールド | 値 |
|------------|-----|
| `productId` / `warehouseId` / `unitPrice` | 提案の行のもの |
| `quantity` | 推奨発注数（画面で書き換えた場合はその値） |
| `supplierId` / `expectedDate` | 画面で選んだ仕入先とそのリードタイムから |
| `lotNo` / `expiryDate` | **空**（発注時点では決まらないため） |
| `note` | `REORDER_NOTE`（`'発注提案'`） |

ロットNoが空でも入荷できます。入荷モーダルで賞味期限を入れるとそこからロットNoが補われ、
それでも空のまま確定した場合は `planReceipt` が賞味期限（無ければ今日）から採番します。
この変更にあわせて、**入荷予定フォームのロットNoは必須ではなくなりました**（入力するなら従来どおり半角数字8桁）。

---

## 実装

集計・変換はすべて `src/useInventory.ts` の純粋関数で、`src/DashboardView.tsx` は表示と
選択状態だけを持ちます（`planDisposal` / 一括廃棄と同じ構成）。

| 関数 | 役割 |
|------|------|
| `reorderSuggestions(products, inboundPlans, suppliers, warehouses, options?)` | 発注提案の行（`lowStockRows` の各行 + 入荷予定残・推奨発注数・既定値） |
| `reorderPlanInput(row, suppliers, override?, from?)` | 1行を `InboundPlanInput` に変換 |
| `planReorder(rows, productIds, suppliers, overrides?, from?)` | 発注登録のプレビュー（確認ダイアログと実行が共有する純粋関数） |
| `reorderCsv` / `exportReorderCsv` | 要発注リストのCSV |

`options.from` / `planReorder` の `from` は入荷予定日の起点で、既定は今日です
（テストで日付を固定するために外から渡せます）。

状態を変えるのは `useInventory` の `addInboundPlans(inputs): number` だけです。
1回の state 更新 / 1回の `PUT /api/inbound-plans` にまとめ（`addTransactions` と同じ方針）、
数量0の入力は落として作成できた件数を返します。`App.tsx` が `onCreateOrders` として
`DashboardView` に渡します。

定数 `REORDER_TARGET_RATIOS` / `DEFAULT_REORDER_RATIO` / `REORDER_NOTE` も `useInventory.ts` にあります。

テストは純粋関数が `src/test/dashboard.test.ts`、`addInboundPlans` が `src/test/inboundPlan.test.ts`、
画面が `src/test/DashboardView.test.tsx`、ロットNo未定まわりが `src/test/InboundPlanView.test.tsx` です。

---

## 画面仕様

利用者向けの説明は [spec/dashboard.md](spec/dashboard.md) の「2. 発注提案」にあります。
