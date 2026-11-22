-- 入金 (売掛金の回収)。useInventory.ts の PaymentItem を正規化したもの。
-- 1回の入金 (振込1回) を、充てた請求書ごとに1行に分けて持つ。receipt_id が同じ行は同じ入金。
-- document_id が空の行は、どの請求書にも充てていない入金 (未消込 = 前受・過入金)。
-- 請求書の入金状況 (未入金/一部入金/入金済) や残高・期限超過は保存せず、フロントが
-- sales_document_items の請求額とこのテーブルの消込額から毎回計算する。
--
-- 在庫は動かないので stock_transactions には何も書かない。customer_id / document_id には外部キーを張らない
-- (customers・sales_document_items が PUT で全削除→再挿入される方式のため、他テーブルと同じ理由)。
-- 入金のある請求書の取消・得意先の削除はフロント側で止める。
CREATE TABLE payment_items (
  id            TEXT PRIMARY KEY,
  receipt_id    TEXT NOT NULL,
  customer_id   TEXT NOT NULL,
  payment_date  TEXT NOT NULL,                -- 入金日 YYYY-MM-DD
  method        TEXT NOT NULL CHECK (method IN ('振込', '現金', '手形', '相殺', 'その他')),
  document_id   TEXT NOT NULL DEFAULT '',     -- 消込先の請求書 (sales_document_items.document_id)。'' = 未消込
  document_no   TEXT NOT NULL DEFAULT '',     -- 消込先の請求書番号 (表示用)
  amount        INTEGER NOT NULL,             -- この行の入金額
  fee           INTEGER NOT NULL DEFAULT 0,   -- この行に充てた振込手数料 (先方が差し引いた額)
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL                 -- 登録操作の日時 (ISO)
);

CREATE INDEX idx_payment_items_receipt ON payment_items(receipt_id);
CREATE INDEX idx_payment_items_customer ON payment_items(customer_id);
CREATE INDEX idx_payment_items_document ON payment_items(document_id);
