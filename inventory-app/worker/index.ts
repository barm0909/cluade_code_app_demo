// Cloudflare Worker: /api/* で D1 を読み書きし、それ以外は静的アセット (dist/) にフォールバックする
// ローカル開発 (wrangler dev) では .wrangler/state のローカルD1、デプロイ後はリモートD1 に同じコードで接続される
//
// API 設計:
//   GET  /api/state   → 全データ (products, warehouses, categories, ledger, inboundPlans, suppliers, customers, …) をまとめて返す
//   POST /api/changes → 変わったレコードだけを { [スライス名]: { upsert: [...], delete: [id...] } } で受け取り、
//                       1トランザクションで書く (差分保存。スライス名はフロントの persist() と同じ)

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
  closingDay?: number; // 31 = 末日、0 = 都度請求
  paymentMonths?: number;
  paymentDay?: number; // 31 = 末日
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
  balanceForward?: { previousBilled: number; received: number; carryOver: number }; // 繰越型の請求書だけ
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
  has_balance_forward: number;
  previous_billed: number;
  received: number;
  carry_over: number;
}

// 入金。1回の入金 (receiptId) を充てた請求書ごとに1行に分けて持つ。documentId '' は未消込
type PaymentMethod = '振込' | '現金' | '手形' | '相殺' | 'その他';

interface PaymentItem {
  id: string;
  receiptId: string;
  customerId: string;
  paymentDate: string;
  method: PaymentMethod;
  documentId: string;
  documentNo: string;
  amount: number;
  fee: number;
  note: string;
  createdAt: string;
}

interface PaymentItemRow {
  id: string;
  receipt_id: string;
  customer_id: string;
  payment_date: string;
  method: PaymentMethod;
  document_id: string;
  document_no: string;
  amount: number;
  fee: number;
  note: string;
  created_at: string;
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
  closing_day: number;
  payment_months: number;
  payment_day: number;
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
  const [productsRes, lotsRes, warehousesRes, categoriesRes, txnsRes, plansRes, suppliersRes, poPrintsRes, customersRes, salesOrdersRes, salesDocsRes, paymentsRes, ...revResults] = await db.batch([
    db.prepare('SELECT id, name, sku, jan_code, category_id, min_quantity, price, cost_price, tax_rate, kind, updated_at FROM products'),
    db.prepare('SELECT id, product_id, lot_no, expiry_date, quantity, warehouse_id, unit_price FROM lots'),
    db.prepare('SELECT id, name, color FROM warehouses'),
    db.prepare('SELECT id, name FROM categories'),
    db.prepare('SELECT id, date, type, product_id, product_name, product_sku, lot_no, quantity, note, from_warehouse_id, to_warehouse_id, unit_price, supplier_id, customer_id, cost_unit_price, tax_rate, return_of_txn_id FROM stock_transactions ORDER BY date DESC'),
    db.prepare('SELECT id, product_id, expected_date, quantity, received_quantity, warehouse_id, lot_no, expiry_date, supplier, supplier_id, unit_price, note, canceled_at, printed_at, created_at, updated_at FROM inbound_plans ORDER BY expected_date'),
    db.prepare('SELECT id, name, code, contact, phone, email, address, lead_time_days, note, active FROM suppliers ORDER BY name'),
    db.prepare('SELECT id, print_group_id, printed_at, supplier_id, supplier_name, supplier_address, supplier_contact, supplier_phone, order_date, sender_name, sender_address, sender_phone, sender_contact, inbound_plan_id, product_name, product_sku, expected_date, quantity, unit_price, amount FROM purchase_order_prints ORDER BY printed_at DESC'),
    db.prepare('SELECT id, name, code, contact, phone, email, address, note, active, closing_day, payment_months, payment_day FROM customers ORDER BY name'),
    db.prepare('SELECT id, customer_id, product_id, expected_date, quantity, shipped_quantity, unit_price, warehouse_id, note, canceled_at, created_at, updated_at FROM sales_orders ORDER BY expected_date'),
    db.prepare('SELECT id, document_id, kind, document_no, issued_at, issue_date, customer_id, customer_name, customer_address, customer_contact, period_from, period_to, due_date, issuer_name, issuer_address, issuer_phone, issuer_contact, issuer_registration_no, issuer_bank_account, line_no, delivery_date, product_name, product_sku, quantity, unit_price, amount, tax_rate, txn_ids, has_balance_forward, previous_billed, received, carry_over FROM sales_document_items ORDER BY issued_at DESC, line_no'),
    db.prepare('SELECT id, receipt_id, customer_id, payment_date, method, document_id, document_no, amount, fee, note, created_at FROM payment_items ORDER BY payment_date DESC, created_at DESC'),
    // 各レコードの rev (同時編集の衝突検知用)。内容と同じバッチ (= 同じ時点) で読まないと、rev だけ新しくなりうる
    ...REV_SLICES.map(slice => db.prepare(`SELECT id, rev FROM ${sliceTable(slice)}`)),
  ]);
  const revs = Object.fromEntries(REV_SLICES.map((slice, i) =>
    [slice, Object.fromEntries((revResults[i].results as unknown as { id: string; rev: number }[]).map(row => [row.id, row.rev]))]));

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
    closingDay: r.closing_day,
    paymentMonths: r.payment_months,
    paymentDay: r.payment_day,
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
    ...(r.has_balance_forward
      ? { balanceForward: { previousBilled: r.previous_billed, received: r.received, carryOver: r.carry_over } }
      : {}),
  }));

  const paymentItems: PaymentItem[] = (paymentsRes.results as unknown as PaymentItemRow[]).map(r => ({
    id: r.id,
    receiptId: r.receipt_id,
    customerId: r.customer_id,
    paymentDate: r.payment_date,
    method: r.method,
    documentId: r.document_id,
    documentNo: r.document_no,
    amount: r.amount,
    fee: r.fee,
    note: r.note,
    createdAt: r.created_at,
  }));

  return { products, warehouses, categories, ledger, inboundPlans, suppliers, purchaseOrderPrints, customers, salesOrders, salesDocumentItems, paymentItems, revs };
}

