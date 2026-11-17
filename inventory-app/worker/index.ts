// Cloudflare Worker: /api/* で D1 を読み書きし、それ以外は静的アセット (dist/) にフォールバックする
// ローカル開発 (wrangler dev) では .wrangler/state のローカルD1、デプロイ後はリモートD1 に同じコードで接続される
//
// API 設計はフロント (useInventory.ts) の「スライス単位で全量保存」に合わせている:
//   GET /api/state        → { products, warehouses, categories, ledger, inboundPlans, suppliers, customers } をまとめて返す
//   PUT /api/products     → products + lots テーブルを全置換
//   PUT /api/warehouses   → warehouses テーブルを全置換
//   PUT /api/categories   → categories テーブルを全置換
//   PUT /api/ledger       → stock_transactions テーブルを全置換
//   PUT /api/inbound-plans → inbound_plans テーブルを全置換
//   PUT /api/suppliers    → suppliers テーブルを全置換
//   PUT /api/purchase-order-prints → purchase_order_prints テーブルを全置換
//   PUT /api/customers    → customers テーブルを全置換
//   PUT /api/sales-orders → sales_orders テーブルを全置換
//   PUT /api/sales-documents → sales_document_items テーブルを全置換 (納品書・請求書の発行履歴)

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

// 得意先マスタ。売上出庫の記録が customer_id で参照する (仕入先と対になるマスタ)
interface Customer {
  id: string;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
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
  price: number; // 販売定価 (税抜)
  costPrice: number;
  taxRate?: number; // 消費税率 (%)。8 = 軽減税率 / 10 = 標準税率
  kind?: string; // 商品区分。販売品 / 資材
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
  customerId?: string; // 売上出庫の売り先
  costUnitPrice?: number; // 売上出庫したロットの原価 (粗利の計算に使う)
  taxRate?: number; // 売上出庫した時点の消費税率 (%)
  returnOfTxnId?: string; // 返品 (売上返品・仕入返品) の元取引の id
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
  printedAt?: string; // 発注書として印刷した日時。未設定なら未印刷
  createdAt: string;
  updatedAt: string;
}

// 受注 (出荷予定)。入荷予定の販売側の対で、出荷すると売上出庫として帳票に残る
interface SalesOrder {
  id: string;
  customerId: string;
  productId: string;
  expectedDate: string;
  quantity: number;
  shippedQuantity: number;
  unitPrice: number; // 受注単価 (税抜)。0 は未入力
  warehouseId: string; // 出荷元倉庫。空文字は全倉庫
  note: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
}

