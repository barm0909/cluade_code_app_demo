# 仕入価格・原価履歴機能

入荷予定に**仕入単価**を持たせ、実際に入荷したときの単価を入出庫帳票（ledger）へ書き写して、
それを一覧できる読み取り専用の **原価履歴タブ** を追加した機能です。

これまで価格は `Product.costPrice`（原価）という単一の現在値しか持たず、履歴がありませんでした。
同じ商品を同じ仕入先から複数回仕入れていても、値上げ・値下げの推移をあとから追う手段がなく、
仕入先ごとの単価を比較することもできませんでした。

専用の永続データ（新しいマスタテーブル）は増やしていません。ロット追跡・廃棄ロス集計と同じく、
**帳票を読んで組み立てる** 方式です（`migrations/0006_cost_history.sql` は既存テーブルへの
`ALTER TABLE` のみ）。

---

## データモデル

```ts
interface InboundPlan {
  // ...既存のフィールド
  unitPrice: number; // 仕入単価 (円)。0 は未入力
}

interface StockTransaction {
  // ...既存のフィールド
  unitPrice?: number;   // 仕入単価/原価 (円)。「入荷」（仕入単価）と「廃棄」（そのロットの原価）だけが持つ
  supplierId?: string;  // 仕入先マスタの id。「入荷」だけが持つ
}
```

- `unitPrice` は入荷予定の作成・編集フォームで入力する任意項目（既定 0 = 未入力）。
- `receiveInboundPlan` が入荷のたびに `plan.unitPrice` と `plan.supplierId` を
  帳票の「入荷」行へそのままコピーする。
- ロット単位の実原価トラッキング機能（[../CLAUDE.md](../CLAUDE.md) の `Lot.unitPrice` 参照）により、
  `disposeLots`（一括廃棄）も廃棄した時点のロットの原価を「廃棄」行の `unitPrice` に書き込む
  （supplierId は持たない）。それ以外の区分（調整入庫・出庫・移動・棚卸など）はこの属性を持たない。
- 帳票は記録時点の値をコピーして持つ方針（商品名・SKU と同じ）なので、あとで仕入先を改名しても
  過去の原価履歴の表示だけが変わり、記録された単価そのものは変わらない。

### 旧データの後方互換

`migrateInboundPlans` が `unitPrice` を持たない旧データ（マイグレーション前の保存分）を
`unitPrice: 0`（未入力）として補う。

---

## 画面: 原価履歴タブ

`CostHistoryView.tsx`。タブの並びは ロット追跡 の次、一番最後。`LedgerView.tsx` と同じ構成
（絞り込み・集計・CSV は `useInventory.ts` の純粋関数に任せ、画面は表示だけを持つ）。

- キーワード（商品名・SKU・仕入先名）／仕入先／期間で絞り込み
- 一覧は新しい順。列は 日時・商品名・SKU・ロットNo・仕入先・仕入単価・**前回比**・数量・金額
- **前回比**：同一商品×同一仕入先の直前の記録と比べた差額（▲値上がり／▼値下がり／±0）。
  初回の記録は「初回」と表示する
- サマリ行に件数・平均仕入単価（数量加重平均）・仕入金額合計
- 仕入単価が一件も記録されていない（＝すべての入荷予定が未入力のまま入荷された）場合は
  案内文だけを表示する

入荷予定タブ・そのフォームにも仕入単価が見える:

- `InboundPlanModal.tsx` — 「仕入単価 (円)」の任意入力欄（`NumberInput`、`ProductModal` の
  原価入力と同じ形）
- `InboundPlanView.tsx` の一覧・CSV（`inboundPlanCsv`）にも仕入単価の列を追加

---

## 実装

| 関数 | 役割 |
|------|------|
| `costHistoryRows(ledger, suppliers)` | 帳票の「入荷」のうち仕入単価>0のものを新しい順に整形し、前回比 (`previousUnitPrice`) を計算する |
| `filterCostHistory(rows, filter)` | キーワード／仕入先／期間で絞り込み |
| `costHistoryTotals(rows)` | 件数・数量加重平均単価・金額合計 |
| `costHistoryCsv(rows)` / `exportCostHistoryCsv` | CSV（`CSV_EXPORTS.costHistory`、`原価履歴_YYYY-MM-DD.csv`） |

その他の連動:

- `receiveInboundPlan` — 入荷のたびに `unitPrice` / `supplierId` を帳票へ書き写す
- `inboundPlanCsv` / `InboundPlanView` — 入荷予定の一覧・CSV に仕入単価列を追加

在庫数・商品の原価（`Product.costPrice`）そのものは変わりません。原価履歴はあくまで
「過去にいくらで仕入れたか」という**仕入イベントの記録**です。

これとは別に `Lot.unitPrice`（ロットの実原価）という概念があります。こちらは「そのロットの現在の
原価基準」で、複数回の入荷で加重平均されたり、ダッシュボード・棚卸・廃棄ロスの評価額計算に
直接使われたりします（`lotUnitCost`）。原価履歴の各行がそのまま `Lot.unitPrice` になるとは限りません
（同じロットへ複数回入荷すると加重平均されるため）。詳しくは `CLAUDE.md` の Data model の説明を参照してください。

テストは純粋関数が `src/test/costHistory.test.ts`、画面が `src/test/CostHistoryView.test.tsx`
です。