// ---- 保存: POST /api/changes (差分保存) ----
// フロントは「変わったレコードだけ」をスライスごとに { upsert, delete } で送ってくる。
// 1回のリクエストは1つの操作 (例: 出庫 = ロットの数量 + 帳票の行) の変更すべてで、db.batch で
// 1トランザクションとして書く。途中で失敗すれば全部なかったことになるので、在庫と帳票がずれない。
//
// 追加・更新は INSERT ... ON CONFLICT(id) DO UPDATE。INSERT OR REPLACE は products.sku や
// categories.name の UNIQUE に別の行がぶつかったとき、その別の行を黙って消してしまうので使わない
// (UPSERT ならエラーになり、トランザクションごと失敗してフロントに知らせられる)。

/** テーブル1つ分の書き方。columns と values は同じ順に並べ、先頭は必ず id */
interface TableDef<T> {
  table: string;
  columns: string[];
  values: (item: T) => unknown[];
}

/**
 * 追加・更新の SQL。versioned (rev を持つテーブル) なら、更新のたびに rev を +1 し (新しい行は既定の 0)、
 * 書いた後の rev を RETURNING で返す (フロントが次の送信の base にする)
 */
function upsertSql<T>(def: TableDef<T>, versioned = true): string {
  const updates = def.columns.slice(1).map(c => `${c} = excluded.${c}`);
  if (versioned) updates.push(`rev = ${def.table}.rev + 1`);
  return `INSERT INTO ${def.table} (${def.columns.join(', ')}) VALUES (${def.columns.map(() => '?').join(', ')}) `
    + `ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}${versioned ? ' RETURNING id, rev' : ''}`;
}

const PRODUCTS: TableDef<Product> = {
  table: 'products',
  columns: ['id', 'name', 'sku', 'jan_code', 'category_id', 'min_quantity', 'price', 'cost_price', 'tax_rate', 'kind', 'updated_at'],
  values: p => [p.id, p.name, p.sku, p.janCode || null, p.categoryId, p.minQuantity, p.price, p.costPrice, p.taxRate ?? 8, p.kind === '資材' ? '資材' : '販売品', p.updatedAt],
};

