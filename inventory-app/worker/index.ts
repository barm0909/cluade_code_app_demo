// Cloudflare Worker: /api/* で D1 を読み書きし、それ以外は静的アセット (dist/) にフォールバックする
// ローカル開発 (wrangler dev) では .wrangler/state のローカルD1、デプロイ後はリモートD1 に同じコードで接続される
//
// API 設計はフロント (useInventory.ts) の「スライス単位で全量保存」に合わせている:
//   GET /api/state       → { products, warehouses, categories, ledger } をまとめて返す
//   PUT /api/products    → products + lots テーブルを全置換
//   PUT /api/warehouses  → warehouses テーブルを全置換
//   PUT /api/categories  → categories テーブルを全置換
//   PUT /api/ledger      → stock_transactions テーブルを全置換

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

// useInventory.ts の型と同期すること
// (useInventory.ts は react/xlsx を import しているため Worker からは参照できず、別定義している)
interface Warehouse {
  id: string;
  name: string;
  color: string;
}

interface Category {
  id: string;
  name: string;
}

interface Lot {
  id: string;
  lotNo: string;
  expiryDate?: string;
  quantity: number;
  warehouseId: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  janCode?: string;
  categoryId: string;
  lots: Lot[];
  minQuantity: number;
  price: number;
  costPrice: number;
  updatedAt: string;
}

interface StockTransaction {
  id: string;
  date: string;
  type: string;
  productId: string;
  productName: string;
  productSku: string;
  lotNo: string;
  quantity: number;
  note: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  jan_code: string | null;
  category_id: string | null;
  min_quantity: number;
  price: number;
  cost_price: number;
  updated_at: string;
}

interface LotRow {
  id: string;
  product_id: string;
  lot_no: string;
  expiry_date: string | null;
  quantity: number;
  warehouse_id: string;
}

interface TransactionRow {
  id: string;
  date: string;
  type: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  lot_no: string;
  quantity: number;
  note: string;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
}

async function readState(db: D1Database) {
  const [productsRes, lotsRes, warehousesRes, categoriesRes, txnsRes] = await db.batch([
    db.prepare('SELECT id, name, sku, jan_code, category_id, min_quantity, price, cost_price, updated_at FROM products'),
    db.prepare('SELECT id, product_id, lot_no, expiry_date, quantity, warehouse_id FROM lots'),
    db.prepare('SELECT id, name, color FROM warehouses'),
    db.prepare('SELECT id, name FROM categories'),
    db.prepare('SELECT id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id FROM stock_transactions ORDER BY date DESC'),
  ]);

  const lotsByProduct = new Map<string, Lot[]>();
  for (const r of lotsRes.results as unknown as LotRow[]) {
    const lot: Lot = {
      id: r.id,
      lotNo: r.lot_no,
      quantity: r.quantity,
      warehouseId: r.warehouse_id,
      ...(r.expiry_date != null ? { expiryDate: r.expiry_date } : {}),
    };
    const list = lotsByProduct.get(r.product_id);
    if (list) list.push(lot);
    else lotsByProduct.set(r.product_id, [lot]);
  }

  const products: Product[] = (productsRes.results as unknown as ProductRow[]).map(r => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    ...(r.jan_code != null ? { janCode: r.jan_code } : {}),
    // category_id が NULL の旧データはフロント側 (migrateProducts) が「未分類」へ振り分ける
    categoryId: r.category_id ?? '',
    minQuantity: r.min_quantity,
    price: r.price,
    costPrice: r.cost_price,
    updatedAt: r.updated_at,
    lots: lotsByProduct.get(r.id) ?? [],
  }));

  const warehouses = warehousesRes.results as unknown as Warehouse[];
  const categories = categoriesRes.results as unknown as Category[];

  const ledger: StockTransaction[] = (txnsRes.results as unknown as TransactionRow[]).map(r => ({
    id: r.id,
    date: r.date,
    type: r.type,
    productId: r.product_id,
    productName: r.product_name,
    productSku: r.product_sku,
    lotNo: r.lot_no,
    quantity: r.quantity,
    note: r.note,
    ...(r.from_warehouse_id != null ? { fromWarehouseId: r.from_warehouse_id } : {}),
    ...(r.to_warehouse_id != null ? { toWarehouseId: r.to_warehouse_id } : {}),
  }));

  return { products, warehouses, categories, ledger };
}

// products + lots を全置換 (batch はトランザクションとして実行される)
// lots → products の順で削除して外部キー違反を避ける
async function replaceProducts(db: D1Database, products: Product[]) {
  const stmts = [db.prepare('DELETE FROM lots'), db.prepare('DELETE FROM products')];
  const insertProduct = db.prepare(
    'INSERT INTO products (id, name, sku, jan_code, category_id, min_quantity, price, cost_price, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertLot = db.prepare(
    'INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const p of products) {
    stmts.push(insertProduct.bind(p.id, p.name, p.sku, p.janCode || null, p.categoryId, p.minQuantity, p.price, p.costPrice, p.updatedAt));
  }
  for (const p of products) {
    for (const l of p.lots) {
      stmts.push(insertLot.bind(l.id, p.id, l.lotNo, l.expiryDate ?? null, l.quantity, l.warehouseId));
    }
  }
  await db.batch(stmts);
}

// warehouses を全置換。lots が warehouse_id を参照しているため、
// 削除→再挿入の間だけ外部キー検査をトランザクション終了まで遅延させる
async function replaceWarehouses(db: D1Database, warehouses: Warehouse[]) {
  const stmts = [
    db.prepare('PRAGMA defer_foreign_keys = on'),
    db.prepare('DELETE FROM warehouses'),
  ];
  const insert = db.prepare('INSERT INTO warehouses (id, name, color) VALUES (?, ?, ?)');
  for (const w of warehouses) stmts.push(insert.bind(w.id, w.name, w.color));
  await db.batch(stmts);
}

// categories を全置換。products が category_id を参照しているため、
// 削除→再挿入の間だけ外部キー検査をトランザクション終了まで遅延させる
async function replaceCategories(db: D1Database, categories: Category[]) {
  const stmts = [
    db.prepare('PRAGMA defer_foreign_keys = on'),
    db.prepare('DELETE FROM categories'),
  ];
  const insert = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)');
  for (const c of categories) stmts.push(insert.bind(c.id, c.name));
  await db.batch(stmts);
}

async function replaceLedger(db: D1Database, ledger: StockTransaction[]) {
  const stmts = [db.prepare('DELETE FROM stock_transactions')];
  const insert = db.prepare(
    'INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const t of ledger) {
    stmts.push(insert.bind(t.id, t.date, t.type, t.productId, t.productName, t.productSku, t.lotNo, t.quantity, t.note, t.fromWarehouseId ?? null, t.toWarehouseId ?? null));
  }
  await db.batch(stmts);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return Response.json(await readState(env.DB));
    }
    if (request.method === 'PUT') {
      switch (url.pathname) {
        case '/api/products':
          await replaceProducts(env.DB, await request.json<Product[]>());
          return Response.json({ ok: true });
        case '/api/warehouses':
          await replaceWarehouses(env.DB, await request.json<Warehouse[]>());
          return Response.json({ ok: true });
        case '/api/categories':
          await replaceCategories(env.DB, await request.json<Category[]>());
          return Response.json({ ok: true });
        case '/api/ledger':
          await replaceLedger(env.DB, await request.json<StockTransaction[]>());
          return Response.json({ ok: true });
      }
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }
    // SPA のアセット配信 (not_found_handling: single-page-application が適用される)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
