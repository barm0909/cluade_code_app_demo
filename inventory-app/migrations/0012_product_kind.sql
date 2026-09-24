-- 商品区分 (販売品 / 資材)。値札ラベルのように在庫は管理するが売らないものを「資材」として分け、
-- 売上の登録・売上出庫の対象から外す。資材を使った分は新しい出庫区分「資材使用」で記録する。

-- 商品区分。既存の商品はすべて販売品とみなす (資材にする商品は画面の商品マスタで切り替える)。
ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT '販売品' CHECK (kind IN ('販売品', '資材'));

-- 出庫区分に「資材使用」を足す。SQLite は CHECK 制約を ALTER で変えられないため、
-- 新しい制約でテーブルを作り直して中身を移す (列・インデックスは 0001〜0011 で積み上げたものと同じ)。
CREATE TABLE stock_transactions_new (
  id                TEXT NOT NULL PRIMARY KEY,
  date              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('入荷', '調整入庫', '売上出庫', '資材使用', '調整出庫', '廃棄', '移動')),
  product_id        TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  product_sku       TEXT NOT NULL,
  lot_no            TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  from_warehouse_id TEXT,
  to_warehouse_id   TEXT,
  unit_price        INTEGER,
  supplier_id       TEXT,
  customer_id       TEXT,
  cost_unit_price   INTEGER,
  tax_rate          INTEGER
);

INSERT INTO stock_transactions_new (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id, customer_id, cost_unit_price, tax_rate)
  SELECT id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id, customer_id, cost_unit_price, tax_rate
  FROM stock_transactions;

DROP TABLE stock_transactions;
ALTER TABLE stock_transactions_new RENAME TO stock_transactions;

CREATE INDEX idx_tx_date     ON stock_transactions(date);
CREATE INDEX idx_tx_product  ON stock_transactions(product_id);
CREATE INDEX idx_tx_supplier ON stock_transactions(supplier_id);
CREATE INDEX idx_tx_customer ON stock_transactions(customer_id);