const LOTS: TableDef<Lot & { productId: string }> = {
  table: 'lots',
  columns: ['id', 'product_id', 'lot_no', 'expiry_date', 'quantity', 'warehouse_id', 'unit_price'],
  values: l => [l.id, l.productId, l.lotNo, l.expiryDate ?? null, l.quantity, l.warehouseId, l.unitPrice ?? null],
};

const WAREHOUSES: TableDef<Warehouse> = {
  table: 'warehouses',
  columns: ['id', 'name', 'color'],
  values: w => [w.id, w.name, w.color],
};

const CATEGORIES: TableDef<Category> = {
  table: 'categories',
  columns: ['id', 'name'],
  values: c => [c.id, c.name],
};

const LEDGER: TableDef<StockTransaction> = {
  table: 'stock_transactions',
  columns: ['id', 'date', 'type', 'product_id', 'product_name', 'product_sku', 'lot_no', 'quantity', 'note', 'from_warehouse_id', 'to_warehouse_id', 'unit_price', 'supplier_id', 'customer_id', 'cost_unit_price', 'tax_rate', 'return_of_txn_id'],
  values: t => [t.id, t.date, t.type, t.productId, t.productName, t.productSku, t.lotNo, t.quantity, t.note, t.fromWarehouseId ?? null, t.toWarehouseId ?? null, t.unitPrice ?? null, t.supplierId ?? null, t.customerId ?? null, t.costUnitPrice ?? null, t.taxRate ?? null, t.returnOfTxnId ?? null],
};

// 旧 supplier 列 (自由入力) は列自体を残しつつ空文字で保存する。
// 保存されるのはフロントが仕入先マスタへ移行し終えた状態なので、名前は suppliers 側にある
const INBOUND_PLANS: TableDef<InboundPlan> = {
  table: 'inbound_plans',
  columns: ['id', 'product_id', 'expected_date', 'quantity', 'received_quantity', 'warehouse_id', 'lot_no', 'expiry_date', 'supplier', 'supplier_id', 'unit_price', 'note', 'canceled_at', 'printed_at', 'created_at', 'updated_at'],
  values: p => [p.id, p.productId, p.expectedDate, p.quantity, p.receivedQuantity, p.warehouseId, p.lotNo, p.expiryDate ?? null, '', p.supplierId ?? '', p.unitPrice ?? 0, p.note, p.canceledAt ?? null, p.printedAt ?? null, p.createdAt, p.updatedAt],
};

const SUPPLIERS: TableDef<Supplier> = {
  table: 'suppliers',
  columns: ['id', 'name', 'code', 'contact', 'phone', 'email', 'address', 'lead_time_days', 'note', 'active'],
  values: s => [s.id, s.name, s.code, s.contact, s.phone, s.email, s.address, s.leadTimeDays, s.note, s.active ? 1 : 0],
};

const CUSTOMERS: TableDef<Customer> = {
  table: 'customers',
  columns: ['id', 'name', 'code', 'contact', 'phone', 'email', 'address', 'note', 'active', 'closing_day', 'payment_months', 'payment_day'],
  values: c => [c.id, c.name, c.code, c.contact, c.phone, c.email, c.address, c.note, c.active ? 1 : 0, c.closingDay ?? 31, c.paymentMonths ?? 1, c.paymentDay ?? 31],
};

const SALES_ORDERS: TableDef<SalesOrder> = {
  table: 'sales_orders',
  columns: ['id', 'customer_id', 'product_id', 'expected_date', 'quantity', 'shipped_quantity', 'unit_price', 'warehouse_id', 'note', 'canceled_at', 'created_at', 'updated_at'],
  values: o => [o.id, o.customerId, o.productId, o.expectedDate, o.quantity, o.shippedQuantity, o.unitPrice ?? 0, o.warehouseId ?? '', o.note, o.canceledAt ?? null, o.createdAt, o.updatedAt],
};

