// Cloudflare Worker: /api/* で D1 を読み書きし、それ以外は静的アセット (dist/) にフォールバックする
// ローカル開発 (wrangler dev) では .wrangler/state のローカルD1、デプロイ後はリモートD1 に同じコードで接続される
//
// API 設計はフロント (useInventory.ts) の「スライス単位で全量保存」に合わせている:
//   GET /api/state        → { products, warehouses, categories, ledger, inboundPlans, suppliers } をまとめて返す
//   PUT /api/products     → products + lots テーブルを全置換
//   PUT /api/warehouses   → warehouses テーブルを全置換
//   PUT /api/categories   → categories テーブルを全置換
//   PUT /api/ledger       → stock_transactions テーブルを全置換
//   PUT /api/inbound-plans → inbound_plans テーブルを全置換
//   PUT /api/suppliers    → suppliers テーブルを全置換

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

interface Supplier {
  id: string;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  leadTimeDays: number;
  note: string;
  active: boolean;
}

interface Lot {
  id: string;
  lotNo: string;
  expiryDate?: string;
  quantity: number;
  warehouseId: string;
  unitPrice?: number;
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
  unitPrice?: number;
  supplierId?: string;
}

interface InboundPlan {
  id: string;
  productId: string;
  expectedDate: string;
  quantity: number;
  receivedQuantity: number;
  warehouseId: string;
  lotNo: string;
  expiryDate?: string;
  supplierId: string;
  supplier?: string; // 仕入先マスタ導入前の自由入力 (フロントが supplierId へ移行する)
  unitPrice: number;
  note: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
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
  unit_price: number | null;
}

interface InboundPlanRow {
  id: string;
  product_id: string;
  expected_date: string;
  quantity: number;
  received_quantity: number;
  warehouse_id: string;
  lot_no: string;
  expiry_date: string | null;
  supplier: string;
  supplier_id: string | null;
  unit_price: number;
  note: string;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SupplierRow {
  id: string;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  lead_time_days: number;
  note: string;
  active: number;
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
  unit_price: number | null;
  supplier_id: string | null;
}

async function readState(db: D1Database) {
  const [productsRes, lotsRes, warehousesRes, categoriesRes, txnsRes, plansRes, suppliersRes] = await db.batch([
    db.prepare('SELECT id, name, sku, jan_code, category_id, min_quantity, price, cost_price, updated_at FROM products'),
    db.prepare('SELECT id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price FROM lots'),
    db.prepare('SELECT id, name, color FROM warehouses'),
    db.prepare('SELECT id, name FROM categories'),
    db.prepare('SELECT id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id FROM stock_transactions ORDER BY date DESC'),
    db.prepare('SELECT id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, created_at, updated_at FROM inbound_plans ORDER BY expected_date'),
    db.prepare('SELECT id, name, code, contact, phone, email, address, lead_time_days, note, active FROM suppliers ORDER BY name'),
  ]);

  const lotsByProduct = new Map<string, Lot[]>();
  for (const r of lotsRes.results as unknown as LotRow[]) {
    const lot: Lot = {
      id: r.id,
      lotNo: r.lot_no,
      quantity: r.quantity,
      warehouseId: r.warehouse_id,
      ...(r.expiry_date != null ? { expiryDate: r.expiry_date } : {}),
      ...(r.unit_price != null ? { unitPrice: r.unit_price } : {}),
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
    ...(r.unit_price != null ? { unitPrice: r.unit_price } : {}),
    ...(r.supplier_id != null ? { supplierId: r.supplier_id } : {}),
  }));

