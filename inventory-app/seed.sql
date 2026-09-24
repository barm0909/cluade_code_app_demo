-- 開発用サンプルデータ (useInventory.ts の SAMPLE_DATA / SAMPLE_INBOUND_PLANS / DEFAULT_CATEGORIES /
-- DEFAULT_SUPPLIERS / DEFAULT_CUSTOMERS と同期)
-- アプリ同様に賞味期限を実行日からの相対日付で生成する (date('now', ...) は SQLite 組み込み)
-- 再実行できるよう、投入前に既存の商品・ロット・帳票・カテゴリ・入荷予定・仕入先・得意先・発注履歴を全削除する

DELETE FROM stock_transactions;
DELETE FROM purchase_order_prints;
DELETE FROM inbound_plans;
DELETE FROM lots;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM suppliers;
DELETE FROM customers;

INSERT INTO categories (id, name) VALUES
  ('cat-dairy', '乳製品'),
  ('cat-bread', 'パン'),
  ('cat-label', 'ラベル');

INSERT INTO suppliers (id, name, code, contact, phone, email, address, lead_time_days, note, active) VALUES
  ('sup-yamada',      '山田乳業',       'S-001', '山田 太郎', '03-1234-5678', 'order@yamada-dairy.example.jp',   '東京都千代田区1-1-1', 2, '定期便（火・金）', 1),
  ('sup-asahi',       '朝日ベーカリー', 'S-002', '朝日 花子', '06-2345-6789', 'contact@asahi-bakery.example.jp', '大阪府大阪市北区2-2-2', 1, '',                 1),
  ('sup-osaka-print', '大阪印刷',       'S-003', '',          '06-3456-7890', '',                                '大阪府堺市3-3-3',     7, 'ラベル・資材',     1);

INSERT INTO customers (id, name, code, contact, phone, email, address, note, active) VALUES
  ('cus-midori', 'みどりストア',     'C-001', '緑川 一郎', '03-2222-3333', 'order@midori-store.example.jp', '東京都世田谷区4-4-4',     '毎朝配送', 1),
  ('cus-sakura', 'さくらカフェ',     'C-002', '佐倉 美咲', '06-4444-5555', 'cafe@sakura.example.jp',        '大阪府大阪市中央区5-5-5', '',         1),
  ('cus-kita',   '北町給食センター', 'C-003', '',          '011-666-7777', '',                              '北海道札幌市北区6-6-6',   '月末締め', 1);

-- price (販売定価) は税抜。tax_rate は食品なので軽減税率 8%。
-- 値札ラベルは売らない「資材」(kind) なので、販売定価・税率は使われない (列の既定値のまま)
INSERT INTO products (id, name, sku, jan_code, category_id, min_quantity, price, cost_price, tax_rate, kind, updated_at) VALUES
  ('1', '牛乳',           'ML-001', '4901234567894', 'cat-dairy', 5,   198, 130, 8, '販売品', datetime('now')),
  ('2', '食パン',         'BR-001', '4912345678904', 'cat-bread', 5,   150, 90,  8, '販売品', datetime('now')),
  ('3', '値札ラベル(赤)', 'LB-R01', NULL,            'cat-label', 100, 5,   2,   8, '資材',   datetime('now')),
  ('4', 'チーズ',         'CS-001', '4901987654322', 'cat-dairy', 4,   350, 220, 8, '販売品', datetime('now'));

-- l1/l2 (牛乳) は原価履歴のサンプル (118→120) と揃えて実原価を持たせてある。
-- それ以外は unit_price を NULL のままにし、商品の現在原価にフォールバックする挙動を示す。
INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price) VALUES
  ('l1', '1', replace(date('now', '+3 days'),  '-', ''), date('now', '+3 days'),  10,  'wh-sales', 118),
  ('l2', '1', replace(date('now', '+7 days'),  '-', ''), date('now', '+7 days'),  10,  'wh-sales', 120),
  ('l3', '2', replace(date('now', '+1 days'),  '-', ''), date('now', '+1 days'),  3,   'wh-sales', NULL),
  ('l4', '3', '20260101',                                NULL,                    500, 'wh-sales', NULL),
  ('l5', '4', replace(date('now', '-2 days'),  '-', ''), date('now', '-2 days'),  2,   'wh-hold',  NULL),
  ('l6', '4', replace(date('now', '+14 days'), '-', ''), date('now', '+14 days'), 4,   'wh-sales', NULL);

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

-- 売上管理のサンプル: 直近の売上出庫。実売単価 (unit_price) は定価どおりの日と値引きした日を混ぜ、
-- 出庫した時点のロット原価 (cost_unit_price) と税率 (tax_rate) も一緒に残してある (粗利・消費税が計算できるように)。
-- tx-sale-old だけは実売単価・原価・得意先・税率を持たない古い記録で、売上管理タブでは
-- 商品の販売定価・現在原価・現在の税率で代用した「概算」として表示される。
INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, customer_id, cost_unit_price, tax_rate) VALUES
  ('tx-sale-1',   datetime('now', '-6 days'), '売上出庫', '1', '牛乳',   'ML-001', replace(date('now', '-30 days'), '-', ''), 6, '売上登録', 'wh-sales', NULL, 198,  'cus-midori', 118,  8),
  ('tx-sale-2',   datetime('now', '-5 days'), '売上出庫', '2', '食パン', 'BR-001', replace(date('now', '+1 days'),  '-', ''), 4, '売上登録', 'wh-sales', NULL, 150,  'cus-sakura', 90,   8),
  ('tx-sale-3',   datetime('now', '-3 days'), '売上出庫', '4', 'チーズ', 'CS-001', replace(date('now', '+14 days'), '-', ''), 2, '売上登録', 'wh-sales', NULL, 320,  'cus-kita',   220,  8),
  ('tx-sale-4',   datetime('now', '-1 days'), '売上出庫', '1', '牛乳',   'ML-001', replace(date('now', '-10 days'), '-', ''), 8, '売上登録', 'wh-sales', NULL, 178,  'cus-midori', 120,  8),
  ('tx-sale-old', datetime('now', '-20 days'), '売上出庫', '1', '牛乳',  'ML-001', replace(date('now', '-30 days'), '-', ''), 3, 'FEFO出庫', 'wh-sales', NULL, NULL, NULL,         NULL, NULL);

-- 資材 (値札ラベル) を使った記録。資材は売らないので売上出庫ではなく「資材使用」で出庫し、
-- 単価・得意先・税率は持たない (売上管理には出ず、在庫分析の出庫ペースにだけ使われる)
INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id) VALUES
  ('tx-use-1', datetime('now', '-2 days'), '資材使用', '3', '値札ラベル(赤)', 'LB-R01', '20260101', 100, '', 'wh-sales', NULL);