const PURCHASE_ORDER_PRINTS: TableDef<PurchaseOrderPrintItem> = {
  table: 'purchase_order_prints',
  columns: ['id', 'print_group_id', 'printed_at', 'supplier_id', 'supplier_name', 'supplier_address', 'supplier_contact', 'supplier_phone', 'order_date', 'sender_name', 'sender_address', 'sender_phone', 'sender_contact', 'inbound_plan_id', 'product_name', 'product_sku', 'expected_date', 'quantity', 'unit_price', 'amount'],
  values: p => [
    p.id, p.printGroupId, p.printedAt, p.supplierId, p.supplierName, p.supplierAddress, p.supplierContact, p.supplierPhone,
    p.orderDate, p.senderName, p.senderAddress, p.senderPhone, p.senderContact,
    p.inboundPlanId, p.productName, p.productSku, p.expectedDate, p.quantity, p.unitPrice, p.amount,
  ],
};

const SALES_DOCUMENTS: TableDef<SalesDocumentItem> = {
  table: 'sales_document_items',
  columns: ['id', 'document_id', 'kind', 'document_no', 'issued_at', 'issue_date', 'customer_id', 'customer_name', 'customer_address', 'customer_contact', 'period_from', 'period_to', 'due_date', 'issuer_name', 'issuer_address', 'issuer_phone', 'issuer_contact', 'issuer_registration_no', 'issuer_bank_account', 'line_no', 'delivery_date', 'product_name', 'product_sku', 'quantity', 'unit_price', 'amount', 'tax_rate', 'txn_ids', 'has_balance_forward', 'previous_billed', 'received', 'carry_over'],
  values: i => [
    i.id, i.documentId, i.kind, i.documentNo, i.issuedAt, i.issueDate,
    i.customerId, i.customerName, i.customerAddress, i.customerContact,
    i.periodFrom, i.periodTo, i.dueDate ?? '',
    i.issuerName, i.issuerAddress, i.issuerPhone, i.issuerContact, i.issuerRegistrationNo, i.issuerBankAccount ?? '',
    i.lineNo, i.deliveryDate, i.productName, i.productSku, i.quantity, i.unitPrice, i.amount, i.taxRate,
    JSON.stringify(i.txnIds ?? []),
    i.balanceForward ? 1 : 0,
    i.balanceForward?.previousBilled ?? 0, i.balanceForward?.received ?? 0, i.balanceForward?.carryOver ?? 0,
  ],
};

const PAYMENTS: TableDef<PaymentItem> = {
  table: 'payment_items',
  columns: ['id', 'receipt_id', 'customer_id', 'payment_date', 'method', 'document_id', 'document_no', 'amount', 'fee', 'note', 'created_at'],
  values: p => [p.id, p.receiptId, p.customerId, p.paymentDate, p.method, p.documentId ?? '', p.documentNo ?? '', p.amount, p.fee ?? 0, p.note ?? '', p.createdAt],
};

/** products 以外のスライス名 → テーブル (スライス名はフロントの persist() と同じ) */
// (レコードの型はテーブルごとに違うので、ここでは any でまとめる)
const SIMPLE_TABLES: Record<string, TableDef<any>> = {
  warehouses: WAREHOUSES,
  categories: CATEGORIES,
  ledger: LEDGER,
  'inbound-plans': INBOUND_PLANS,
  suppliers: SUPPLIERS,
  customers: CUSTOMERS,
  'sales-orders': SALES_ORDERS,
  'purchase-order-prints': PURCHASE_ORDER_PRINTS,
  'sales-documents': SALES_DOCUMENTS,
  payments: PAYMENTS,
};

// 削除は参照する側 → 参照される側、追加・更新は参照される側 → 参照する側の順に並べる
// (外部キーは lots → products / warehouses、products → categories。どのみち検査はトランザクションの最後まで遅らせる)
const DELETE_ORDER = ['ledger', 'inbound-plans', 'sales-orders', 'purchase-order-prints', 'sales-documents', 'payments', 'suppliers', 'customers', 'categories', 'warehouses'];
const UPSERT_PARENTS = ['warehouses', 'categories', 'suppliers', 'customers'];
const UPSERT_CHILDREN = ['ledger', 'inbound-plans', 'sales-orders', 'purchase-order-prints', 'sales-documents', 'payments'];

