import type { StockTransaction, Warehouse } from './useInventory';

interface Props {
  ledger: StockTransaction[];
  warehouses: Warehouse[];
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LedgerView({ ledger, warehouses }: Props) {
  const whName = (id?: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '';
  if (ledger.length === 0) {
    return (
      <div className="table-wrapper">
        <p className="empty">入出庫の記録がありません。ロット追加や在庫数の調整を行うと記録されます。</p>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>区分</th>
            <th>商品名</th>
            <th>SKU</th>
            <th>ロットNo</th>
            <th style={{ textAlign: 'right' }}>数量</th>
            <th>倉庫</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map(txn => (
            <tr key={txn.id}>
              <td className="mono">{formatDate(txn.date)}</td>
              <td>
                <span className={txn.type === '入庫' ? 'badge badge-in' : 'badge badge-out'}>
                  {txn.type}
                </span>
              </td>
              <td><strong>{txn.productName}</strong></td>
              <td className="mono">{txn.productSku}</td>
              <td className="mono">{txn.lotNo}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                <span className={txn.type === '入庫' ? 'qty-in' : 'qty-out'}>
                  {txn.type === '入庫' ? '+' : '-'}{txn.quantity}
                </span>
              </td>
              <td style={{ fontSize: '0.85rem', color: '#555' }}>
                {txn.type === '移動' && txn.fromWarehouseId && txn.toWarehouseId
                  ? `${whName(txn.fromWarehouseId)} → ${whName(txn.toWarehouseId)}`
                  : (txn.toWarehouseId ? whName(txn.toWarehouseId) : '')}
              </td>
              <td style={{ color: '#888', fontSize: '0.85rem' }}>{txn.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
