-- カテゴリマスタ: products.category (自由入力文字列) を categories テーブル参照へ正規化する

CREATE TABLE categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- 既存商品の category 文字列から distinct なカテゴリを生成してバックフィル
INSERT INTO categories (id, name)
SELECT 'cat-' || lower(hex(randomblob(6))), category
FROM (SELECT DISTINCT category FROM products);

-- デフォルトカテゴリ (useInventory.ts の DEFAULT_CATEGORIES と同期)。
-- バックフィルで同名カテゴリが既に作られている場合はそちらを優先する
INSERT OR IGNORE INTO categories (id, name) VALUES
  ('cat-dairy', '乳製品'),
  ('cat-bread', 'パン'),
  ('cat-label', 'ラベル');

ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES categories(id);

UPDATE products
SET category_id = (SELECT id FROM categories c WHERE c.name = products.category);

ALTER TABLE products DROP COLUMN category;