/** rev を持つスライス (= 全スライス。ロットは商品の rev が兼ねる) */
const REV_SLICES = ['products', ...Object.keys(SIMPLE_TABLES)];

function sliceTable(slice: string): string {
  return slice === 'products' ? PRODUCTS.table : SIMPLE_TABLES[slice].table;
}

interface SliceChange {
  upsert?: { id: string }[];
  delete?: string[];
  /** 更新・削除する既存レコードの id → フロントが最後に見た rev (同時編集の衝突検知)。旧フロントは送らない */
  base?: Record<string, number>;
}
type ChangeSet = Record<string, SliceChange>;

/** リクエストの形が正しいか (知らないスライス名、id のないレコードは受け付けない) */
function changeSetError(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  for (const [slice, change] of Object.entries(body as Record<string, unknown>)) {
    if (slice !== 'products' && !(slice in SIMPLE_TABLES)) return `unknown slice: ${slice}`;
    if (!change || typeof change !== 'object') return `invalid change for ${slice}`;
    const { upsert = [], delete: deletes = [], base = {} } = change as SliceChange;
    if (!Array.isArray(upsert) || !Array.isArray(deletes)) return `invalid change for ${slice}`;
    if (upsert.some(r => !r || typeof r.id !== 'string' || !r.id)) return `record without id in ${slice}`;
    if (deletes.some(id => typeof id !== 'string')) return `invalid delete id in ${slice}`;
    if (!base || typeof base !== 'object' || Array.isArray(base) || Object.values(base).some(v => !Number.isInteger(v))) {
      return `invalid base in ${slice}`;
    }
  }
  return '';
}

// ---- 同時編集の衝突検知 ----
// フロントは既存レコードの更新・削除に「最後に見た rev」(base) を付けてくる。今の rev と違う
// (= 別の端末が先に変えた) レコードがあれば、変更全体を書かずに 409 を返す。
// - 更新: 行が消えている、または rev が違えば衝突
// - 削除: 行があって rev が違えば衝突 (もう消えているなら、消したいという目的は果たされているので通す)
// 判定はバッチの先頭で行う。衝突があると save_conflict_guard の CHECK に引っかかり、バッチ全体
// (= 1トランザクション) が取り消されるので、判定と書き込みの間に別の書き込みが割り込むことはない。

/** base を json_each で読める形にする: [{ id, r: rev, d: 削除なら1 }] */
function baseJson(change: SliceChange): string {
  const deletes = new Set(change.delete ?? []);
  return JSON.stringify(Object.entries(change.base ?? {}).map(([id, rev]) => ({ id, r: rev, d: deletes.has(id) ? 1 : 0 })));
}

/** 衝突しているレコードの id を返す SELECT (?1 = baseJson) */
function conflictSelect(table: string): string {
  return `SELECT json_extract(j.value, '$.id') AS id FROM json_each(?1) AS j `
    + `LEFT JOIN ${table} AS t ON t.id = json_extract(j.value, '$.id') `
    + `WHERE CASE WHEN t.id IS NULL THEN json_extract(j.value, '$.d') = 0 ELSE t.rev <> json_extract(j.value, '$.r') END`;
}

const CONFLICT_MARK = 'save_conflict';

function guardStatements(db: D1Database, changes: ChangeSet): D1PreparedStatement[] {
  return Object.entries(changes)
    .filter(([, change]) => Object.keys(change.base ?? {}).length > 0)
    .map(([slice, change]) => db.prepare(
      `INSERT INTO save_conflict_guard (ok) SELECT 0 FROM (${conflictSelect(sliceTable(slice))}) LIMIT 1`,
    ).bind(baseJson(change)));
}

/** 409 の本文用: スライス → 衝突したレコードの id (トランザクションの外で読むので、目安) */
async function findConflicts(db: D1Database, changes: ChangeSet): Promise<Record<string, string[]>> {
  const conflicts: Record<string, string[]> = {};
  for (const [slice, change] of Object.entries(changes)) {
    if (Object.keys(change.base ?? {}).length === 0) continue;
    const { results } = await db.prepare(conflictSelect(sliceTable(slice))).bind(baseJson(change)).all<{ id: string }>();
    if (results.length > 0) conflicts[slice] = results.map(r => r.id);
  }
  return conflicts;
}

