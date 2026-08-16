-- 開発用サンプルデータ (useInventory.ts の SAMPLE_DATA / SAMPLE_INBOUND_PLANS / DEFAULT_CATEGORIES /
-- DEFAULT_SUPPLIERS と同期)
-- アプリ同様に賞味期限を実行日からの相対日付で生成する (date('now', ...) は SQLite 組み込み)
-- 再実行できるよう、投入前に既存の商品・ロット・帳票・カテゴリ・入荷予定・仕入先を全削除する

DELETE FROM stock_transactions;
DELETE FROM inbound_plans;
DELETE FROM lots;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM suppliers;

INSERT INTO categories (id, name) VALUES
  ('cat-dairy', '乳製品'),
  ('cat-bread', 'パン'),
  ('cat-label', 'ラベル');

INSERT INTO suppliers (id, name, code, contact, phone, email, address, lead_time_days, note, active) VALUES
  ('sup-yamada',      '山田乳業',       'S-001', '山田 太郎', '03-1234-5678', 'order@yamada-dairy.example.jp',   '東京都千代田区1-1-1', 2, '定期便（火・金）', 1),
  ('sup-asahi',       '朝日ベーカリー', 'S-002', '朝日 花子', '06-2345-6789', 'contact@asahi-bakery.example.jp', '大阪府大阪市北区2-2-2', 1, '',                 1),
  ('sup-osaka-print', '大阪印刷',       'S-003', '',          '06-3456-7890', '',                                '大阪府堺市3-3-3',     7, 'ラベル・資材',     1);

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
-- 仕入先は supplier_id で suppliers を参照する (旧 supplier 列は移行済みなので空文字)
INSERT INTO inbound_plans (id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, created_at, updated_at) VALUES
  ('ip1', '1', date('now', '+2 days'), 24,   0, 'wh-sales', replace(date('now', '+12 days'), '-', ''), date('now', '+12 days'), '', 'sup-yamada',      120, '定期便',                  NULL, datetime('now'), datetime('now')),
  ('ip2', '2', date('now', '-1 days'), 20,   8, 'wh-sales', replace(date('now', '+4 days'),  '-', ''), date('now', '+4 days'),  '', 'sup-asahi',       98,  '',                        NULL, datetime('now'), datetime('now')),
  ('ip3', '3', date('now', '+5 days'), 1000, 0, 'wh-hold',  '20260401',                                NULL,                    '', 'sup-osaka-print', 8,   '検品後に販売倉庫へ移動',  NULL, datetime('now'), datetime('now'));

-- 原価履歴のサンプル: 牛乳を山田乳業から2回入荷した過去の記録 (原価履歴タブで値上がりが見えるように)
INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id) VALUES
  ('tx-cost-1', datetime('now', '-30 days'), '入荷', '1', '牛乳', 'ML-001', replace(date('now', '-30 days'), '-', ''), 10, '入荷予定（山田乳業）', NULL, 'wh-sales', 118, 'sup-yamada'),
  ('tx-cost-2', datetime('now', '-10 days'), '入荷', '1', '牛乳', 'ML-001', replace(date('now', '-10 days'), '-', ''), 10, '入荷予定（山田乳業）', NULL, 'wh-sales', 120, 'sup-yamada');
