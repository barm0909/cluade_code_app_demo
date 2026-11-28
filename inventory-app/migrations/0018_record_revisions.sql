-- 同時編集の衝突検知 (docs/persistence.md「同時編集の衝突検知」)
--
-- 各レコードに版番号 rev を持たせる。新しく入れた行は 0、POST /api/changes で更新するたびに +1。
-- フロントは既存レコードを更新・削除するとき「最後に見た rev」を送り、Worker は今の rev と違えば
-- (= 別の端末が先に変えていれば) トランザクションごと断って 409 を返す。
-- ロットは商品と丸ごと書き直すので、商品の rev がロットの分も兼ねる (lots には持たせない)。
ALTER TABLE products ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_transactions ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbound_plans ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_prints ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_document_items ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_items ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

-- 衝突したときにトランザクションを止めるためだけの表 (行は1つも入らない)。
-- Worker は「rev が合わないレコードがあれば 0 を入れる」INSERT をバッチの先頭に置く。CHECK に
-- 引っかかるとバッチ全体 (= 1トランザクション) が取り消され、エラー文の save_conflict で衝突と分かる。
CREATE TABLE save_conflict_guard (
  ok INTEGER NOT NULL CONSTRAINT save_conflict CHECK (ok = 1)
);
