-- 初期スキーマ: useInventory.ts のデータモデル (Warehouse / Product / Lot / StockTransaction) を正規化したもの
-- localStorage では Product が lots を内包するが、DB では lots を別テーブルに分離し product_id で紐付ける

CREATE TABLE warehouses (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sku          TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  price        INTEGER NOT NULL DEFAULT 0,
  cost_price   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE TABLE lots (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_no       TEXT NOT NULL,
  expiry_date  TEXT,                -- YYYY-MM-DD、賞味期限なしは NULL
  quantity     INTEGER NOT NULL DEFAULT 0,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
);

CREATE INDEX idx_lots_product   ON lots(product_id);
CREATE INDEX idx_lots_warehouse ON lots(warehouse_id);

-- 入出庫帳票。商品削除後も履歴を残すため products への外部キーは張らず、
-- 記録時点の商品名/SKU をスナップショットとして保持する (StockTransaction と同じ方針)
CREATE TABLE stock_transactions (
  id                TEXT NOT NULL PRIMARY KEY,
  date              TEXT NOT NULL,  -- ISO 8601
  type              TEXT NOT NULL CHECK (type IN ('入荷', '調整入庫', '売上出庫', '調整出庫', '廃棄', '移動')),
  product_id        TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  product_sku       TEXT NOT NULL,
  lot_no            TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  from_warehouse_id TEXT,           -- 出庫元 (移動・出庫系のみ)
  to_warehouse_id   TEXT            -- 入庫先 (移動・入庫系のみ)
);

CREATE INDEX idx_tx_date    ON stock_transactions(date);
CREATE INDEX idx_tx_product ON stock_transactions(product_id);

-- デフォルト倉庫 (useInventory.ts の DEFAULT_WAREHOUSES と同期)
INSERT INTO warehouses (id, name, color) VALUES
  ('wh-sales',  '販売倉庫', '#4caf50'),
  ('wh-hold',   '保留倉庫', '#ff9800'),
  ('wh-defect', '不良倉庫', '#f44336');
