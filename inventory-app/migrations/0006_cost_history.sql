-- 仕入価格・原価履歴。入荷予定に仕入単価を持たせ、入荷したときの単価を stock_transactions へ
-- 書き写す (帳票の「入荷」だけが持つ属性)。専用のマスタテーブルは増やさない。
ALTER TABLE inbound_plans ADD COLUMN unit_price INTEGER NOT NULL DEFAULT 0;

ALTER TABLE stock_transactions ADD COLUMN unit_price INTEGER;
ALTER TABLE stock_transactions ADD COLUMN supplier_id TEXT;

CREATE INDEX idx_tx_supplier ON stock_transactions(supplier_id);
