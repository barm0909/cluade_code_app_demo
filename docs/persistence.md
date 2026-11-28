# 保存の仕組み（差分保存）

データの保存は `src/saveQueue.ts`（フロント）と `worker/index.ts` の `POST /api/changes`（Worker）で行う。
画面仕様（非プログラマ向け）は [spec/data-and-rules.md](spec/data-and-rules.md) の「データの保存タイミング」。

## 以前の方式と、変えた理由

以前は操作のたびに、変更したスライス（商品+ロット / 帳票 / 請求書 …）の **全件** を `PUT /api/<スライス>` で送り、
Worker がテーブルを全削除→全挿入していた。次の問題があった。

| 問題 | いまの方式での対処 |
|------|--------------------|
| データが増えるほど1回の保存が重くなる（出庫1回で帳票を全件送り直す） | 変わったレコードだけを送る（差分保存） |
| 1つの操作の保存がスライスごとに別のリクエストで、片方だけ失敗すると在庫と帳票がずれる | 同じ操作の変更を1リクエスト・1トランザクションにまとめる |
| 保存の失敗を画面に出さずに捨てていた | 自動で再送し、だめなら画面に出して「再試行」できるようにする |
| サーバーから読み込めなかったときに、仮のサンプルデータを元にした変更でサーバーを上書きしうる | 読み込めるまで何も送らない |

同時編集の上書き（後から保存した人の内容で先の人の変更が消える）は、下の「同時編集の衝突検知」で止めている。
レコード単位の保存なので、別のレコードを同時に変えた場合はそもそも互いに消し合わない。

## フロント（saveQueue.ts）

各操作はこれまでどおり `saveXxx(next)`（= `persist(slice, next)`）にスライスの配列全体を渡す。操作の書き方は変えていない。

- `SaveQueue` はスライスごとに **baseline**（サーバーにあるはずの内容。id → `{ ref, json }`）を持ち、
  `diffRecords` で「追加・変更されたレコード」と「消えたレコードの id」を出す。状態は immutable に更新しているので、
  前回と同じオブジェクト（ref が同じ）は JSON 化せずに「変わっていない」とみなす（帳票が何万件でも比較が軽い）
- 同じイベントの中の保存（`setState` の更新関数の中で呼ばれるものも含む）は `setTimeout(0)` まで待ってから
  `mergeChangeSets` で1つにまとめ、1回の `POST /api/changes` で送る
- 送信は1件ずつ。送信中の変更は次の送信にまとめる（同じレコードは後の変更が勝つ）
- 通信エラー・5xx は 1秒 → 3秒 → 10秒あけて自動で再送（`retrying`）。それでも失敗したら `error`。
  400 などは再送しても同じなのですぐ `error`。`error` の間の変更も捨てずにため、`retry()` で失敗分とまとめて送る
- 読み込み（`GET /api/state`）に成功したら `load()` で baseline をサーバーの内容にする。失敗したら `markOffline()`
  （何も送らない）。マウント時に `reset()` してから読み込むので、読み込み前の仮のサンプルデータの変更は送らない
- 状態（`loading` / `idle` / `saving` / `retrying` / `error` / `offline`）は `useInventory` が
  `useSyncExternalStore` で `saveStatus` として返し、`App.tsx` が `SaveStatus.tsx` で表示する
  （ヘッダーに「保存中…」、失敗・オフラインは全タブの上に帯）。まだ届いていない変更があると、画面を閉じる前にブラウザの確認を出す
- `saveQueue` はモジュールに1つ（サーバーは1つなので、baseline も1つ）

## Worker（POST /api/changes）

リクエスト: `{ [スライス名]: { upsert: レコード[], delete: id[] } }`（スライス名は `persist()` と同じ）。

- テーブルごとの列と値の並べ方を `TableDef` に持ち、追加・更新は `INSERT ... ON CONFLICT(id) DO UPDATE` で書く。
  `INSERT OR REPLACE` は `products.sku` / `categories.name` の UNIQUE にぶつかった **別の行を黙って消す** ので使わない
  （UPSERT ならエラーになり、トランザクションごと失敗してフロントに知らせられる）
- 商品は lots を含めて送られてくるので、商品の UPSERT のあとにその商品の lots を消して入れ直す
- 順番: `PRAGMA defer_foreign_keys = on` → 削除（商品とそのロット → 帳票などの子 → マスタ）→ 追加・更新（倉庫・カテゴリ・仕入先・得意先 → 商品+ロット → 帳票など）。
  全部を1回の `db.batch`（= 1トランザクション）で実行するので、1文でも失敗すれば何も書かれない
- 形のおかしいリクエスト（知らないスライス名、id のないレコード）は 400

以前の `PUT /api/<スライス>`（全置換）は廃止した。