interface ChangePlan {
  stmts: D1PreparedStatement[];
  /** stmts の何番目が、どのスライスの RETURNING id, rev を返すか */
  returning: { index: number; slice: string }[];
}

function changeStatements(db: D1Database, changes: ChangeSet): ChangePlan {
  const stmts: D1PreparedStatement[] = [];
  const returning: { index: number; slice: string }[] = [];
  const push = (stmt: D1PreparedStatement, slice?: string) => {
    if (slice) returning.push({ index: stmts.length, slice });
    stmts.push(stmt);
  };
  const deleteLotsOf = db.prepare('DELETE FROM lots WHERE product_id = ?');

  // 0. 衝突の判定 (衝突があればここでバッチ全体が止まる)
  guardStatements(db, changes).forEach(s => push(s));

  // 1. 削除
  for (const id of changes.products?.delete ?? []) {
    push(deleteLotsOf.bind(id));
    push(db.prepare('DELETE FROM products WHERE id = ?').bind(id));
  }
  for (const slice of DELETE_ORDER) {
    const ids = changes[slice]?.delete ?? [];
    if (ids.length === 0) continue;
    const del = db.prepare(`DELETE FROM ${SIMPLE_TABLES[slice].table} WHERE id = ?`);
    for (const id of ids) push(del.bind(id));
  }

  // 2. 追加・更新
  const upsertAll = (slice: string) => {
    const rows = changes[slice]?.upsert ?? [];
    if (rows.length === 0) return;
    const def = SIMPLE_TABLES[slice];
    const stmt = db.prepare(upsertSql(def));
    for (const row of rows) push(stmt.bind(...def.values(row)), slice);
  };
  UPSERT_PARENTS.forEach(upsertAll);
  const products = (changes.products?.upsert ?? []) as Product[];
  if (products.length > 0) {
    const upsertProduct = db.prepare(upsertSql(PRODUCTS));
    const insertLot = db.prepare(upsertSql(LOTS, false));
    for (const p of products) {
      // 商品のロットは商品ごと丸ごと書き直す (減ったロット・空にしたロットの削除も兼ねる)
      push(upsertProduct.bind(...PRODUCTS.values(p)), 'products');
      push(deleteLotsOf.bind(p.id));
      for (const l of p.lots ?? []) push(insertLot.bind(...LOTS.values({ ...l, productId: p.id })));
    }
  }
  UPSERT_CHILDREN.forEach(upsertAll);

  // 外部キーの検査はトランザクションの最後まで遅らせる (同じ変更の中で親と子を両方書くため)
  if (stmts.length === 0) return { stmts: [], returning: [] };
  return {
    stmts: [db.prepare('PRAGMA defer_foreign_keys = on'), ...stmts],
    returning: returning.map(r => ({ ...r, index: r.index + 1 })),
  };
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return Response.json(await readState(env.DB));
    }
    if (request.method === 'POST' && url.pathname === '/api/changes') {
      const body = await request.json();
      const error = changeSetError(body);
      if (error) return Response.json({ error }, { status: 400 });
      const changes = body as ChangeSet;
      const { stmts, returning } = changeStatements(env.DB, changes);
      const revs: Record<string, Record<string, number>> = {};
      if (stmts.length > 0) {
        let results: D1Result[];
        try {
          // batch は1トランザクション。1文でも失敗すれば (衝突の判定も含めて) 全部取り消される
          results = await env.DB.batch(stmts);
        } catch (err) {
          if (!String(err).includes(CONFLICT_MARK)) throw err;
          return Response.json({ error: 'conflict', conflicts: await findConflicts(env.DB, changes) }, { status: 409 });
        }
        for (const { index, slice } of returning) {
          for (const row of results[index].results as { id: string; rev: number }[]) {
            (revs[slice] ??= {})[row.id] = row.rev;
          }
        }
      }
      return Response.json({ ok: true, revs });
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
