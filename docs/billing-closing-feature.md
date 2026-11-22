# 締め処理（締め請求）機能

得意先ごとの **締め日・支払条件** を得意先マスタに持たせ、締め日を選ぶとその日が締め日にあたる得意先の請求書
（対象期間・お支払期限・明細・前回からの繰越）をまとめて組み立てて発行・印刷する機能。
納品書・請求書 ([sales-document-feature.md](sales-document-feature.md)) と入金管理 ([receivable-feature.md](receivable-feature.md)) の続き。
画面仕様 (非プログラマ向け) は [spec/sales-document.md](spec/sales-document.md) の「締め請求」と [spec/master.md](spec/master.md) の得意先マスタ。

## 構成

| ファイル | 役割 |
|----------|------|
| `src/ClosingModal.tsx` | 締め請求。締め日・発行日・発行元を入れ、対象の得意先を選び、紙面をまとめてプレビュー → 一括発行・印刷 |
| `src/SalesDocumentView.tsx` | 「締め請求」ボタン (`onIssueMany` があるときだけ)、一覧の金額欄に繰越込みの今回御請求額 |
| `src/SalesDocumentModal.tsx` | 個別の請求書も得意先の締め日・支払条件から期間・期限の初期値を決め、繰越を載せる |
| `src/SalesDocumentPaper.tsx` | 繰越欄 (前回御請求額 / 御入金額 / 繰越額 / 今回御買上額 / 今回御請求額)、対象期間より前の行に「前回以前」 |
| `src/salesDocumentIssuer.ts` | 発行元情報の localStorage 読み書き (請求書作成と締め請求で共有。SalesDocumentModal から切り出し) |
| `src/CustomerModal.tsx` / `CustomerMasterView.tsx` | 締め日・お支払期限の入力と「締め・支払」列 |
| `src/useInventory.ts` | 型・純粋関数・`issueSalesDocuments` |
| `migrations/0017_billing_closing.sql` | `customers` に締め日・支払条件、`sales_document_items` に繰越のスナップショット |
| `worker/index.ts` | 上の列の読み書き |

## データ

- `Customer.closingDay?: ClosingDay` — `5/10/15/20/25`、`31` = 末日、`0` = 都度請求 (締め請求の対象外)
- `Customer.paymentMonths?: 0 | 1 | 2` / `paymentDay?: 5/10/15/20/25/31` — お支払期限 = 締め日の◯か月後の◯日 (31 = 末日)
- どれも任意で、未設定は **末日締め・翌月末払い** (`customerClosingDay` / `customerPaymentMonths` / `customerPaymentDay`)。
  それまでの請求書作成の初期値 (前月1日〜末日・翌月末) と同じ。読み込み時と `normalizeCustomerInput` で既定値を入れる
- `SalesDocumentItem.balanceForward?: { previousBilled, received, carryOver }` — 繰越型の請求書だけが持つ発行時点のスナップショット
  (D1 では `has_balance_forward` + 3列)。この機能より前の請求書と納品書は持たず、紙面に繰越欄を出さない

**締めの記録 (締め済みテーブル等) は持たない。** 前回の締め = その得意先の前月の締め日、と日付から決め、
発行した請求書は普通の請求書として `salesDocumentItems` に入る。在庫も帳票も動かない。

## 純粋関数

| 関数 | 役割 |
|------|------|
| `isClosingDate(date, day)` / `latestClosingDate(day, today)` / `latestClosingDateAmong(customers, today)` | 締め日の判定・直近の締め日 (末日は月の最終日、2月も) |
| `billingPeriod(day, closingDate)` | 対象期間 = 前月の締め日の翌日 〜 締め日 |
| `paymentDueDate(customer, baseDate)` | お支払期限。基準は締め日 (都度請求・個別作成は対象期間の末日) |
| `balanceForward(customerId, items, payments, issueDate)` | 繰越。下の「繰越の数え方」 |
| `invoiceGrandTotal(doc)` | 今回御請求額 = 繰越額 + 今回御買上額 |
| `closingCandidates(closingDate, customers, sales, items, payments, issueDate)` | 締め請求の行。締め日にあたる得意先 (都度請求を除く。取引停止は請求するものがあるときだけ) |
| `closingInvoiceInput(candidate, issueDate, issuer)` | 行 → `IssueSalesDocumentInput` |
| `draftSalesDocuments(inputs, items)` | まとめてプレビュー (書類番号は続き番号) |
| `prepareSalesDocuments(inputs, items, payments, newId, issuedAt)` | まとめて発行する中身。1枚ずつ、先に作った分も含めて二重請求を付け直して検証し、繰越を計算し直す。発行できない入力は飛ばす |

`issueSalesDocuments(inputs)` (hook) は `prepareSalesDocuments` の結果を1回の state 更新・1回の PUT で保存する。
既存の `issueSalesDocument(input)` はその1件版になった (振る舞いは同じ)。

## 決めごと

- **載せる売上は締め日までの未請求すべて**。対象期間より前の請求漏れ (`deliveryDate < periodFrom`) も含め、
  締め請求の表に「前回以前 n件」、紙面の行に「前回以前」の印を付ける (紙面側は `deliveryDate < periodFrom` で判定するのでフィールドを足していない)。
  締め日より後の売上は次回。返品は請求書と同じく差し引く
- **繰越の数え方** (入金管理と同じ数え方に合わせる):
  - 繰越額 = それまでに発行したその得意先の請求書の残高の合計 − 未消込入金 (前受があればマイナス)
  - 御入金額 = 前回の請求書の発行日の翌日 〜 今回の発行日の入金 (振込手数料を含む消込額)。前回がなければ発行日までの全部
  - 前回御請求額 = 繰越額 + 御入金額 (**逆算**)。前回の発行日以前の日付で入金をあとから登録した場合や、
    今回の発行日より後の日付の入金がある場合は、前回の請求書に印字した額と一致しないことがある
- **請求書の請求額 (入金管理の消込対象) は今回御買上額だけ**。繰越額は前の請求書の残高そのものなので、
  含めると二重に数えてしまう。紙面の「ご請求金額」と一覧の「御請求」は繰越込み (`invoiceGrandTotal`)
- 繰越は発行時に `prepareSalesDocuments` が保存直前の請求書・入金で計算し直す (プレビューが古くても発行時点の値になる)
- 同じ締め日の請求書 (対象期間の末日 = 締め日) があれば「発行済み」として選べない。ただし判定は売上側
  (同じ売上は二度請求書に載らない) が本体で、こちらは表示のため
- 個別の請求書作成 (`SalesDocumentModal`) も得意先の締め日から直近の締めの期間を初期値にし、支払条件から期限を出し、
  繰越を載せる。都度請求の得意先は従来どおり前月1日〜末日

## やっていないこと

- 締めの確定・ロック (締めた期間の売上の修正を止める)
- 売上がなく繰越だけの得意先への請求書 (明細0件は発行できない)
- 仕入側の締め (買掛金)
- 締め日の選択肢の追加 (5/10/15/20/25/末日/都度)

## テスト

- `src/test/billingClosing.test.ts` … 日付計算 (末日・年またぎ・2月)、ラベル、`normalizeCustomerInput` の既定値、`closingCandidates`、
  `balanceForward`、`prepareSalesDocuments` / `draftSalesDocuments`、`issueSalesDocuments` と API 保存・復元、旧データの読み込み
- `src/test/SalesDocumentView.test.tsx` … 締め請求の画面 (対象の得意先・期間・期限・繰越欄 → 一括発行 → 発行済み)
- `src/test/CustomerMasterView.test.tsx` … 締め日・支払条件の表示と編集
