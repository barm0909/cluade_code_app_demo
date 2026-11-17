-- 納品書・請求書の発行履歴。1枚の書類につき、載せた明細の数だけ行を作る
-- (発注書の印刷履歴 purchase_order_prints と同じ「1件1行、ヘッダ情報もスナップショットとして各行に持たせる」方針)。
-- document_id が同じ行は同じ書類。得意先名・商品名・発行元情報は発行した時点の値をそのまま持つので、
-- あとでマスタを編集しても発行済みの書類の表示は変わらない。
--
-- txn_ids はその明細にまとめた stock_transactions (売上出庫) の id の JSON 配列。
-- 同じ売上を同じ種類の書類に二度載せない (二重請求の防止) 判定に使う。
-- 在庫は動かないので stock_transactions には何も書かない。customer_id への外部キーは張らない
-- (customers が PUT で全削除→再挿入される方式のため、他テーブルと同じ理由)。
CREATE TABLE sales_document_items (
  id                      TEXT PRIMARY KEY,
  document_id             TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('納品書', '請求書')),
  document_no             TEXT NOT NULL,             -- 例: D20261117-001 / I20261117-001
  issued_at               TEXT NOT NULL,             -- 発行操作の日時 (ISO)
  issue_date              TEXT NOT NULL,             -- 書類に記載する発行日 YYYY-MM-DD
  customer_id             TEXT NOT NULL,
  customer_name           TEXT NOT NULL DEFAULT '',
  customer_address        TEXT NOT NULL DEFAULT '',
  customer_contact        TEXT NOT NULL DEFAULT '',
  period_from             TEXT NOT NULL,             -- 対象期間 (納品書は納品日)
  period_to               TEXT NOT NULL,
  due_date                TEXT NOT NULL DEFAULT '',  -- お支払期限 (請求書だけ)
  issuer_name             TEXT NOT NULL DEFAULT '',
  issuer_address          TEXT NOT NULL DEFAULT '',
  issuer_phone            TEXT NOT NULL DEFAULT '',
  issuer_contact          TEXT NOT NULL DEFAULT '',
  issuer_registration_no  TEXT NOT NULL DEFAULT '',  -- 適格請求書発行事業者の登録番号
  issuer_bank_account     TEXT NOT NULL DEFAULT '',  -- 振込先 (請求書だけ)
  line_no                 INTEGER NOT NULL,
  delivery_date           TEXT NOT NULL,
  product_name            TEXT NOT NULL,
  product_sku             TEXT NOT NULL,
  quantity                INTEGER NOT NULL,
  unit_price              INTEGER NOT NULL,          -- 税抜
  amount                  INTEGER NOT NULL,          -- 税抜
  tax_rate                INTEGER NOT NULL,
  txn_ids                 TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_sales_doc_items_document ON sales_document_items(document_id);
CREATE INDEX idx_sales_doc_items_customer ON sales_document_items(customer_id);
CREATE INDEX idx_sales_doc_items_issue_date ON sales_document_items(issue_date);
