import { vi } from 'vitest';
import type { Product, Warehouse, Category, StockTransaction, InboundPlan, Supplier, Customer, SalesOrder, SalesDocumentItem, PaymentItem, PurchaseOrderPrintItem } from '../useInventory';
import type { ChangeSet, SliceName } from '../saveQueue';

// Worker API (/api/*) を模倣する fetch モック。
// 戻り値の server オブジェクトが「D1 の中身」に相当し、テストから直接読み書きできる。
// 差し込んだモックはテスト側で vi.unstubAllGlobals() で解除すること。
export interface FakeServer {
  products: Product[];
  warehouses: Warehouse[];
  categories: Category[];
  ledger: StockTransaction[];
  inboundPlans: InboundPlan[];
  suppliers: Supplier[];
  customers: Customer[];
  salesOrders: SalesOrder[];
  salesDocumentItems: SalesDocumentItem[];
  paymentItems: PaymentItem[];
  purchaseOrderPrints: PurchaseOrderPrintItem[];
}

type DataKey = keyof FakeServer;

/** POST /api/changes のスライス名 → FakeServer のキー (Worker のテーブル対応と同じ) */
const SLICE_KEYS: Record<SliceName, DataKey> = {
  products: 'products',
  warehouses: 'warehouses',
  categories: 'categories',
  ledger: 'ledger',
  'inbound-plans': 'inboundPlans',
  suppliers: 'suppliers',
  customers: 'customers',
  'sales-orders': 'salesOrders',
  'sales-documents': 'salesDocumentItems',
  payments: 'paymentItems',
  'purchase-order-prints': 'purchaseOrderPrints',
};

export interface FakeApi extends FakeServer {
  /** 受け取った POST /api/changes の中身 (古い順) */
  requests: ChangeSet[];
  /** この回数だけ、次の POST /api/changes を 500 で失敗させる */
  failNext: number;
}

export function stubApi(initial?: Partial<FakeServer>): FakeApi {
  const server: FakeApi = {
    products: [], warehouses: [], categories: [], ledger: [], inboundPlans: [], suppliers: [], customers: [],
    salesOrders: [], salesDocumentItems: [], paymentItems: [], purchaseOrderPrints: [],
    ...initial,
    requests: [],
    failNext: 0,
  };

  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.endsWith('/api/state')) {
      const state = Object.fromEntries((Object.values(SLICE_KEYS)).map(k => [k, server[k]]));
      return json(200, JSON.parse(JSON.stringify(state)));
    }
    if (method === 'POST' && url.endsWith('/api/changes') && init?.body) {
      const changes = JSON.parse(init.body) as ChangeSet;
      server.requests.push(changes);
      if (server.failNext > 0) {
        server.failNext--;
        return json(500, { error: 'boom' });
      }
      // Worker と同じく、スライスごとに削除してから id で追加・置き換え
      for (const [slice, change] of Object.entries(changes) as [SliceName, NonNullable<ChangeSet[SliceName]>][]) {
        const key = SLICE_KEYS[slice];
        const rows = (server[key] as { id: string }[]).filter(r => !change.delete.includes(r.id));
        for (const r of change.upsert) {
          const i = rows.findIndex(x => x.id === r.id);
          if (i >= 0) rows[i] = r; else rows.push(r);
        }
        (server as unknown as Record<DataKey, { id: string }[]>)[key] = rows;
      }
      return json(200, { ok: true });
    }
    return json(404, { error: 'not found' });
  }));

  return server;
}