## 同時編集の衝突検知

楽観的ロック。マイグレーションは `0018_record_revisions.sql`。

- 全スライスのテーブル（`products` / `warehouses` / `categories` / `stock_transactions` / `inbound_plans` / `suppliers` /
  `customers` / `sales_orders` / `purchase_order_prints` / `sales_document_items` / `payment_items`）に版番号 `rev`
  （新しい行は 0）を持たせた。`lots` には持たせない — ロットは商品ごと丸ごと書き直すので、商品の `rev` が兼ねる
  （だから同じ商品の別のロットを同時に動かしても衝突になる。在庫の整合を優先した割り切り）
- `GET /api/state` は内容と **同じバッチで** `revs`（`{ スライス: { id: rev } }`）を返す（別に読むと rev だけ新しくなりうる）。
  フロントの `SaveQueue.load(state, revs)` が覚える。レコードの型には `rev` を入れない（画面の状態とは別に持つ）
- 送信時（`flush`）に、更新・削除する **既存** レコード（rev が分かっているもの）にだけ `base: { id: 最後に見た rev }` を付ける。
  新しいレコード（id はランダム）には付けない。base は enqueue 時ではなく送信直前に付けるので、自動再送や
  `retry()` でまとめ直した変更にも、その時点で確定している rev が付く
- Worker はバッチの先頭で `base` を確かめる。更新は「行がない or rev が違う」、削除は「行があって rev が違う」なら衝突
  （もう消えている行の削除は通す）。判定は `json_each(base)` と表の LEFT JOIN で、衝突があると `save_conflict_guard` 表に
  0 を入れて `CHECK (ok = 1)`（制約名 `save_conflict`）に引っかけ、**バッチ全体（= 1トランザクション）を取り消す**。
  判定と書き込みが同じトランザクションなので、間に別の書き込みが割り込まない。エラー文に `save_conflict` があれば、
  どのレコードかを読み直して `409 { error: 'conflict', conflicts: { スライス: id[] } }` を返す
- 追加・更新は `ON CONFLICT(id) DO UPDATE SET ..., rev = rev + 1 RETURNING id, rev`。成功の応答
  `{ ok: true, revs }` で新しい rev を返し、フロントは次の送信の base にする。削除したレコードの rev は忘れる
- フロントは 409 を `SaveError(conflict)` にし、状態を `conflict` にする。自動再送も `retry()` もしない（相手の変更を消すことに
  なるので）。以後の変更も古い内容が元なので送らない。`SaveBanner` が「最新の内容を読み込む」を出し、
  `reloadLatest` → `saveQueue.discardAndReload()` が未送信の変更を捨てて（`beforeunload` の確認を出さないように）再読み込みする
- 後方互換: `base` のないリクエスト（デプロイ直後に開いたままの古い画面）は従来どおり上書き。`revs` を返さない古い Worker
  なら、フロントは `base` を付けない
- 限界: 通信エラーで応答だけ失われた（実は書けていた）変更を自動再送すると、自分の変更と衝突して `conflict` になる。
  読み込み直せば正しい内容になるので、そのままにしている。ほかの端末の変更を画面に自動で反映する仕組み（ポーリング等）はない

## テスト

- `src/test/saveQueue.test.ts` … `diffRecords` / `mergeChangeSets`、`SaveQueue`（読み込み前は送らない、同じタイミングの保存を1回に、
  送信中の変更は次へ、自動再送、error と retry、400 は再送しない、衝突検知の base / rev の受け渡し、409 で conflict・再送しない・discardAndReload）、`postChanges` の 409、`useInventory` との結合（出庫が商品1件 + 帳票の新しい行だけの1リクエストになる、オフライン、一時的な失敗からの回復、別の端末が同じ商品を変えていたら出庫も帳票も書かない、別の商品なら保存できる）
- `src/test/SaveStatus.test.tsx` … 帯とヘッダーの表示（衝突の帯と「最新の内容を読み込む」を含む）
- `src/test/mockApi.ts` … `POST /api/changes` を Worker と同じ意味で適用する偽サーバー。`requests`（受け取った変更）、`failNext`（わざと失敗させる回数）、`revs` と `editElsewhere`（別の端末の変更を再現して rev を上げる。Worker と同じ規則で 409 を返す）を持つ
- Worker の SQL はローカル D1（wrangler dev）で、全スライスの追加・更新・削除、UNIQUE 違反でのロールバック、400 を確認した。衝突検知も、正しい base での更新、古い base での更新（409・同じリクエストの帳票も書かれない）、新しい行、削除（古い base は 409、消えた行の削除は通す）、消えた行の更新（409）、base なし（従来どおり）、不正な base（400）を確認した（自動テストはない）
