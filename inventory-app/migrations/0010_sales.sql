-- 売上管理。実際に売れた単価 (実売単価) と売り先 (得意先) を帳票の「売上出庫」へ持たせ、
-- 売上高・原価・粗利を帳票から組み立てられるようにする (原価履歴・廃棄ロスと同じ方針で、
-- 売上専用のテーブルは作らない)。

-- 得意先 (販売先) マスタ。useInventory.ts の Customer を正規化したもの。
-- 売上出庫の記録が customer_id で参照する (名前ではなく id 参照なので、改名しても紐づけは切れない)。
-- 外部キーは張らない: customers は PUT /api/customers で全削除→再挿入されるため
-- (suppliers / products と同じ理由)。
CREATE TABLE customers (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,            -- 得意先名 (アプリ側で重複を禁止)
  code    TEXT NOT NULL DEFAULT '', -- 得意先コード (任意・重複を禁止)
  contact TEXT NOT NULL DEFAULT '', -- 担当者名
  phone   TEXT NOT NULL DEFAULT '',
  email   TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  note    TEXT NOT NULL DEFAULT '',
  active  INTEGER NOT NULL DEFAULT 1 -- 1 = 取引中 / 0 = 取引停止
);

CREATE INDEX idx_customers_name ON customers(name);

-- 売上出庫の売り先。入荷の supplier_id と対になる列 (売上出庫以外では NULL)
ALTER TABLE stock_transactions ADD COLUMN customer_id TEXT;

-- 出庫した時点のロット原価。売上のたびにロットは減って原価が分からなくなるため、
-- 粗利 (売上金額 - 原価) を後から再計算できるようその場で写し取る。
-- unit_price (売上出庫では実売単価) と対になる列で、売上出庫以外では NULL。
ALTER TABLE stock_transactions ADD COLUMN cost_unit_price INTEGER;

CREATE INDEX idx_tx_customer ON stock_transactions(customer_id);