  const inboundPlans: InboundPlan[] = (plansRes.results as unknown as InboundPlanRow[]).map(r => ({
    id: r.id,
    productId: r.product_id,
    expectedDate: r.expected_date,
    quantity: r.quantity,
    receivedQuantity: r.received_quantity,
    warehouseId: r.warehouse_id,
    lotNo: r.lot_no,
    ...(r.expiry_date != null ? { expiryDate: r.expiry_date } : {}),
    supplierId: r.supplier_id ?? '',
    // 仕入先マスタ導入前の行 (supplier_id が NULL) は自由入力の名前を渡し、
    // フロントの migrateInboundPlans にマスタへ対応付けてもらう
    ...(r.supplier_id == null && r.supplier ? { supplier: r.supplier } : {}),
    unitPrice: r.unit_price,
    note: r.note,
    ...(r.canceled_at != null ? { canceledAt: r.canceled_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const suppliers: Supplier[] = (suppliersRes.results as unknown as SupplierRow[]).map(r => ({
    id: r.id,
    name: r.name,
    code: r.code,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    address: r.address,
    leadTimeDays: r.lead_time_days,
    note: r.note,
    active: r.active !== 0,
  }));

  return { products, warehouses, categories, ledger, inboundPlans, suppliers };
}

// products + lots を全置換 (batch はトランザクションとして実行される)
// lots → products の順で削除して外部キー違反を避ける
async function replaceProducts(db: D1Database, products: Product[]) {
  const stmts = [db.prepare('DELETE FROM lots'), db.prepare('DELETE FROM products')];
  const insertProduct = db.prepare(
    'INSERT INTO products (id, name, sku, jan_code, category_id, min_quantity, price, cost_price, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertLot = db.prepare(
    'INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of products) {
    stmts.push(insertProduct.bind(p.id, p.name, p.sku, p.janCode || null, p.categoryId, p.minQuantity, p.price, p.costPrice, p.updatedAt));
  }
  for (const p of products) {
    for (const l of p.lots) {
      stmts.push(insertLot.bind(l.id, p.id, l.lotNo, l.expiryDate ?? null, l.quantity, l.warehouseId, l.unitPrice ?? null));
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
    'INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const t of ledger) {
    stmts.push(insert.bind(t.id, t.date, t.type, t.productId, t.productName, t.productSku, t.lotNo, t.quantity, t.note, t.fromWarehouseId ?? null, t.toWarehouseId ?? null, t.unitPrice ?? null, t.supplierId ?? null));
  }
  await db.batch(stmts);
}

// 旧 supplier 列 (自由入力) は列自体を残しつつ空文字で保存する。
// 保存されるのはフロントが仕入先マスタへ移行し終えた状態なので、名前は suppliers 側にある
async function replaceInboundPlans(db: D1Database, plans: InboundPlan[]) {
  const stmts = [db.prepare('DELETE FROM inbound_plans')];
  const insert = db.prepare(
    'INSERT INTO inbound_plans (id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of plans) {
    stmts.push(insert.bind(p.id, p.productId, p.expectedDate, p.quantity, p.receivedQuantity, p.warehouseId, p.lotNo, p.expiryDate ?? null, '', p.supplierId ?? '', p.unitPrice ?? 0, p.note, p.canceledAt ?? null, p.createdAt, p.updatedAt));
  }
  await db.batch(stmts);
}

// suppliers を全置換。inbound_plans が supplier_id で参照するが外部キーは張っていないので
// (products / warehouses と同じ理由)、そのまま削除→再挿入できる
async function replaceSuppliers(db: D1Database, suppliers: Supplier[]) {
  const stmts = [db.prepare('DELETE FROM suppliers')];
  const insert = db.prepare(
    'INSERT INTO suppliers (id, name, code, contact, phone, email, address, lead_time_days, note, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const s of suppliers) {
    stmts.push(insert.bind(s.id, s.name, s.code, s.contact, s.phone, s.email, s.address, s.leadTimeDays, s.note, s.active ? 1 : 0));
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
        case '/api/inbound-plans':
          await replaceInboundPlans(env.DB, await request.json<InboundPlan[]>());
          return Response.json({ ok: true });
        case '/api/suppliers':
          await replaceSuppliers(env.DB, await request.json<Supplier[]>());
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
