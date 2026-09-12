-- 発注書として印刷した日時。purchaseOrderRows 自体は前回印刷したかどうかを見ないので、
-- PurchaseOrderModal がこの列を見て「印刷済みの明細はチェックできない」を実現する。
ALTER TABLE inbound_plans ADD COLUMN printed_at TEXT;
