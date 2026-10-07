-- 受注 (出荷予定)。useInventory.ts の SalesOrder を正規化したもので、入荷予定 (inbound_plans) の販売側の対。
-- 受注自体は在庫を持たず、出荷すると lots から在庫が引かれ stock_transactions に「売上出庫」が残る
-- (区分は売上登録と同じなので、stock_transactions の CHECK を広げる作り直しは要らない)。
-- 在庫の引当 (取り置き) は保存せず、フロントが受注残と現在庫から毎回計算する。
--
-- product_id / customer_id には外部キーを張らない: products / customers は全削除→再挿入で保存されるため
-- (inbound_plans と同じ理由。商品削除時の受注の削除はフロント側の deleteProduct が行う)。
CREATE TABLE sales_orders (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL,             -- 得意先マスタの id
  product_id        TEXT NOT NULL,
  expected_date     TEXT NOT NULL,             -- 出荷予定日 YYYY-MM-DD
  quantity          INTEGER NOT NULL,          -- 受注数量
  shipped_quantity  INTEGER NOT NULL DEFAULT 0,-- 出荷済数量 (分割出荷の累計)
  unit_price        INTEGER NOT NULL DEFAULT 0,-- 受注単価 (税抜)。0 は未入力
  warehouse_id      TEXT NOT NULL DEFAULT '',  -- 出荷元倉庫。空文字は全倉庫から引き当てる
  note              TEXT NOT NULL DEFAULT '',
  canceled_at       TEXT,                      -- キャンセル日時 (ISO)。NULL なら有効
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_sales_orders_expected ON sales_orders(expected_date);
CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_id);
