import { vi } from 'vitest';
import type { Product, Warehouse, Category, StockTransaction } from '../useInventory';

// Worker API (/api/*) を模倣する fetch モック。
// 戻り値の server オブジェクトが「D1 の中身」に相当し、テストから直接読み書きできる。
// 差し込んだモックはテスト側で vi.unstubAllGlobals() で解除すること。
export interface FakeServer {
  products: Product[];
  warehouses: Warehouse[];
  categories: Category[];
  ledger: StockTransaction[];
}

export function stubApi(initial?: Partial<FakeServer>): FakeServer {
  const server: FakeServer = { products: [], warehouses: [], categories: [], ledger: [], ...initial };

  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.endsWith('/api/state')) {
      return { ok: true, json: async () => JSON.parse(JSON.stringify(server)) };
    }
    if (method === 'PUT' && init?.body) {
      const body = JSON.parse(init.body);
      if (url.endsWith('/api/products')) { server.products = body; return { ok: true, json: async () => ({ ok: true }) }; }
      if (url.endsWith('/api/warehouses')) { server.warehouses = body; return { ok: true, json: async () => ({ ok: true }) }; }
      if (url.endsWith('/api/categories')) { server.categories = body; return { ok: true, json: async () => ({ ok: true }) }; }
      if (url.endsWith('/api/ledger')) { server.ledger = body; return { ok: true, json: async () => ({ ok: true }) }; }
    }
    return { ok: false, json: async () => ({ error: 'not found' }) };
  }));

  return server;
}