// 発注書の印刷履歴。1回の印刷操作 (= 1枚の発注書) につき、印刷した明細の数だけ行を持つ
// (stock_transactions と同じ「1件1行、必要な情報をそのまま持たせる」方針)
interface PurchaseOrderPrintItem {
  id: string;
  printGroupId: string;
  printedAt: string;
  supplierId: string;
  supplierName: string;
  supplierAddress: string;
  supplierContact: string;
  supplierPhone: string;
  orderDate: string;
  senderName: string;
  senderAddress: string;
  senderPhone: string;
  senderContact: string;
  inboundPlanId: string;
  productName: string;
  productSku: string;
  expectedDate: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

// 納品書・請求書の発行履歴。1枚の書類につき、載せた明細の数だけ行を持つ (発注書の印刷履歴と同じ方針)
interface SalesDocumentItem {
  id: string;
  documentId: string;
  kind: '納品書' | '請求書';
  documentNo: string;
  issuedAt: string;
  issueDate: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  customerContact: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerContact: string;
  issuerRegistrationNo: string;
  issuerBankAccount: string;
  lineNo: number;
  deliveryDate: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  txnIds: string[];
}

interface SalesDocumentItemRow {
  id: string;
  document_id: string;
  kind: '納品書' | '請求書';
  document_no: string;
  issued_at: string;
  issue_date: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  customer_contact: string;
  period_from: string;
  period_to: string;
  due_date: string;
  issuer_name: string;
  issuer_address: string;
  issuer_phone: string;
  issuer_contact: string;
  issuer_registration_no: string;
  issuer_bank_account: string;
  line_no: number;
  delivery_date: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  txn_ids: string;
}

// txn_ids は JSON 配列の文字列。壊れていても書類自体は表示できるよう空配列に倒す
function parseTxnIds(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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
  tax_rate: number;
  kind: string;
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
  printed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SalesOrderRow {
  id: string;
  customer_id: string;
  product_id: string;
  expected_date: string;
  quantity: number;
  shipped_quantity: number;
  unit_price: number;
  warehouse_id: string;
  note: string;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CustomerRow {
  id: string;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  active: number;
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

interface PurchaseOrderPrintRow {
  id: string;
  print_group_id: string;
  printed_at: string;
  supplier_id: string;
  supplier_name: string;
  supplier_address: string;
  supplier_contact: string;
  supplier_phone: string;
  order_date: string;
  sender_name: string;
  sender_address: string;
  sender_phone: string;
  sender_contact: string;
  inbound_plan_id: string;
  product_name: string;
  product_sku: string;
  expected_date: string;
  quantity: number;
  unit_price: number;
  amount: number;
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
  customer_id: string | null;
  cost_unit_price: number | null;
  tax_rate: number | null;
  return_of_txn_id: string | null;
}

async function readState(db: D1Database) {
  const [productsRes, lotsRes, warehousesRes, categoriesRes, txnsRes, plansRes, suppliersRes, poPrintsRes, customersRes, salesOrdersRes, salesDocsRes] = await db.batch([
    db.prepare('SELECT id, name, sku, jan_code, category_id, min_quantity, price, cost_price, tax_rate, kind, updated_at FROM products'),
    db.prepare('SELECT id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price FROM lots'),
    db.prepare('SELECT id, name, color FROM warehouses'),
    db.prepare('SELECT id, name FROM categories'),
    db.prepare('SELECT id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id, customer_id, cost_unit_price, tax_rate, return_of_txn_id FROM stock_transactions ORDER BY date DESC'),
    db.prepare('SELECT id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, printed_at, created_at, updated_at FROM inbound_plans ORDER BY expected_date'),
    db.prepare('SELECT id, name, code, contact, phone, email, address, lead_time_days, note, active FROM suppliers ORDER BY name'),
    db.prepare('SELECT id, print_group_id, printed_at, supplier_id, supplier_name, supplier_address, supplier_contact, supplier_phone, order_date, sender_name, sender_address, sender_phone, sender_contact, inbound_plan_id, product_name, product_sku, expected_date, quantity, unit_price, amount FROM purchase_order_prints ORDER BY printed_at DESC'),
    db.prepare('SELECT id, name, code, contact, phone, email, address, note, active FROM customers ORDER BY name'),
    db.prepare('SELECT id, customer_id, product_id, expected_date, quantity, shipped_quantity, unit_price, warehouse_id, note, canceled_at, created_at, updated_at FROM sales_orders ORDER BY expected_date'),
    db.prepare('SELECT id, document_id, kind, document_no, issued_at, issue_date, customer_id, customer_name, customer_address, customer_contact, period_from, period_to, due_date, issuer_name, issuer_address, issuer_phone, issuer_contact, issuer_registration_no, issuer_bank_account, line_no, delivery_date, product_name, product_sku, quantity, unit_price, amount, tax_rate, txn_ids FROM sales_document_items ORDER BY issued_at DESC, line_no'),
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
    taxRate: r.tax_rate,
    kind: r.kind,
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
    ...(r.customer_id != null ? { customerId: r.customer_id } : {}),
    ...(r.cost_unit_price != null ? { costUnitPrice: r.cost_unit_price } : {}),
    ...(r.tax_rate != null ? { taxRate: r.tax_rate } : {}),
    ...(r.return_of_txn_id != null ? { returnOfTxnId: r.return_of_txn_id } : {}),
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
    ...(r.printed_at != null ? { printedAt: r.printed_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const suppliers: Supplier[] =(suppliersRes.results as unknown as SupplierRow[]).map(r => ({
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

  const purchaseOrderPrints: PurchaseOrderPrintItem[] = (poPrintsRes.results as unknown as PurchaseOrderPrintRow[]).map(r => ({
    id: r.id,
    printGroupId: r.print_group_id,
    printedAt: r.printed_at,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierAddress: r.supplier_address,
    supplierContact: r.supplier_contact,
    supplierPhone: r.supplier_phone,
    orderDate: r.order_date,
    senderName: r.sender_name,
    senderAddress: r.sender_address,
    senderPhone: r.sender_phone,
    senderContact: r.sender_contact,
    inboundPlanId: r.inbound_plan_id,
    productName: r.product_name,
    productSku: r.product_sku,
    expectedDate: r.expected_date,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    amount: r.amount,
  }));

  const customers: Customer[] = (customersRes.results as unknown as CustomerRow[]).map(r => ({
    id: r.id,
    name: r.name,
    code: r.code,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    address: r.address,
    note: r.note,
    active: r.active !== 0,
  }));

  const salesOrders: SalesOrder[] = (salesOrdersRes.results as unknown as SalesOrderRow[]).map(r => ({
    id: r.id,
    customerId: r.customer_id,
    productId: r.product_id,
    expectedDate: r.expected_date,
    quantity: r.quantity,
    shippedQuantity: r.shipped_quantity,
    unitPrice: r.unit_price,
    warehouseId: r.warehouse_id,
    note: r.note,
    ...(r.canceled_at != null ? { canceledAt: r.canceled_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const salesDocumentItems: SalesDocumentItem[] = (salesDocsRes.results as unknown as SalesDocumentItemRow[]).map(r => ({
    id: r.id,
    documentId: r.document_id,
    kind: r.kind,
    documentNo: r.document_no,
    issuedAt: r.issued_at,
    issueDate: r.issue_date,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerAddress: r.customer_address,
    customerContact: r.customer_contact,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    dueDate: r.due_date,
    issuerName: r.issuer_name,
    issuerAddress: r.issuer_address,
    issuerPhone: r.issuer_phone,
    issuerContact: r.issuer_contact,
    issuerRegistrationNo: r.issuer_registration_no,
    issuerBankAccount: r.issuer_bank_account,
    lineNo: r.line_no,
    deliveryDate: r.delivery_date,
    productName: r.product_name,
    productSku: r.product_sku,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    amount: r.amount,
    taxRate: r.tax_rate,
    txnIds: parseTxnIds(r.txn_ids),
  }));

  return { products, warehouses, categories, ledger, inboundPlans, suppliers, purchaseOrderPrints, customers, salesOrders, salesDocumentItems };
}

// products + lots を全置換 (batch はトランザクションとして実行される)
// lots → products の順で削除して外部キー違反を避ける
async function replaceProducts(db: D1Database, products: Product[]) {
  const stmts = [db.prepare('DELETE FROM lots'), db.prepare('DELETE FROM products')];
  const insertProduct = db.prepare(
    'INSERT INTO products (id, name, sku, jan_code, category_id, min_quantity, price, cost_price, tax_rate, kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertLot = db.prepare(
    'INSERT INTO lots (id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of products) {
    stmts.push(insertProduct.bind(p.id, p.name, p.sku, p.janCode || null, p.categoryId, p.minQuantity, p.price, p.costPrice, p.taxRate ?? 8, p.kind === '資材' ? '資材' : '販売品', p.updatedAt));
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
    'INSERT INTO stock_transactions (id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id, customer_id, cost_unit_price, tax_rate, return_of_txn_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const t of ledger) {
    stmts.push(insert.bind(t.id, t.date, t.type, t.productId, t.productName, t.productSku, t.lotNo, t.quantity, t.note, t.fromWarehouseId ?? null, t.toWarehouseId ?? null, t.unitPrice ?? null, t.supplierId ?? null, t.customerId ?? null, t.costUnitPrice ?? null, t.taxRate ?? null, t.returnOfTxnId ?? null));
  }
  await db.batch(stmts);
}

// 旧 supplier 列 (自由入力) は列自体を残しつつ空文字で保存する。
// 保存されるのはフロントが仕入先マスタへ移行し終えた状態なので、名前は suppliers 側にある
async function replaceInboundPlans(db: D1Database, plans: InboundPlan[]) {
  const stmts = [db.prepare('DELETE FROM inbound_plans')];
  const insert = db.prepare(
    'INSERT INTO inbound_plans (id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, printed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of plans) {
    stmts.push(insert.bind(p.id, p.productId, p.expectedDate, p.quantity, p.receivedQuantity, p.warehouseId, p.lotNo, p.expiryDate ?? null, '', p.supplierId ?? '', p.unitPrice ?? 0, p.note, p.canceledAt ?? null, p.printedAt ?? null, p.createdAt, p.updatedAt));
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

// customers を全置換。stock_transactions が customer_id で参照するが外部キーは張っていないので
// (suppliers と同じ理由)、そのまま削除→再挿入できる
async function replaceCustomers(db: D1Database, customers: Customer[]) {
  const stmts = [db.prepare('DELETE FROM customers')];
  const insert = db.prepare(
    'INSERT INTO customers (id, name, code, contact, phone, email, address, note, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const c of customers) {
    stmts.push(insert.bind(c.id, c.name, c.code, c.contact, c.phone, c.email, c.address, c.note, c.active ? 1 : 0));
  }
  await db.batch(stmts);
}

// sales_orders を全置換 (replaceInboundPlans と同じく外部キーは張らないので、そのまま削除→再挿入できる)
async function replaceSalesOrders(db: D1Database, orders: SalesOrder[]) {
  const stmts = [db.prepare('DELETE FROM sales_orders')];
  const insert = db.prepare(
    'INSERT INTO sales_orders (id, customer_id, product_id, expected_date, quantity, shipped_quantity, unit_price, warehouse_id, note, canceled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const o of orders) {
    stmts.push(insert.bind(o.id, o.customerId, o.productId, o.expectedDate, o.quantity, o.shippedQuantity, o.unitPrice ?? 0, o.warehouseId ?? '', o.note, o.canceledAt ?? null, o.createdAt, o.updatedAt));
  }
  await db.batch(stmts);
}

// purchase_order_prints を全置換。追記専用の履歴だが、他のスライスと同じ
// 「全量取得→全量保存」の方式に合わせている (products / suppliers と同じ理由で外部キーは張らない)
async function replacePurchaseOrderPrints(db: D1Database, prints: PurchaseOrderPrintItem[]) {
  const stmts = [db.prepare('DELETE FROM purchase_order_prints')];
  const insert = db.prepare(
    'INSERT INTO purchase_order_prints (id, print_group_id, printed_at, supplier_id, supplier_name, supplier_address, supplier_contact, supplier_phone, order_date, sender_name, sender_address, sender_phone, sender_contact, inbound_plan_id, product_name, product_sku, expected_date, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of prints) {
    stmts.push(insert.bind(
      p.id, p.printGroupId, p.printedAt, p.supplierId, p.supplierName, p.supplierAddress, p.supplierContact, p.supplierPhone,
      p.orderDate, p.senderName, p.senderAddress, p.senderPhone, p.senderContact,
      p.inboundPlanId, p.productName, p.productSku, p.expectedDate, p.quantity, p.unitPrice, p.amount,
    ));
  }
  await db.batch(stmts);
}

// sales_document_items を全置換。発注書の印刷履歴と同じく追記中心の履歴だが、
// 取消 (書類の削除) もあるので他のスライスと同じ「全量取得→全量保存」に合わせる
async function replaceSalesDocumentItems(db: D1Database, items: SalesDocumentItem[]) {
  const stmts = [db.prepare('DELETE FROM sales_document_items')];
  const insert = db.prepare(
    'INSERT INTO sales_document_items (id, document_id, kind, document_no, issued_at, issue_date, customer_id, customer_name, customer_address, customer_contact, period_from, period_to, due_date, issuer_name, issuer_address, issuer_phone, issuer_contact, issuer_registration_no, issuer_bank_account, line_no, delivery_date, product_name, product_sku, quantity, unit_price, amount, tax_rate, txn_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const i of items) {
    stmts.push(insert.bind(
      i.id, i.documentId, i.kind, i.documentNo, i.issuedAt, i.issueDate,
      i.customerId, i.customerName, i.customerAddress, i.customerContact,
      i.periodFrom, i.periodTo, i.dueDate ?? '',
      i.issuerName, i.issuerAddress, i.issuerPhone, i.issuerContact, i.issuerRegistrationNo, i.issuerBankAccount ?? '',
      i.lineNo, i.deliveryDate, i.productName, i.productSku, i.quantity, i.unitPrice, i.amount, i.taxRate,
      JSON.stringify(i.txnIds ?? []),
    ));
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
        case '/api/customers':
          await replaceCustomers(env.DB, await request.json<Customer[]>());
          return Response.json({ ok: true });
        case '/api/sales-orders':
          await replaceSalesOrders(env.DB, await request.json<SalesOrder[]>());
          return Response.json({ ok: true });
        case '/api/purchase-order-prints':
          await replacePurchaseOrderPrints(env.DB, await request.json<PurchaseOrderPrintItem[]>());
          return Response.json({ ok: true });
        case '/api/sales-documents':
          await replaceSalesDocumentItems(env.DB, await request.json<SalesDocumentItem[]>());
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
