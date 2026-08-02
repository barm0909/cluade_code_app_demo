import { daysUntilExpiry } from './useInventory';
import type { Warehouse } from './useInventory';

// 在庫一覧と棚卸表で共通に使う小さな表示部品

export function ExpiryBadge({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return <span className="expiry-none">—</span>;
  const days = daysUntilExpiry(expiryDate);
  if (days < 0) return <span className="expiry-badge expired">期限切れ</span>;
  if (days === 0) return <span className="expiry-badge expiring-today">今日まで</span>;
  if (days <= 7) return <span className="expiry-badge expiring-soon">{days}日後</span>;
  return <span className="expiry-badge ok">{expiryDate}</span>;
}

export function WarehouseDot({ warehouse }: { warehouse?: Warehouse }) {
  if (!warehouse) return <span className="wh-unknown">—</span>;
  return (
    <span className="wh-badge" style={{ borderColor: warehouse.color, color: warehouse.color }}>
      <span className="wh-dot" style={{ background: warehouse.color }} />
      {warehouse.name}
    </span>
  );
}
