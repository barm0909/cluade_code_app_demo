-- 商品マスタに JANコード (8桁 or 13桁のバーコード) を追加する
-- JANのない商品 (自社ラベル等) があるため NULL 許可
ALTER TABLE products ADD COLUMN jan_code TEXT;
