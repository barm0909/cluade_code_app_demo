# 仕入先マスタ機能

発注先（仕入先）を**マスタ**として管理し、入荷予定から名前ではなく**id で参照する**機能です。

これまで入荷予定の仕入先は自由入力の文字列でした。そのため

- 同じ取引先を「山田乳業」「山田乳業(株)」と打ち間違えると別物として扱われる
- 担当者・電話・リードタイムといった連絡先を置く場所がない
- 改名すると過去の予定と繋がらなくなる

という問題がありました。カテゴリ・倉庫と同じく id 参照のマスタにすることで、
**改名しても過去の入荷予定の紐づけが切れず**、表示だけが一斉に変わります。

専用の永続データを持つため、マイグレーション（`migrations/0005_suppliers.sql`）と
Worker API（`PUT /api/suppliers`）を追加しています。

---

## データモデル

```ts
interface Supplier {
  id: string;
  name: string;          // 仕入先名 (必須・重複不可)
  code: string;          // 仕入先コード (任意・重複不可)
  contact: string;       // 担当者名
  phone: string;
  email: string;
  address: string;
  leadTimeDays: number;  // 標準リードタイム (発注から入荷までの日数)
  note: string;
  active: boolean;       // 取引中か (false = 取引停止)
}
```

入荷予定側は `supplier: string`（自由入力）が **`supplierId: string`** に変わりました
（空文字は「仕入先未設定」）。

### 削除ではなく「取引停止」

取引が終わった仕入先を削除してしまうと、過去の入荷予定の仕入先が消えます。
そのため **入荷予定から参照されている仕入先は削除できず**（`deleteSupplier` が弾き、
一覧の削除ボタンも無効）、代わりに `active=false`（取引停止）にします。
取引停止の仕入先は

- 一覧には淡色で残る（「取引停止も表示」のチェックを外すと隠せる）
- 入荷予定の仕入先セレクトからは外れる。ただし**編集中の予定がすでにその仕入先を指しているときだけは残る**
  （勝手に別の仕入先へ付け替わらないように）

### 旧データの移行

仕入先マスタ導入前の入荷予定は仕入先名を文字列で持っています。読み込み時に
`migrateInboundPlans(plans, suppliers)` が

1. 同じ名前の仕入先があればその id へ対応付ける
2. なければその名前で仕入先を作る（他の項目は空、`active=true`）
3. 空欄の予定は「仕入先未設定」（`supplierId: ''`）のまま残す

を行い、移行が発生したときだけ仕入先と予定を保存し直します（商品のカテゴリ移行と同じ方針）。
DB 側の `inbound_plans.supplier` 列は旧データを読むために残してあり、Worker は
`supplier_id` が NULL の行だけ旧列の名前を返します。保存時は `supplier_id` に書き、
旧列は空文字で埋めます。

---

## 画面

商品マスタタブの最後のセクション（商品 → カテゴリ → 倉庫 → **仕入先**）。

- `SupplierMasterView.tsx` — 一覧・絞り込み（キーワード / 取引停止の表示）・CSV・取引停止の切替・削除。
  絞り込みと集計は純粋関数 `supplierRows` に任せている（他の画面と同じ構成）
- `SupplierModal.tsx` — 登録・編集フォーム。項目が9つあるので、カテゴリ・倉庫のような
  インライン編集ではなくモーダル（`modal modal-wide modal-panel` + `.form-grid`）にしている

一覧の「入荷予定」列には、その仕入先の予定件数・入荷待ち件数と数量・遅延件数が出ます。
入荷待ちがある仕入先はここから発注状況が分かるので、要発注リストと突き合わせる必要がありません。

### 入力チェック

`supplierValidationError(input, suppliers, selfId?)`（純粋関数）が判定し、
モーダルと `addSupplier` / `updateSupplier` の両方が同じ関数を呼びます。
「エラーは出ないのに保存されない」ということは起こりません。

| 条件 | メッセージ |
|------|-----------|
| 仕入先名が空（空白のみを含む） | 仕入先名は必須です |
| 他の仕入先と同じ名前 | 同じ名前の仕入先がすでにあります |
| 他の仕入先と同じコード（空欄は対象外） | 同じ仕入先コードがすでにあります |
| メールアドレスの形式が不正（空欄は対象外） | メールアドレスの形式が正しくありません |

---

## 入荷予定との連動

- **仕入先はセレクトで選ぶ**（自由入力ではなくなりました）。「未設定」も選べます
- **標準リードタイム**：新規作成で仕入先を選ぶと、入荷予定日が `今日 + leadTimeDays` になります
  （`expectedDateFromLeadTime`）。**自分で予定日を入れ直したあとは上書きしません**。
  編集中の予定の予定日も動かしません
- 一覧の絞り込みに「全仕入先」セレクトが増え、キーワード検索は**マスタから解決した仕入先名**に効きます
- CSV（入荷予定）の仕入先列もマスタから解決した名前です
- 入荷したときの帳票の備考 `入荷予定（仕入先名）` は、**入荷した時点のマスタの名前**で記録されます
  （帳票は過去の記録なので、あとで改名しても書き換わりません）

---

## 実装

| 関数 | 役割 |
|------|------|
| `supplierValidationError(input, suppliers, selfId?)` | 入力チェック。問題がなければ空文字 |
| `normalizeSupplierInput(input)` | 前後の空白を除去し、リードタイムを0以上の整数に丸める |
| `supplierName(suppliers, id)` | 表示用の名前。マスタにない id は空文字 |
| `selectableSuppliers(suppliers, currentId?)` | 入荷予定のセレクトに出す仕入先（取引中＋選択中） |
| `expectedDateFromLeadTime(supplier, from?)` | 入荷予定日の既定値（今日＋標準リードタイム） |
| `supplierUsage(plans)` | supplierId → 予定件数・入荷待ち件数と数量・遅延件数 |
| `supplierRows(suppliers, plans, keyword?, includeInactive?)` | 絞り込み＋集計。取引中が先、その中は名前順 |
| `supplierCsv(rows)` / `exportSupplierCsv` | CSV（`CSV_EXPORTS.supplier`、`仕入先一覧_YYYY-MM-DD.csv`） |
| `addSupplier` / `updateSupplier` / `deleteSupplier` | マスタの CRUD。削除は入荷予定から参照されていないときだけ |
| `migrateInboundPlans(plans, suppliers)` | 旧データ（自由入力の仕入先名）をマスタへ対応付ける |

その他の連動:

- `receiveInboundPlan` — 帳票の備考に入れる仕入先名をマスタから解決する
- `resetToSample` — `DEFAULT_SUPPLIERS`（`seed.sql` と同期）に戻す。
  入荷予定が仕入先を参照するので、仕入先を戻したあとに予定を戻す

在庫は動かないので**帳票（入出庫）には何も記録しません**（カテゴリ・倉庫マスタと同じ）。

テストは純粋関数とミューテーターが `src/test/supplier.test.ts`、画面が
`src/test/SupplierMasterView.test.tsx` です。
