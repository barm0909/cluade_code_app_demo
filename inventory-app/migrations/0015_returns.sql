-- 返品 (docs/return-feature.md)。帳票に2つの区分と、返品の元取引を指す列を足す。
--   売上返品: 得意先から戻ってきた商品を在庫へ戻す (入庫側)。元の売上出庫を return_of_txn_id で指す
--   仕入返品: 仕入先へ商品を返す (出庫側)。元の入荷が分かれば return_of_txn_id で指す
--
-- SQLite は CHECK 制約を ALTER で変えられないため、0012 と同じく新しい制約でテーブルを作り直して中身を移す
-- (列・インデックスは 0001〜0012 で積み上げたもの + return_of_txn_id)。
CREATE TABLE stock_transactions_new (
  id                TEXT NOT NULL PRIMARY KEY,
  date              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('入荷', '調整入庫', '売上返品', '売上出庫', '資材使用', '調整出庫', '廃棄', '仕入返品', '移動')),
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
  tax_rate          INTEGER,
  return_of_txn_id  TEXT                       -- 返品の元取引の id (売上返品・仕入返品だけ)
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
CREATE INDEX idx_tx_return_of ON stock_transactions(return_of_txn_id);
