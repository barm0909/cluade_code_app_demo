-- 締め処理 (docs/billing-closing-feature.md)
--
-- 得意先ごとの締め日と支払条件。既存の得意先は「末日締め・翌月末払い」になる
-- (それまでの請求書作成の初期値 = 前月1日〜末日、翌月末払い と同じ)。
--   closing_day    : 5/10/15/20/25、31 = 末日、0 = 都度請求 (締め請求の対象外)
--   payment_months : お支払期限が締め日の何か月後か (0 = 当月、1 = 翌月、2 = 翌々月)
--   payment_day    : お支払期限の日 (31 = 末日)
ALTER TABLE customers ADD COLUMN closing_day INTEGER NOT NULL DEFAULT 31;
ALTER TABLE customers ADD COLUMN payment_months INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN payment_day INTEGER NOT NULL DEFAULT 31;

-- 繰越型の請求書: 前回御請求額・御入金額・繰越額のスナップショット (同じ書類の各行に同じ値)。
-- has_balance_forward = 0 の行 (この機能より前の請求書と納品書) は紙面に繰越欄を出さない。
-- 請求書の請求額 (入金管理の消込の対象) は今回分だけで、繰越額は含めない。
ALTER TABLE sales_document_items ADD COLUMN has_balance_forward INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_document_items ADD COLUMN previous_billed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_document_items ADD COLUMN received INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_document_items ADD COLUMN carry_over INTEGER NOT NULL DEFAULT 0;
