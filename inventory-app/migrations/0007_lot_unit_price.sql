-- ロット単位の実原価。未設定 (NULL) なら products.cost_price (現在の商品原価) にフォールバックする
-- (フロントの lotUnitCost / worker の readState と同じ方針)。
ALTER TABLE lots ADD COLUMN unit_price INTEGER;
