-- 開発用サンプルデータ (useInventory.ts の SAMPLE_DATA / SAMPLE_INBOUND_PLANS / DEFAULT_CATEGORIES と同期)
-- アプリ同様に賞味期限を実行日からの相対日付で生成する (date('now', ...) は SQLite 組み込み)
-- 再実行できるよう、投入前に既存の商品・ロット・帳票・カテゴリ・入荷予定を全削除する

DELETE FROM stock_transactions;
DELETE FROM inbound_plans;
DELETE FROM lots;
DELETE FROM products;
DELETE FROM categories;

INSERT INTO categories (id, name) VALUES
  ('cat-dairy', '乳製品'),
  ('cat-bread', 'パン'),
  ('cat-label', 'ラベル');

INSERT INTO products (id, name, sku, jan_code, category_id, min_quantity, price, cost_price, updated_at) VALUES
  ('1', '牛乳',           'ML-001', '4901234567894', 'cat-dairy', 5,   198, 130, datetime('now')),
  ('2', '食パン',         'BR-001', '4912345678904', 'cat-bread', 5,   150, 90,  datetime('now')),
  ('3', '値札ラベル(赤)', 'LB-R01', NULL,            'cat-label', 100, 5,   2,   datetime('now')),
  ('4', 'チーズ',         'CS-001', '4901987654322', 'cat-dairy', 4,   350, 220, datetime('now'));

INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id) VALUES
  ('l1', '1', replace(date('now', '+3 days'),  '-', ''), date('now', '+3 days'),  10,  'wh-sales'),
  ('l2', '1', replace(date('now', '+7 days'),  '-', ''), date('now', '+7 days'),  10,  'wh-sales'),
  ('l3', '2', replace(date('now', '+1 days'),  '-', ''), date('now', '+1 days'),  3,   'wh-sales'),
  ('l4', '3', '20260101',                                NULL,                    500, 'wh-sales'),
  ('l5', '4', replace(date('now', '-2 days'),  '-', ''), date('now', '-2 days'),  2,   'wh-hold'),
  ('l6', '4', replace(date('now', '+14 days'), '-', ''), date('now', '+14 days'), 4,   'wh-sales');

-- 入荷予定: ip2 は分割入荷の途中かつ予定日超過 (遅延)、ip3 は賞味期限なしの資材
INSERT INTO inbound_plans (id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, note, canceled_at, created_at, updated_at) VALUES
  ('ip1', '1', date('now', '+2 days'), 24,   0, 'wh-sales', replace(date('now', '+12 days'), '-', ''), date('now', '+12 days'), '山田乳業',       '定期便',                  NULL, datetime('now'), datetime('now')),
  ('ip2', '2', date('now', '-1 days'), 20,   8, 'wh-sales', replace(date('now', '+4 days'),  '-', ''), date('now', '+4 days'),  '朝日ベーカリー', '',                        NULL, datetime('now'), datetime('now')),
  ('ip3', '3', date('now', '+5 days'), 1000, 0, 'wh-hold',  '20260401',                                NULL,                    '大阪印刷',       '検品後に販売倉庫へ移動',  NULL, datetime('now'), datetime('now'));
