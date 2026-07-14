-- 開発用サンプルデータ (useInventory.ts の SAMPLE_DATA と同期)
-- アプリ同様に賞味期限を実行日からの相対日付で生成する (date('now', ...) は SQLite 組み込み)
-- 再実行できるよう、投入前に既存の商品・ロット・帳票を全削除する

DELETE FROM stock_transactions;
DELETE FROM lots;
DELETE FROM products;

INSERT INTO products (id, name, sku, category, min_quantity, price, cost_price, updated_at) VALUES
  ('1', '牛乳',           'ML-001', '乳製品', 5,   198, 130, datetime('now')),
  ('2', '食パン',         'BR-001', 'パン',   5,   150, 90,  datetime('now')),
  ('3', '値札ラベル(赤)', 'LB-R01', 'ラベル', 100, 5,   2,   datetime('now')),
  ('4', 'チーズ',         'CS-001', '乳製品', 4,   350, 220, datetime('now'));

INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id) VALUES
  ('l1', '1', replace(date('now', '+3 days'),  '-', ''), date('now', '+3 days'),  10,  'wh-sales'),
  ('l2', '1', replace(date('now', '+7 days'),  '-', ''), date('now', '+7 days'),  10,  'wh-sales'),
  ('l3', '2', replace(date('now', '+1 days'),  '-', ''), date('now', '+1 days'),  3,   'wh-sales'),
  ('l4', '3', '20260101',                                NULL,                    500, 'wh-sales'),
  ('l5', '4', replace(date('now', '-2 days'),  '-', ''), date('now', '-2 days'),  2,   'wh-hold'),
  ('l6', '4', replace(date('now', '+14 days'), '-', ''), date('now', '+14 days'), 4,   'wh-sales');
