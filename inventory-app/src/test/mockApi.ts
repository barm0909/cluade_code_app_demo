import { vi } from 'vitest';
import type { Product, Warehouse, Category, StockTransaction, InboundPlan, Supplier, Customer, SalesOrder, SalesDocumentItem, PaymentItem, PurchaseOrderPrintItem } from '../useInventory';
import type { ChangeSet, Revisions, SliceName } from '../saveQueue';

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
  /** 受け取った POST /api/changes の中身 (古い順。base も含む) */
  requests: ChangeSet[];
  /** この回数だけ、次の POST /api/changes を 500 で失敗させる */
  failNext: number;
  /** 各レコードの rev (Worker と同じく、新しい行は 0、更新のたびに +1) */
  revs: Record<SliceName, Record<string, number>>;
  /** 別の端末がレコードを書き換えた状態にする (rev が上がるので、この端末の次の更新は 409 になる) */
  editElsewhere: (slice: SliceName, record: { id: string }) => void;
}

export function stubApi(initial?: Partial<FakeServer>): FakeApi {
  const server: FakeApi = {
    products: [], warehouses: [], categories: [], ledger: [], inboundPlans: [], suppliers: [], customers: [],
    salesOrders: [], salesDocumentItems: [], paymentItems: [], purchaseOrderPrints: [],
    ...initial,
    requests: [],
    failNext: 0,
    revs: Object.fromEntries(Object.keys(SLICE_KEYS).map(slice => [slice, {}])) as FakeApi['revs'],
    editElsewhere: (slice, record) => {
      const key = SLICE_KEYS[slice];
      const rows = server[key] as { id: string }[];
      const i = rows.findIndex(x => x.id === record.id);
      if (i >= 0) rows[i] = record; else rows.push(record);
      server.revs[slice][record.id] = (server.revs[slice][record.id] ?? -1) + 1;
    },
  };
  // 最初から入っている行は rev 0
  for (const [slice, key] of Object.entries(SLICE_KEYS) as [SliceName, DataKey][]) {
    for (const r of server[key] as { id: string }[]) server.revs[slice][r.id] = 0;
  }

  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.endsWith('/api/state')) {
      const state = { ...Object.fromEntries((Object.values(SLICE_KEYS)).map(k => [k, server[k]])), revs: server.revs };
      return json(200, JSON.parse(JSON.stringify(state)));
    }
    if (method === 'POST' && url.endsWith('/api/changes') && init?.body) {
      const changes = JSON.parse(init.body) as ChangeSet;
      server.requests.push(changes);
      if (server.failNext > 0) {
        server.failNext--;
        return json(500, { error: 'boom' });
      }
      const entries = Object.entries(changes) as [SliceName, NonNullable<ChangeSet[SliceName]>][];
      // Worker と同じ衝突検知: 更新は「行がない or rev が違う」、削除は「行があって rev が違う」なら何も書かずに 409
      const conflicts: Record<string, string[]> = {};
      for (const [slice, change] of entries) {
        const ids = Object.entries(change.base ?? {}).filter(([id, rev]) => {
          const current = server.revs[slice][id];
          return current === undefined ? !change.delete.includes(id) : current !== rev;
        }).map(([id]) => id);
        if (ids.length > 0) conflicts[slice] = ids;
      }
      if (Object.keys(conflicts).length > 0) return json(409, { error: 'conflict', conflicts });
      // Worker と同じく、スライスごとに削除してから id で追加・置き換え
      const revs: Revisions = {};
      for (const [slice, change] of entries) {
        const key = SLICE_KEYS[slice];
        const rows = (server[key] as { id: string }[]).filter(r => !change.delete.includes(r.id));
        for (const id of change.delete) delete server.revs[slice][id];
        for (const r of change.upsert) {
          const i = rows.findIndex(x => x.id === r.id);
          if (i >= 0) rows[i] = r; else rows.push(r);
          const rev = (server.revs[slice][r.id] ?? -1) + 1;
          server.revs[slice][r.id] = rev;
          (revs[slice] ??= {})[r.id] = rev;
        }
        (server as unknown as Record<DataKey, { id: string }[]>)[key] = rows;
      }
      return json(200, { ok: true, revs });
    }
    return json(404, { error: 'not found' });
  }));

  return server;
}
