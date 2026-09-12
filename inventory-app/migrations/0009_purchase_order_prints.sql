-- 発注書の印刷履歴。1回の「印刷」操作 (= 1枚の発注書) につき、印刷した明細の数だけ行を作る
-- (stock_transactions と同じ「1件1行、必要な情報をスナップショットとしてそのまま持たせる」方針)。
-- print_group_id が同じ行は同じ印刷操作 = 同じ発注書に載っていたことを意味する。
-- 商品名・仕入先名・発注元情報などは印刷した時点の値をそのまま持つので、あとで商品を改名したり
-- 仕入先マスタを編集したりしても、この履歴の表示は変わらない (帳票の過去記録と同じ扱い)。
--
-- 在庫は動かないので stock_transactions とは無関係。product_id / supplier_id への外部キーは
-- 張らない (products / suppliers が PUT で全削除→再挿入される方式のため、他テーブルと同じ理由)。
CREATE TABLE purchase_order_prints (
  id                TEXT PRIMARY KEY,
  print_group_id    TEXT NOT NULL,
  printed_at        TEXT NOT NULL,
  supplier_id       TEXT NOT NULL,
  supplier_name     TEXT NOT NULL DEFAULT '',
  supplier_address  TEXT NOT NULL DEFAULT '',
  supplier_contact  TEXT NOT NULL DEFAULT '',
  supplier_phone    TEXT NOT NULL DEFAULT '',
  order_date        TEXT NOT NULL,
  sender_name       TEXT NOT NULL DEFAULT '',
  sender_address    TEXT NOT NULL DEFAULT '',
  sender_phone      TEXT NOT NULL DEFAULT '',
  sender_contact    TEXT NOT NULL DEFAULT '',
  inbound_plan_id   TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  product_sku       TEXT NOT NULL,
  expected_date     TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  unit_price        INTEGER NOT NULL,
  amount            INTEGER NOT NULL
);

CREATE INDEX idx_po_prints_group ON purchase_order_prints(print_group_id);
CREATE INDEX idx_po_prints_supplier ON purchase_order_prints(supplier_id);
CREATE INDEX idx_po_prints_printed_at ON purchase_order_prints(printed_at);
