-- 入荷予定 (発注済み・入荷待ち)。useInventory.ts の InboundPlan を正規化したもの
-- 予定自体は在庫を持たず、入荷すると lots へ在庫が積まれ stock_transactions に「入荷」が残る
--
-- product_id には外部キーを張らない: products は PUT /api/products で全削除→再挿入されるため、
-- ON DELETE CASCADE を付けると保存のたびに予定が消えてしまう
-- (商品削除時の予定の削除はフロント側の deleteProduct が行う)。
CREATE TABLE inbound_plans (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL,
  expected_date     TEXT NOT NULL,             -- 入荷予定日 YYYY-MM-DD
  quantity          INTEGER NOT NULL,          -- 予定数量
  received_quantity INTEGER NOT NULL DEFAULT 0,-- 入荷済数量 (分割入荷の累計)
  warehouse_id      TEXT NOT NULL,             -- 入荷先倉庫
  lot_no            TEXT NOT NULL,             -- 予定ロットNo
  expiry_date       TEXT,                      -- 予定賞味期限。なしは NULL
  supplier          TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  canceled_at       TEXT,                      -- キャンセル日時 (ISO)。NULL なら有効
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_inbound_plans_expected ON inbound_plans(expected_date);
CREATE INDEX idx_inbound_plans_product  ON inbound_plans(product_id);
