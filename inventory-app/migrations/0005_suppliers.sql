-- 仕入先マスタ。useInventory.ts の Supplier を正規化したもの
-- 入荷予定が supplier_id で参照する (名前ではなく id 参照なので、改名しても紐づけは切れない)
CREATE TABLE suppliers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,              -- 仕入先名 (アプリ側で重複を禁止)
  code           TEXT NOT NULL DEFAULT '',   -- 仕入先コード (任意・重複を禁止)
  contact        TEXT NOT NULL DEFAULT '',   -- 担当者名
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  lead_time_days INTEGER NOT NULL DEFAULT 0, -- 標準リードタイム (発注から入荷までの日数)
  note           TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1  -- 1 = 取引中 / 0 = 取引停止
);

CREATE INDEX idx_suppliers_name ON suppliers(name);

-- 入荷予定の仕入先を自由入力 (supplier) から id 参照 (supplier_id) へ。
-- 外部キーは張らない: suppliers は PUT /api/suppliers で全削除→再挿入されるため
-- (inbound_plans.product_id / warehouse_id と同じ理由)。
-- 旧データの supplier 列は残したまま NULL の supplier_id を返し、
-- フロントの migrateInboundPlans が名前から仕入先を作って対応付ける。
ALTER TABLE inbound_plans ADD COLUMN supplier_id TEXT;

CREATE INDEX idx_inbound_plans_supplier ON inbound_plans(supplier_id);
