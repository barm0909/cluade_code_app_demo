import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';

export interface Warehouse {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_WAREHOUSE_ID = 'wh-sales';

export interface Category {
  id: string;
  name: string;
}

// 仕入先 (発注先) マスタ。入荷予定が id で参照するので、改名しても過去の予定の紐づけは切れない。
// 取引が終わった仕入先は削除せず active=false にすることで、過去の入荷予定を残したまま
// 新規登録の選択肢から外せる。
export interface Supplier {
  id: string;
  name: string; // 仕入先名 (必須・重複不可)
  code: string; // 仕入先コード (任意・重複不可)。基幹システムの取引先コードなどを想定
  contact: string; // 担当者名
  phone: string;
  email: string;
  address: string;
  leadTimeDays: number; // 標準リードタイム (発注から入荷までの日数)。入荷予定日の既定値に使う
  note: string;
  active: boolean; // 取引中か (false = 取引停止)
}

/** 仕入先の入力値 (id は採番するので含まない) */
export type SupplierInput = Omit<Supplier, 'id'>;

// 得意先 (販売先) マスタ。売上出庫の帳票が id で参照するので、改名しても過去の売上の紐づけは
// 切れない (仕入先マスタと同じ方針)。取引が終わった得意先は削除せず active=false にすることで、
// 過去の売上を残したまま売上登録の選択肢から外せる。
export interface Customer {
  id: string;
  name: string; // 得意先名 (必須・重複不可)
  code: string; // 得意先コード (任意・重複不可)
  contact: string; // 担当者名
  phone: string;
  email: string;
  address: string;
  note: string;
  active: boolean; // 取引中か (false = 取引停止)
}

/** 得意先の入力値 (id は採番するので含まない) */
export type CustomerInput = Omit<Customer, 'id'>;

export interface Lot {
  id: string;
  lotNo: string;
  expiryDate?: string;
  quantity: number;
  warehouseId: string;
  /** このロットの実原価 (円)。未設定なら商品の現在原価 (Product.costPrice) を使う */
  unitPrice?: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  janCode?: string; // JANコード (8桁 or 13桁)。JANのない商品 (自社ラベル等) は未設定
  categoryId: string;
  lots: Lot[];
  minQuantity: number;
  price: number; // 販売定価 (税抜)。資材は売らないので使わない (入力欄も出さない)
  costPrice: number;
  /** 消費税率 (%)。食品は軽減税率 8%、それ以外は標準税率 10%。未設定は productTaxRate で既定値を使う。資材では使わない */
  taxRate?: TaxRate;
  /** 商品区分。販売品 = 売る商品 / 資材 = ラベル等の自社で使うだけのもの。未設定は productKind で 販売品 */
  kind?: ProductKind;
  updatedAt: string;
}

export type TransactionType = '入荷' | '調整入庫' | '売上出庫' | '資材使用' | '調整出庫' | '廃棄' | '移動';

/** 出庫系の区分だけを指す型 (FEFO出庫のように出庫しか受け付けない API 用) */
export type OutboundTransactionType = Extract<TransactionType, '売上出庫' | '資材使用' | '調整出庫' | '廃棄'>;

export const INBOUND_TYPES: TransactionType[] = ['入荷', '調整入庫'];
/** すべての出庫区分。商品ごとに選べる区分は outboundTypesFor で絞る (資材は売上出庫できない等) */
export const OUTBOUND_TYPES: OutboundTransactionType[] = ['売上出庫', '資材使用', '調整出庫', '廃棄'];
export const ALL_TRANSACTION_TYPES: TransactionType[] = [...INBOUND_TYPES, ...OUTBOUND_TYPES, '移動'];

export function transactionDirection(type: TransactionType): 'in' | 'out' | 'move' {
  if (INBOUND_TYPES.includes(type)) return 'in';
  if ((OUTBOUND_TYPES as TransactionType[]).includes(type)) return 'out';
  return 'move';
}

export interface StockTransaction {
  id: string;
  date: string;
  type: TransactionType;
  productId: string;
  productName: string;
  productSku: string;
  lotNo: string;
  quantity: number;
  note: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  /**
   * 単価 (円)。区分によって意味が変わる (区分ごとに1つしか単価を持たないため):
   * - 入荷: 仕入単価 (入荷予定からの入荷だけが持つ)
   * - 廃棄: 廃棄したロットの原価 (一括廃棄だけが持つ)
   * - 売上出庫: 実売単価 (売上登録・FEFO出庫・ロット出庫で入力されたときだけ持つ)
   * それ以外の区分では未設定。
   */
  unitPrice?: number;
  /** 仕入先マスタの id。unitPrice と同じく「入荷予定からの入荷」だけが持つ */
  supplierId?: string;
  /** 得意先マスタの id。「売上出庫」だけが持つ (未設定 = 得意先なしの売上) */
  customerId?: string;
  /**
   * 出庫した時点のロット原価 (円)。「売上出庫」だけが持つ。
   * 売れたロットは在庫から減って原価が分からなくなるため、粗利 (売上金額 - 原価) を
   * あとから再計算できるようその場で写し取る (廃棄ロスが unitPrice を持つのと同じ理由)。
   */
  costUnitPrice?: number;
  /**
   * 出庫した時点の商品の消費税率 (%)。「売上出庫」だけが持つ。
   * 商品の税率はあとから変えられるので、売上の消費税が過去にさかのぼって変わらないようその場で写し取る。
   */
  taxRate?: TaxRate;
}

// 入荷予定 (発注済み・入荷待ちの在庫)。実際の在庫はまだ持たず、入荷して初めてロットになる。
// 分割入荷に対応するため予定数量とは別に入荷済数量を持ち、状態はそこから導出する
// (canceledAt だけは操作の結果として保存する)。
export interface InboundPlan {
  id: string;
  productId: string;
  expectedDate: string; // 入荷予定日 YYYY-MM-DD
  quantity: number; // 予定数量
  receivedQuantity: number; // 入荷済数量 (分割入荷の累計)
  warehouseId: string; // 入荷先倉庫
  lotNo: string; // 予定ロットNo (入荷時の既定値)
  expiryDate?: string; // 予定賞味期限
  supplierId: string; // 仕入先マスタの id。空文字は「仕入先未設定」
  /** @deprecated 仕入先マスタ導入前の自由入力。読み込み時に migrateInboundPlans が supplierId へ移す */
  supplier?: string;
  unitPrice: number; // 仕入単価 (円)。0 は未入力
  note: string;
  canceledAt?: string; // キャンセル日時 (ISO)。未設定なら有効な予定
  printedAt?: string; // 発注書として印刷した日時 (ISO)。未設定なら未印刷
  createdAt: string;
  updatedAt: string;
}

// 発注書の印刷履歴。1回の「印刷」操作 (= 1枚の発注書) につき、印刷した明細の数だけ行を作る
// (stock_transactions と同じ「1件1行、必要な情報は都度そのまま持たせる」方針)。
// printGroupId が同じ行は同じ印刷操作 = 同じ発注書に載っていたことを意味する。
// 商品名・仕入先名などは印刷した時点のスナップショットなので、あとで商品名を改名したり
// 仕入先を編集したりしても、この履歴の表示は変わらない (帳票の過去記録と同じ扱い)。
// 在庫は動かないので stock_transactions には何も書かない。
export interface PurchaseOrderPrintItem {
  id: string;
  printGroupId: string; // 同じ発注書 (1回の印刷) をまとめる id
  printedAt: string; // 印刷日時 (ISO)。同じ printGroupId の行はすべて同じ値
  supplierId: string;
  supplierName: string;
  supplierAddress: string;
  supplierContact: string;
  supplierPhone: string;
  orderDate: string; // 発注書に入力されていた発注日 (YYYY-MM-DD)
  senderName: string; // 発注元 (自社) 情報。当時 localStorage に入っていた内容のスナップショット
  senderAddress: string;
  senderPhone: string;
  senderContact: string;
  inboundPlanId: string; // 元になった入荷予定の id (参考情報。予定が削除されても履歴は残る)
  productName: string;
  productSku: string;
  expectedDate: string;
  quantity: number;
  unitPrice: number;
  amount: number; // quantity * unitPrice
}

export type SortField = 'name' | 'sku' | 'janCode' | 'category' | 'price' | 'costPrice';
export type SortOrder = 'asc' | 'desc';

// 帳票 (入出庫) の絞り込み条件。空文字は「その条件では絞らない」を意味する
export interface LedgerFilter {
  keyword: string; // 商品名・SKU・ロットNo の部分一致
  from: string; // YYYY-MM-DD (この日を含む)
  to: string; // YYYY-MM-DD (この日を含む)
  type: TransactionType | '';
  warehouseId: string; // 移動元・移動先のどちらかに一致すればヒット
}

export const EMPTY_LEDGER_FILTER: LedgerFilter = { keyword: '', from: '', to: '', type: '', warehouseId: '' };

// txn.date は UTC の ISO 文字列だが帳票の表示は端末のローカル時刻。
// 日付での絞り込みも表示と食い違わないようローカル日付に直してから比較する。
export function localDateKey(iso: string): string {
  const dt = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function formatLedgerDateTime(iso: string): string {
  const dt = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function filterLedger(txns: StockTransaction[], filter: LedgerFilter): StockTransaction[] {
  const q = filter.keyword.trim().toLowerCase();
  return txns.filter(t => {
    if (q && !(t.productName.toLowerCase().includes(q) || t.productSku.toLowerCase().includes(q) || t.lotNo.toLowerCase().includes(q))) return false;
    if (filter.from || filter.to) {
      const day = localDateKey(t.date);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
    }
    if (filter.type && t.type !== filter.type) return false;
    if (filter.warehouseId && t.fromWarehouseId !== filter.warehouseId && t.toWarehouseId !== filter.warehouseId) return false;
    return true;
  });
}

// 入庫は正、出庫は負。移動は総在庫を増減させないので符号なし
export function signedQuantity(txn: StockTransaction): number {
  return transactionDirection(txn.type) === 'out' ? -txn.quantity : txn.quantity;
}

export function ledgerTotals(txns: StockTransaction[]): { inbound: number; outbound: number; move: number } {
  const totals = { inbound: 0, outbound: 0, move: 0 };
  for (const t of txns) {
    const dir = transactionDirection(t.type);
    if (dir === 'in') totals.inbound += t.quantity;
    else if (dir === 'out') totals.outbound += t.quantity;
    else totals.move += t.quantity;
  }
  return totals;
}

export function daysUntilExpiry(expiryDate: string): number {
  const expiry = Date.parse(expiryDate); // YYYY-MM-DD → UTC midnight
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((expiry - todayUTC) / (1000 * 60 * 60 * 24));
}

export function totalQuantity(product: Product): number {
  return product.lots.reduce((s, l) => s + l.quantity, 0);
}

export function totalQuantityByWarehouse(product: Product, warehouseId: string): number {
  return product.lots.filter(l => l.warehouseId === warehouseId).reduce((s, l) => s + l.quantity, 0);
}

/** ロットに適用する実原価。未設定なら商品の現在原価にフォールバックする */
export function lotUnitCost(lot: Lot, product: Product): number {
  return lot.unitPrice ?? product.costPrice;
}

// ---- 商品区分 (販売品 / 資材) ----
// 資材は値札ラベルのように在庫は管理するが売らないもの。売上の登録・売上出庫の対象にせず、
// 販売定価・税率も持たない。使った分は「資材使用」で出庫する。

export type ProductKind = '販売品' | '資材';
export const PRODUCT_KINDS: ProductKind[] = ['販売品', '資材'];

export function productKind(product: Pick<Product, 'kind'>): ProductKind {
  return product.kind === '資材' ? '資材' : '販売品';
}

export function isMaterial(product: Pick<Product, 'kind'>): boolean {
  return productKind(product) === '資材';
}

/**
 * その商品で選べる出庫区分。販売品は 売上出庫、資材は 資材使用 がそれぞれ既定 (先頭)。
 * 資材は売らないので売上出庫を、販売品は資材ではないので資材使用を選べない。
 */
export function outboundTypesFor(product: Pick<Product, 'kind'>): OutboundTransactionType[] {
  return isMaterial(product)
    ? ['資材使用', '調整出庫', '廃棄']
    : ['売上出庫', '調整出庫', '廃棄'];
}

// ---- 消費税 ----
// 単価 (販売定価・実売単価・原価) はすべて税抜で持ち、消費税と税込金額は計算で出す。
// 税率は商品ごとに 8% (軽減税率: 飲食料品) か 10% (標準税率) のどちらか。

export type TaxRate = 8 | 10;
export const REDUCED_TAX_RATE: TaxRate = 8;
export const STANDARD_TAX_RATE: TaxRate = 10;
export const TAX_RATES: TaxRate[] = [REDUCED_TAX_RATE, STANDARD_TAX_RATE];
/** 税率未設定の商品に使う既定値。食品在庫のアプリなので軽減税率 */
export const DEFAULT_TAX_RATE: TaxRate = REDUCED_TAX_RATE;

export function isTaxRate(value: unknown): value is TaxRate {
  return value === REDUCED_TAX_RATE || value === STANDARD_TAX_RATE;
}

/** 画面・CSV 用の税率表記 (8% は軽減税率であることが分かるように) */
export function taxRateLabel(rate: TaxRate): string {
  return rate === REDUCED_TAX_RATE ? '8%（軽減）' : `${rate}%`;
}

export function productTaxRate(product: Pick<Product, 'taxRate'>): TaxRate {
  return isTaxRate(product.taxRate) ? product.taxRate : DEFAULT_TAX_RATE;
}

/**
 * 税抜金額にかかる消費税 (円)。1円未満は四捨五入。
 * 売上明細1行 (数量 × 単価) ごとに計算し、合計はその足し上げにする (明細ごとの端数処理)。
 */
export function taxAmount(amountExcludingTax: number, rate: TaxRate): number {
  return Math.round(amountExcludingTax * rate / 100);
}

/** 税抜金額 → 税込金額 */
export function withTax(amountExcludingTax: number, rate: TaxRate): number {
  return amountExcludingTax + taxAmount(amountExcludingTax, rate);
}

export interface SaleAmounts {
  amount: number; // 税抜
  tax: number;
  amountWithTax: number;
}

/**
 * 売上登録・FEFO出庫のプレビュー用の金額。売上は引き当てたロットごとに帳票へ1行ずつ記録され、
 * 消費税もその1行ごとに四捨五入される (salesRows) ので、プレビューも同じ単位で計算する。
 * quantities は引当ごとの数量 (FefoPlan.allocations の quantity)。
 */
export function saleAmounts(quantities: number[], unitPrice: number, rate: TaxRate): SaleAmounts {
  let amount = 0;
  let tax = 0;
  for (const q of quantities) {
    amount += unitPrice * q;
    tax += taxAmount(unitPrice * q, rate);
  }
  return { amount, tax, amountWithTax: amount + tax };
}

/**
 * 新しい商品の税率の初期値。同じカテゴリの商品で一番多い税率を引き継ぐ
 * (乳製品なら 8%、ラベルなら 10% のように、カテゴリ内で税率はふつう揃っているため)。
 * カテゴリに商品が無ければ既定値。同数なら軽減税率を優先する。
 */
export function defaultTaxRateForCategory(products: Product[], categoryId: string): TaxRate {
  const counts = new Map<TaxRate, number>();
  for (const p of products) {
    if (p.categoryId !== categoryId) continue;
    const rate = productTaxRate(p);
    counts.set(rate, (counts.get(rate) ?? 0) + 1);
  }
  let best: TaxRate = DEFAULT_TAX_RATE;
  let bestCount = 0;
  for (const rate of TAX_RATES) {
    const count = counts.get(rate) ?? 0;
    if (count > bestCount) { best = rate; bestCount = count; }
  }
  return best;
}

// JANコード入力の正規化: 全角数字を半角へ直し、ハイフン・空白などの区切り文字を除去する
// (IME オンのままの入力やバーコード表記のハイフンで検証に落ちないようにするため)
export function normalizeJanCode(value: string): string {
  return value
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, 13);
}

// 未入力 (未設定) は許可。入力があるときだけ 8桁/13桁 を要求する
export function isValidJanCode(value: string): boolean {
  return value === '' || /^(\d{8}|\d{13})$/.test(value);
}

export function generateLotNo(expiryDate?: string): string {
  if (expiryDate) return expiryDate.replace(/-/g, '');
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// 永続化は Cloudflare Worker の /api/* 経由で D1 に保存する (GET /api/state / PUT /api/{products,warehouses,categories,ledger})。
// ローカル開発では vite の proxy → wrangler dev (ローカルD1)、本番では同一オリジンの Worker (リモートD1) に届く。
// API に到達できない環境 (オフライン、テスト) ではメモリ内の状態だけで動作する。
interface ServerState {
  products: Product[];
  warehouses: Warehouse[];
  categories: Category[];
  ledger: StockTransaction[];
  inboundPlans?: InboundPlan[]; // 入荷予定を持たない旧サーバーからのレスポンスも読めるよう任意扱い
  suppliers?: Supplier[]; // 仕入先マスタも同様 (未導入のサーバーからは返ってこない)
  purchaseOrderPrints?: PurchaseOrderPrintItem[]; // 発注書の印刷履歴も同様 (未導入のサーバーからは返ってこない)
  customers?: Customer[]; // 得意先マスタも同様 (未導入のサーバーからは返ってこない)
}

async function fetchState(): Promise<ServerState | null> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

type Slice = 'products' | 'warehouses' | 'categories' | 'ledger' | 'inbound-plans' | 'suppliers' | 'purchase-order-prints' | 'customers';

function persist(slice: Slice, data: unknown) {
  try {
    void fetch(`/api/${slice}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  } catch {
    // fetch が使えない環境では永続化をスキップ (メモリ内のみ)
  }
}

const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: DEFAULT_WAREHOUSE_ID, name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
  { id: 'wh-defect', name: '不良倉庫', color: '#f44336' },
];

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
  { id: 'cat-label', name: 'ラベル' },
];

// 仕入先のサンプル (seed.sql と同期)。SAMPLE_INBOUND_PLANS が id で参照している
const DEFAULT_SUPPLIERS: Supplier[] = [
  {
    id: 'sup-yamada', name: '山田乳業', code: 'S-001', contact: '山田 太郎',
    phone: '03-1234-5678', email: 'order@yamada-dairy.example.jp', address: '東京都千代田区1-1-1',
    leadTimeDays: 2, note: '定期便（火・金）', active: true,
  },
  {
    id: 'sup-asahi', name: '朝日ベーカリー', code: 'S-002', contact: '朝日 花子',
    phone: '06-2345-6789', email: 'contact@asahi-bakery.example.jp', address: '大阪府大阪市北区2-2-2',
    leadTimeDays: 1, note: '', active: true,
  },
  {
    id: 'sup-osaka-print', name: '大阪印刷', code: 'S-003', contact: '', phone: '06-3456-7890',
    email: '', address: '大阪府堺市3-3-3', leadTimeDays: 7, note: 'ラベル・資材', active: true,
  },
];

// 得意先のサンプル (seed.sql と同期)。売上出庫の帳票が id で参照する
const DEFAULT_CUSTOMERS: Customer[] = [
  {
    id: 'cus-midori', name: 'みどりストア', code: 'C-001', contact: '緑川 一郎',
    phone: '03-2222-3333', email: 'order@midori-store.example.jp', address: '東京都世田谷区4-4-4',
    note: '毎朝配送', active: true,
  },
  {
    id: 'cus-sakura', name: 'さくらカフェ', code: 'C-002', contact: '佐倉 美咲',
    phone: '06-4444-5555', email: 'cafe@sakura.example.jp', address: '大阪府大阪市中央区5-5-5',
    note: '', active: true,
  },
  {
    id: 'cus-kita', name: '北町給食センター', code: 'C-003', contact: '', phone: '011-666-7777',
    email: '', address: '北海道札幌市北区6-6-6', note: '月末締め', active: true,
  },
];

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const SAMPLE_DATA: Product[] = [
  {
    id: '1', name: '牛乳', sku: 'ML-001', janCode: '4901234567894', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130, taxRate: 8,
    lots: [
      { id: 'l1', lotNo: d(3).replace(/-/g, ''), expiryDate: d(3), quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 118 },
      { id: 'l2', lotNo: d(7).replace(/-/g, ''), expiryDate: d(7), quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 120 },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2', name: '食パン', sku: 'BR-001', janCode: '4912345678904', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90, taxRate: 8,
    lots: [
      { id: 'l3', lotNo: d(1).replace(/-/g, ''), expiryDate: d(1), quantity: 3, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3', name: '値札ラベル(赤)', sku: 'LB-R01', categoryId: 'cat-label', minQuantity: 100, price: 5, costPrice: 2, kind: '資材',
    lots: [
      { id: 'l4', lotNo: '20260101', quantity: 500, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4', name: 'チーズ', sku: 'CS-001', janCode: '4901987654322', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 220, taxRate: 8,
    lots: [
      { id: 'l5', lotNo: d(-2).replace(/-/g, ''), expiryDate: d(-2), quantity: 2, warehouseId: 'wh-hold' },
      { id: 'l6', lotNo: d(14).replace(/-/g, ''), expiryDate: d(14), quantity: 4, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
];

// 入荷予定のサンプル (seed.sql と同期)。1件は分割入荷の途中、1件は入荷予定日を過ぎた遅延の状態にしてある
const SAMPLE_INBOUND_PLANS: InboundPlan[] = [
  {
    id: 'ip1', productId: '1', expectedDate: d(2), quantity: 24, receivedQuantity: 0,
    warehouseId: DEFAULT_WAREHOUSE_ID, lotNo: d(12).replace(/-/g, ''), expiryDate: d(12),
    supplierId: 'sup-yamada', unitPrice: 120, note: '定期便', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'ip2', productId: '2', expectedDate: d(-1), quantity: 20, receivedQuantity: 8,
    warehouseId: DEFAULT_WAREHOUSE_ID, lotNo: d(4).replace(/-/g, ''), expiryDate: d(4),
    supplierId: 'sup-asahi', unitPrice: 98, note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'ip3', productId: '3', expectedDate: d(5), quantity: 1000, receivedQuantity: 0,
    warehouseId: 'wh-hold', lotNo: '20260401', supplierId: 'sup-osaka-print', unitPrice: 8, note: '検品後に販売倉庫へ移動',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

// 旧データの後方互換:
// - warehouseId がないロットにデフォルトを付与
// - categoryId がない商品 (旧 category 文字列) はカテゴリマスタへ名前で対応付け、なければカテゴリを作成
// - 税率がない商品 (消費税の導入前) は既定の税率 (軽減税率 8%) にする
// - 区分がない商品 (資材の導入前) は 販売品 にする
function migrateProducts(products: Product[], categories: Category[]): { products: Product[]; categories: Category[] } {
  const cats = [...categories];
  const idByName = new Map(cats.map(c => [c.name, c.id]));
  const migrated = products.map(p => {
    let categoryId = p.categoryId;
    if (!categoryId) {
      const legacyName = (p as Product & { category?: string }).category || '未分類';
      let id = idByName.get(legacyName);
      if (!id) {
        id = crypto.randomUUID();
        cats.push({ id, name: legacyName });
        idByName.set(legacyName, id);
      }
      categoryId = id;
    }
    return {
      ...p,
      categoryId,
      taxRate: productTaxRate(p),
      kind: productKind(p),
      lots: p.lots.map(l => ({ ...l, warehouseId: l.warehouseId ?? DEFAULT_WAREHOUSE_ID })),
    };
  });
  return { products: migrated, categories: cats };
}

/**
 * 旧データの後方互換: 仕入先マスタ導入前の入荷予定は仕入先を自由入力の文字列で持っている。
 * 同名の仕入先があればその id へ、なければ仕入先を作って対応付ける
 * (カテゴリの migrateProducts と同じ方針)。空欄の予定は「仕入先未設定」のまま残す。
 */
function migrateInboundPlans(plans: InboundPlan[], suppliers: Supplier[]): { plans: InboundPlan[]; suppliers: Supplier[] } {
  const sups = [...suppliers];
  const idByName = new Map(sups.map(s => [s.name, s.id]));
  const migrated = plans.map(plan => {
    const { supplier, ...rest } = plan;
    const withUnitPrice = { ...rest, unitPrice: rest.unitPrice ?? 0 };
    if (withUnitPrice.supplierId) return withUnitPrice;
    const legacyName = (supplier ?? '').trim();
    if (!legacyName) return { ...withUnitPrice, supplierId: '' };
    let id = idByName.get(legacyName);
    if (!id) {
      id = crypto.randomUUID();
      sups.push({ ...EMPTY_SUPPLIER, id, name: legacyName });
      idByName.set(legacyName, id);
    }
    return { ...withUnitPrice, supplierId: id };
  });
  return { plans: migrated, suppliers: sups };
}

function saveSuppliers(suppliers: Supplier[]) {
  persist('suppliers', suppliers);
}

function saveCustomers(customers: Customer[]) {
  persist('customers', customers);
}

function saveWarehouses(warehouses: Warehouse[]) {
  persist('warehouses', warehouses);
}

function saveCategories(categories: Category[]) {
  persist('categories', categories);
}

function save(products: Product[]) {
  persist('products', products);
}

// 旧区分（入庫/出庫）の帳票データを新区分へ移行する
// - 倉庫移動の旧2件記録（出庫+入庫）は「移動」1件に統合（出庫側を除去）
// - ロット追加による入庫 → 入荷、それ以外の入庫/出庫 → 調整入庫/調整出庫
function migrateLedger(txns: StockTransaction[]): { txns: StockTransaction[]; changed: boolean } {
  let changed = false;
  const migrated: StockTransaction[] = [];
  for (const t of txns) {
    const legacyType = t.type as string;
    if (legacyType === '入庫') {
      changed = true;
      if (t.note === '倉庫移動') migrated.push({ ...t, type: '移動' });
      else if (t.note === 'ロット追加') migrated.push({ ...t, type: '入荷' });
      else migrated.push({ ...t, type: '調整入庫' });
    } else if (legacyType === '出庫') {
      changed = true;
      if (t.note === '倉庫移動') continue;
      migrated.push({ ...t, type: '調整出庫' });
    } else {
      migrated.push(t);
    }
  }
  return { txns: migrated, changed };
}

function saveLedger(txns: StockTransaction[]) {
  persist('ledger', txns);
}

function saveInboundPlans(plans: InboundPlan[]) {
  persist('inbound-plans', plans);
}

function savePurchaseOrderPrints(prints: PurchaseOrderPrintItem[]) {
  persist('purchase-order-prints', prints);
}

// ---- CSV エクスポートの種類 ----
// 画面に CSV エクスポートボタンが複数あり、どれも中身が違う。ボタンの表示名・ツールチップ・
// 出力ファイル名をここ1箇所で決めることで、「どのボタンから何のファイルが出るのか」を
// 画面上でもダウンロードフォルダでも見分けられるようにする。
export const CSV_EXPORTS = {
  inventory: { label: '在庫一覧', description: '商品×ロット単位の在庫一覧' },
  ledger: { label: '入出庫帳票', description: '絞り込み後の入出庫履歴' },
  stocktake: { label: '棚卸表', description: '帳簿在庫と実数カウントの一覧' },
  reorder: { label: '要発注リスト', description: '発注点を下回っている商品と推奨発注数' },
  inbound: { label: '入荷予定', description: '絞り込み後の入荷予定' },
  disposal: { label: '廃棄ロス', description: '期間内の商品別の廃棄実績' },
  trace: { label: 'ロット追跡', description: '選択したロットの入荷から出庫までの履歴' },
  supplier: { label: '仕入先一覧', description: '仕入先マスタと入荷予定の状況' },
  costHistory: { label: '原価履歴', description: '入荷時に記録された仕入単価の履歴' },
  purchaseOrderHistory: { label: '発注履歴', description: '発注書として印刷した明細の履歴' },
  analysis: { label: '在庫分析', description: 'ABCランク・在庫回転率・滞留日数の商品別一覧' },
  sales: { label: '売上明細', description: '絞り込み後の売上明細（売上金額・原価・粗利つき）' },
  salesSummary: { label: '売上集計', description: '商品別・得意先別・日別に集計した売上' },
  customer: { label: '得意先一覧', description: '得意先マスタと売上実績の状況' },
} as const;

export type CsvExportKind = keyof typeof CSV_EXPORTS;

/** 出力ファイル名。例: `在庫一覧_2026-06-28.csv` */
export function csvFileName(kind: CsvExportKind, extension = 'csv'): string {
  return `${CSV_EXPORTS[kind].label}_${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** ボタンの表示名。例: `CSVエクスポート（在庫一覧）` */
export function csvExportLabel(kind: CsvExportKind): string {
  return `CSVエクスポート（${CSV_EXPORTS[kind].label}）`;
}

/** ボタンの title 属性。押す前に中身と実際のファイル名を確認できるようにする */
export function csvExportHint(kind: CsvExportKind): string {
  return `${CSV_EXPORTS[kind].description}を CSV で書き出します（${csvFileName(kind)}）`;
}

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// カンマ・改行・引用符を含む値だけ CSV の引用符でくくる (備考は自由入力のため)
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ledgerCsv(txns: StockTransaction[], warehouses: Warehouse[]): string {
  const whName = (id?: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '';
  const header = '日時,区分,商品名,SKU,ロットNo,数量,移動元倉庫,移動先倉庫,備考';
  const rows = txns.map(t => [
    formatLedgerDateTime(t.date),
    t.type,
    t.productName,
    t.productSku,
    t.lotNo,
    signedQuantity(t),
    whName(t.fromWarehouseId),
    whName(t.toWarehouseId),
    t.note,
  ].map(csvCell).join(','));
  return [header, ...rows].join('\n');
}

// 絞り込み後の帳票をそのまま CSV に出す (画面に見えているものが出力される)
export function exportLedgerCsv(txns: StockTransaction[], warehouses: Warehouse[]) {
  downloadCsv(csvFileName('ledger'), ledgerCsv(txns, warehouses));
}

// ---- 棚卸 (実地棚卸) ----
// 帳簿在庫 (lot.quantity) に対して実地カウント数を入力し、差異を 調整入庫/調整出庫 として
// 一括で確定する。ロット単位でカウントするので、counts は lotId をキーにした実数のマップ。

export interface StocktakeFilter {
  keyword: string; // 商品名・SKU・ロットNo の部分一致
  categoryId: string;
  warehouseId: string;
}

export const EMPTY_STOCKTAKE_FILTER: StocktakeFilter = { keyword: '', categoryId: '', warehouseId: '' };

/** 棚卸表の1行 = 1ロット。商品側の情報を平坦に持たせて表示・CSV から参照しやすくする */
export interface StocktakeRow {
  productId: string;
  productName: string;
  productSku: string;
  categoryId: string;
  lotId: string;
  lotNo: string;
  expiryDate?: string;
  warehouseId: string;
  bookQuantity: number; // 帳簿在庫
  costPrice: number;
}

export interface StocktakeDiff extends StocktakeRow {
  actualQuantity: number; // 実地カウント数
  diff: number; // 実数 - 帳簿 (正なら棚卸増、負なら棚卸減)
  diffValue: number; // 差異金額 (原価ベース)
}

/** lotId → 実地カウント数。未カウントのロットはキー自体を持たない */
export type StocktakeCounts = Record<string, number>;

export function stocktakeRows(products: Product[], filter: StocktakeFilter): StocktakeRow[] {
  const q = filter.keyword.trim().toLowerCase();
  const rows: StocktakeRow[] = [];
  for (const p of products) {
    if (filter.categoryId && p.categoryId !== filter.categoryId) continue;
    for (const l of p.lots) {
      if (filter.warehouseId && l.warehouseId !== filter.warehouseId) continue;
      if (q && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || l.lotNo.toLowerCase().includes(q))) continue;
      rows.push({
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        categoryId: p.categoryId,
        lotId: l.id,
        lotNo: l.lotNo,
        expiryDate: l.expiryDate,
        warehouseId: l.warehouseId,
        bookQuantity: l.quantity,
        costPrice: lotUnitCost(l, p),
      });
    }
  }
  return rows;
}

/** カウント済みの行だけを差異付きで返す (差異0の行も「カウント済み」として含む) */
export function stocktakeDiffs(rows: StocktakeRow[], counts: StocktakeCounts): StocktakeDiff[] {
  const diffs: StocktakeDiff[] = [];
  for (const row of rows) {
    const actual = counts[row.lotId];
    if (actual === undefined || !Number.isFinite(actual) || actual < 0) continue;
    const diff = actual - row.bookQuantity;
    diffs.push({ ...row, actualQuantity: actual, diff, diffValue: diff * row.costPrice });
  }
  return diffs;
}

export interface StocktakeTotals {
  counted: number; // カウント済みロット数
  matched: number; // 差異なし
  over: number; // 棚卸増 (実数 > 帳簿)
  short: number; // 棚卸減 (実数 < 帳簿)
  diffValue: number; // 差異金額の合計 (原価ベース)
}

export function stocktakeTotals(diffs: StocktakeDiff[]): StocktakeTotals {
  const totals: StocktakeTotals = { counted: diffs.length, matched: 0, over: 0, short: 0, diffValue: 0 };
  for (const d of diffs) {
    if (d.diff === 0) totals.matched++;
    else if (d.diff > 0) totals.over++;
    else totals.short++;
    totals.diffValue += d.diffValue;
  }
  return totals;
}

// 棚卸表の CSV。未カウントの行は実数・差異を空欄で出すので、印刷してカウント用紙にも使える
export function stocktakeCsv(rows: StocktakeRow[], counts: StocktakeCounts, warehouses: Warehouse[]): string {
  const whName = (id: string) => warehouses.find(w => w.id === id)?.name ?? id;
  const header = '商品名,SKU,ロットNo,賞味期限,倉庫,帳簿在庫,実数,差異,差異金額';
  const body = rows.map(r => {
    const actual = counts[r.lotId];
    const counted = actual !== undefined && Number.isFinite(actual) && actual >= 0;
    const diff = counted ? actual - r.bookQuantity : null;
    return [
      r.productName,
      r.productSku,
      r.lotNo,
      r.expiryDate ?? '',
      whName(r.warehouseId),
      r.bookQuantity,
      counted ? actual : '',
      diff === null ? '' : diff,
      diff === null ? '' : diff * r.costPrice,
    ].map(csvCell).join(',');
  });
  return [header, ...body].join('\n');
}

export function exportStocktakeCsv(rows: StocktakeRow[], counts: StocktakeCounts, warehouses: Warehouse[]) {
  downloadCsv(csvFileName('stocktake'), stocktakeCsv(rows, counts, warehouses));
}

// ---------------------------------------------------------------------------
// FEFO 出庫 (First Expired, First Out)
// 商品と数量だけを指定すると、賞味期限の近いロットから順に自動で引き当てる。
// 引当計画 (planFefoShipment) は純粋関数なので、モーダルのプレビューと
// 実際の出庫 (shipFefo) がまったく同じ計算を共有する。
// ---------------------------------------------------------------------------

/** 1ロットからの引当 1件 */
export interface FefoAllocation {
  lotId: string;
  lotNo: string;
  expiryDate?: string;
  warehouseId: string;
  /** 引当前の在庫数 */
  availableQuantity: number;
  /** このロットから引き当てる数量 */
  quantity: number;
  /** 引当時点のこのロットの原価 (lotUnitCost)。売上の粗利計算と帳票への記録に使う */
  unitCost: number;
}

export interface FefoPlan {
  allocations: FefoAllocation[];
  /** 引き当てられた合計数量 */
  allocated: number;
  /** 引き当てられなかった数量。0 より大きければ在庫不足 */
  shortage: number;
  /** 期限切れのため引当対象から除外した在庫数 (includeExpired 時は 0) */
  skippedExpired: number;
  /** 引き当てたロットの原価合計 (Σ 引当数 × ロット原価)。売上の粗利プレビューに使う */
  cost: number;
}

export interface FefoOptions {
  /** 指定するとその倉庫のロットだけを引当対象にする (未指定は全倉庫) */
  warehouseId?: string;
  /** 既定 false: 期限切れロットは引き当てない (食品は廃棄が原則のため) */
  includeExpired?: boolean;
}

/**
 * shipFefo に渡すオプション。引当条件 (FefoOptions) に加えて、帳票へ何を残すかを持つ。
 * 実売単価・得意先 (SaleFields) は区分が 売上出庫 のときだけ記録される。
 */
export type FefoShipOptions = FefoOptions & SaleFields & {
  type?: OutboundTransactionType;
  note?: string;
};

function isExpired(lot: Lot): boolean {
  return !!lot.expiryDate && daysUntilExpiry(lot.expiryDate) < 0;
}

/**
 * 引当順の比較。賞味期限の早いロットが先。
 * 期限なし (ラベル等) は最後に回し、同順位はロットNo→id で並べて結果を安定させる。
 */
function compareFefo(a: Lot, b: Lot): number {
  if (a.expiryDate !== b.expiryDate) {
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  if (a.lotNo !== b.lotNo) return a.lotNo < b.lotNo ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** 引当対象のロットを FEFO 順に並べて返す (在庫 0 のロットは対象外) */
export function fefoLotOrder(product: Product, options: FefoOptions = {}): Lot[] {
  const { warehouseId, includeExpired = false } = options;
  return product.lots
    .filter(l => l.quantity > 0)
    .filter(l => !warehouseId || l.warehouseId === warehouseId)
    .filter(l => includeExpired || !isExpired(l))
    .sort(compareFefo);
}

/**
 * 出庫数量を FEFO 順のロットへ割り付ける。状態は一切変更しない。
 * 在庫が足りなければ引けるところまで引き当て、残りを shortage として返す。
 */
export function planFefoShipment(product: Product, quantity: number, options: FefoOptions = {}): FefoPlan {
  const requested = Math.max(0, Math.floor(quantity));
  const skippedExpired = options.includeExpired
    ? 0
    : product.lots
        .filter(l => l.quantity > 0 && (!options.warehouseId || l.warehouseId === options.warehouseId))
        .filter(isExpired)
        .reduce((s, l) => s + l.quantity, 0);

  const allocations: FefoAllocation[] = [];
  let remaining = requested;
  for (const lot of fefoLotOrder(product, options)) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    allocations.push({
      lotId: lot.id,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate,
      warehouseId: lot.warehouseId,
      availableQuantity: lot.quantity,
      quantity: take,
      unitCost: lotUnitCost(lot, product),
    });
    remaining -= take;
  }

  const cost = allocations.reduce((s, a) => s + a.unitCost * a.quantity, 0);
  return { allocations, allocated: requested - remaining, shortage: remaining, skippedExpired, cost };
}

// ---------------------------------------------------------------------------
// 仕入先マスタ
// 入荷予定は仕入先を名前ではなく id で参照する (カテゴリ・倉庫と同じ)。改名しても
// 過去の予定の紐づけは切れず、画面の表示だけが一斉に変わる。
// 取引の終わった仕入先は削除ではなく active=false にして、履歴を残したまま
// 新規の入荷予定の選択肢から外す。
// ---------------------------------------------------------------------------

/** 新規登録フォームの初期値。取引中 (active) で始める */
export const EMPTY_SUPPLIER: SupplierInput = {
  name: '', code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true,
};

/** 前後の空白を落とし、リードタイムを 0 以上の整数に丸める */
export function normalizeSupplierInput(input: SupplierInput): SupplierInput {
  return {
    name: input.name.trim(),
    code: input.code.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    leadTimeDays: Math.max(0, Math.floor(input.leadTimeDays || 0)),
    note: input.note.trim(),
    active: input.active,
  };
}

/**
 * 入力チェック。問題がなければ空文字を返す。
 * 画面 (SupplierMasterView) と登録処理 (addSupplier / updateSupplier) が同じ判定を共有するので、
 * 画面に出るエラーと実際に弾かれる条件がずれない。selfId は編集中の仕入先 (自分自身は重複扱いしない)。
 */
export function supplierValidationError(input: SupplierInput, suppliers: Supplier[], selfId?: string): string {
  const s = normalizeSupplierInput(input);
  if (!s.name) return '仕入先名は必須です';
  const others = suppliers.filter(x => x.id !== selfId);
  if (others.some(x => x.name === s.name)) return '同じ名前の仕入先がすでにあります';
  if (s.code && others.some(x => x.code === s.code)) return '同じ仕入先コードがすでにあります';
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) return 'メールアドレスの形式が正しくありません';
  return '';
}

/** 表示用の仕入先名。マスタにない (削除された) id は空文字 */
export function supplierName(suppliers: Supplier[], id: string): string {
  return suppliers.find(s => s.id === id)?.name ?? '';
}

/**
 * 入荷予定のフォームに出す選択肢。取引停止の仕入先は隠すが、
 * 編集中の予定がすでにその仕入先を指しているときだけは残す (勝手に付け替わらないように)。
 */
export function selectableSuppliers(suppliers: Supplier[], currentId = ''): Supplier[] {
  return suppliers.filter(s => s.active || s.id === currentId);
}

/** 仕入先を選んだときの入荷予定日の既定値 (今日 + 標準リードタイム) */
export function expectedDateFromLeadTime(supplier: Supplier | undefined, from = new Date()): string {
  const dt = new Date(from);
  dt.setDate(dt.getDate() + (supplier?.leadTimeDays ?? 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** 仕入先ごとの入荷予定の状況 (削除可否の判定と一覧表示に使う) */
export interface SupplierUsage {
  planCount: number; // 紐づく入荷予定の件数 (キャンセル・入荷済みを含む)
  pendingCount: number; // 入荷待ちの件数 (残数あり)
  pendingQuantity: number; // 入荷待ちの数量合計
  overdueCount: number; // 入荷予定日を過ぎた件数
}

const EMPTY_SUPPLIER_USAGE: SupplierUsage = { planCount: 0, pendingCount: 0, pendingQuantity: 0, overdueCount: 0 };

/** supplierId → 入荷予定の状況。仕入先未設定 ('') の分もキー '' に集計する */
export function supplierUsage(plans: InboundPlan[]): Map<string, SupplierUsage> {
  const byId = new Map<string, SupplierUsage>();
  for (const plan of plans) {
    const usage = byId.get(plan.supplierId) ?? { ...EMPTY_SUPPLIER_USAGE };
    usage.planCount++;
    const remaining = remainingInbound(plan);
    if (remaining > 0) {
      usage.pendingCount++;
      usage.pendingQuantity += remaining;
      if (isOverdueInboundPlan(plan)) usage.overdueCount++;
    }
    byId.set(plan.supplierId, usage);
  }
  return byId;
}

/** 仕入先マスタの1行 = 1仕入先 + その仕入先の入荷予定の状況 */
export interface SupplierRow {
  supplier: Supplier;
  usage: SupplierUsage;
}

/**
 * 絞り込み済みの仕入先一覧。キーワードは仕入先名・コード・担当者・電話・メールの部分一致。
 * 並びは 取引中が先 → 仕入先名。includeInactive=false なら取引停止を除く。
 */
export function supplierRows(
  suppliers: Supplier[],
  plans: InboundPlan[],
  keyword = '',
  includeInactive = true,
): SupplierRow[] {
  const q = keyword.trim().toLowerCase();
  const usageById = supplierUsage(plans);
  return suppliers
    .filter(s => includeInactive || s.active)
    .filter(s => !q || [s.name, s.code, s.contact, s.phone, s.email].some(v => v.toLowerCase().includes(q)))
    .map(s => ({ supplier: s, usage: usageById.get(s.id) ?? { ...EMPTY_SUPPLIER_USAGE } }))
    .sort((a, b) =>
      Number(b.supplier.active) - Number(a.supplier.active) || a.supplier.name.localeCompare(b.supplier.name));
}

export function supplierCsv(rows: SupplierRow[]): string {
  const header = '仕入先名,仕入先コード,担当者,電話番号,メールアドレス,住所,リードタイム（日）,取引状態,入荷予定件数,入荷待ち件数,入荷待ち数量,遅延件数,備考';
  const body = rows.map(r => [
    r.supplier.name,
    r.supplier.code,
    r.supplier.contact,
    r.supplier.phone,
    r.supplier.email,
    r.supplier.address,
    r.supplier.leadTimeDays,
    r.supplier.active ? '取引中' : '取引停止',
    r.usage.planCount,
    r.usage.pendingCount,
    r.usage.pendingQuantity,
    r.usage.overdueCount,
    r.supplier.note,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportSupplierCsv(rows: SupplierRow[]) {
  downloadCsv(csvFileName('supplier'), supplierCsv(rows));
}

// ---------------------------------------------------------------------------
// 入荷予定 (発注済み・入荷待ち)
// 予定はそれ自体では在庫を持たない。「入荷」して初めてロットが増え、帳票に 入荷 が1件残る。
// 状態 (未入荷/一部入荷/入荷済) は予定数量と入荷済数量から導出するので、
// 入荷の記録と状態表示がずれることがない。
// ---------------------------------------------------------------------------

export type InboundPlanStatus = '未入荷' | '一部入荷' | '入荷済' | 'キャンセル';

export const INBOUND_PLAN_STATUSES: InboundPlanStatus[] = ['未入荷', '一部入荷', '入荷済', 'キャンセル'];

export function inboundPlanStatus(plan: InboundPlan): InboundPlanStatus {
  if (plan.canceledAt) return 'キャンセル';
  if (plan.receivedQuantity <= 0) return '未入荷';
  if (plan.receivedQuantity < plan.quantity) return '一部入荷';
  return '入荷済';
}

/** まだ入荷していない数量。キャンセル済み・入荷済みは 0 */
export function remainingInbound(plan: InboundPlan): number {
  if (plan.canceledAt) return 0;
  return Math.max(0, plan.quantity - plan.receivedQuantity);
}

/** 入荷予定日を過ぎたまま残数がある予定 (= 遅延) かどうか */
export function isOverdueInboundPlan(plan: InboundPlan, today = new Date().toISOString().slice(0, 10)): boolean {
  return remainingInbound(plan) > 0 && plan.expectedDate < today;
}

export interface InboundPlanFilter {
  keyword: string; // 商品名・SKU・ロットNo・仕入先名の部分一致
  status: InboundPlanStatus | '';
  warehouseId: string;
  supplierId: string;
  from: string; // 入荷予定日 YYYY-MM-DD (この日を含む)
  to: string;
}

export const EMPTY_INBOUND_PLAN_FILTER: InboundPlanFilter = { keyword: '', status: '', warehouseId: '', supplierId: '', from: '', to: '' };

/** 入荷予定表の1行。商品名など表示に要る情報を平坦に持たせる (帳票と同じ方針) */
export interface InboundPlanRow {
  plan: InboundPlan;
  productName: string;
  productSku: string;
  /** 仕入先マスタから解決した名前。未設定・マスタにない id なら空文字 */
  supplierName: string;
  status: InboundPlanStatus;
  remaining: number;
  overdue: boolean;
}

/**
 * 絞り込み済みの入荷予定を、入荷予定日の早い順 (同日は登録順) に返す。
 * 商品マスタから消えた商品を指す予定は表示できないので除外する。
 * 仕入先は id 参照なので、表示・キーワード検索に使う名前はマスタから解決する。
 */
export function inboundPlanRows(
  plans: InboundPlan[],
  products: Product[],
  filter: InboundPlanFilter = EMPTY_INBOUND_PLAN_FILTER,
  suppliers: Supplier[] = [],
): InboundPlanRow[] {
  const q = filter.keyword.trim().toLowerCase();
  const productById = new Map(products.map(p => [p.id, p]));
  const supplierNameById = new Map(suppliers.map(s => [s.id, s.name]));
  const rows: InboundPlanRow[] = [];
  for (const plan of plans) {
    const product = productById.get(plan.productId);
    if (!product) continue;
    const status = inboundPlanStatus(plan);
    if (filter.status && status !== filter.status) continue;
    if (filter.warehouseId && plan.warehouseId !== filter.warehouseId) continue;
    if (filter.supplierId && plan.supplierId !== filter.supplierId) continue;
    if (filter.from && plan.expectedDate < filter.from) continue;
    if (filter.to && plan.expectedDate > filter.to) continue;
    const name = supplierNameById.get(plan.supplierId) ?? '';
    if (q && !(
      product.name.toLowerCase().includes(q)
      || product.sku.toLowerCase().includes(q)
      || plan.lotNo.toLowerCase().includes(q)
      || name.toLowerCase().includes(q)
    )) continue;
    rows.push({
      plan,
      productName: product.name,
      productSku: product.sku,
      supplierName: name,
      status,
      remaining: remainingInbound(plan),
      overdue: isOverdueInboundPlan(plan),
    });
  }
  return rows.sort((a, b) =>
    a.plan.expectedDate.localeCompare(b.plan.expectedDate) || a.plan.createdAt.localeCompare(b.plan.createdAt));
}

export interface InboundPlanTotals {
  count: number;
  planned: number; // 予定数量の合計 (キャンセルを除く)
  received: number; // 入荷済数量の合計
  remaining: number; // 残数の合計
  overdue: number; // 遅延している予定の件数
  canceled: number;
}

export function inboundPlanTotals(rows: InboundPlanRow[]): InboundPlanTotals {
  const totals: InboundPlanTotals = { count: rows.length, planned: 0, received: 0, remaining: 0, overdue: 0, canceled: 0 };
  for (const r of rows) {
    if (r.status === 'キャンセル') { totals.canceled++; continue; }
    totals.planned += r.plan.quantity;
    totals.received += r.plan.receivedQuantity;
    totals.remaining += r.remaining;
    if (r.overdue) totals.overdue++;
  }
  return totals;
}

export function inboundPlanCsv(rows: InboundPlanRow[], warehouses: Warehouse[]): string {
  const whName = (id: string) => warehouses.find(w => w.id === id)?.name ?? id;
  const header = '入荷予定日,商品名,SKU,ロットNo,賞味期限,入荷先倉庫,仕入先,仕入単価,予定数量,入荷済,残数,状態,備考';
  const body = rows.map(r => [
    r.plan.expectedDate,
    r.productName,
    r.productSku,
    r.plan.lotNo,
    r.plan.expiryDate ?? '',
    whName(r.plan.warehouseId),
    r.supplierName,
    r.plan.unitPrice,
    r.plan.quantity,
    r.plan.receivedQuantity,
    r.remaining,
    r.status,
    r.plan.note,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportInboundPlanCsv(rows: InboundPlanRow[], warehouses: Warehouse[]) {
  downloadCsv(csvFileName('inbound'), inboundPlanCsv(rows, warehouses));
}

/** 発注書の1行。1つの入荷予定 = 1明細として扱う */
export interface PurchaseOrderRow {
  plan: InboundPlan;
  productName: string;
  productSku: string;
  quantity: number; // 残数 (= remainingInbound)。分割入荷済みの分は発注済として除く
  unitPrice: number;
  amount: number; // quantity * unitPrice
}

export interface PurchaseOrderTotals {
  count: number;
  quantity: number;
  amount: number;
}

/**
 * ある仕入先へ改めて発注書を出すべき明細 (未入荷・一部入荷の残数がある予定) を、
 * 入荷予定日の早い順に返す。キャンセル済み・入荷済み・他の仕入先の予定は含めない。
 * 商品マスタから消えた商品の予定は inboundPlanRows と同じ理由で除外する。
 */
export function purchaseOrderRows(plans: InboundPlan[], products: Product[], supplierId: string): PurchaseOrderRow[] {
  const productById = new Map(products.map(p => [p.id, p]));
  const rows: PurchaseOrderRow[] = [];
  for (const plan of plans) {
    if (plan.supplierId !== supplierId || plan.canceledAt) continue;
    const product = productById.get(plan.productId);
    if (!product) continue;
    const quantity = remainingInbound(plan);
    if (quantity <= 0) continue;
    rows.push({ plan, productName: product.name, productSku: product.sku, quantity, unitPrice: plan.unitPrice, amount: quantity * plan.unitPrice });
  }
  return rows.sort((a, b) =>
    a.plan.expectedDate.localeCompare(b.plan.expectedDate) || a.plan.createdAt.localeCompare(b.plan.createdAt));
}

export function purchaseOrderTotals(rows: PurchaseOrderRow[]): PurchaseOrderTotals {
  return rows.reduce((t, r) => ({ count: t.count + 1, quantity: t.quantity + r.quantity, amount: t.amount + r.amount }), { count: 0, quantity: 0, amount: 0 });
}

/** printPurchaseOrder への入力。発注書モーダルで選択・入力していた内容をそのまま渡す */
export interface PrintPurchaseOrderInput {
  supplier: Supplier;
  orderDate: string;
  sender: { name: string; address: string; phone: string; contact: string };
  rows: PurchaseOrderRow[]; // 印刷対象として選択されていた明細
}

/** 入荷時の入力。未指定の項目は予定の内容をそのまま使う */
export interface ReceiveInput {
  quantity: number;
  lotNo?: string;
  expiryDate?: string;
  warehouseId?: string;
  note?: string;
}

/** 入荷で増えるロットの中身 (予定 + 入力の合成結果) */
export interface ReceiptTarget {
  quantity: number;
  lotNo: string;
  expiryDate?: string;
  warehouseId: string;
  /** 加算先の既存ロット。なければ新しいロットを作る */
  existingLot?: Lot;
}

/**
 * 入荷で在庫がどう増えるかを求める。状態は変更しない (モーダルのプレビューと
 * receiveInboundPlan が同じ結果を共有するための純粋関数)。
 * 数量は残数を超えないよう丸める (過入荷は受け付けない)。
 * ロットNo・倉庫・賞味期限がすべて同じロットが既にあれば、新規作成せずそこへ加算する。
 */
export function planReceipt(plan: InboundPlan, product: Product | undefined, input: ReceiveInput): ReceiptTarget {
  const lotNo = (input.lotNo ?? plan.lotNo).trim() || generateLotNo(input.expiryDate ?? plan.expiryDate);
  const expiryDate = input.expiryDate ?? plan.expiryDate;
  const warehouseId = input.warehouseId ?? plan.warehouseId;
  const quantity = Math.min(Math.max(0, Math.floor(input.quantity)), remainingInbound(plan));
  const existingLot = product?.lots.find(l =>
    l.lotNo === lotNo && l.warehouseId === warehouseId && (l.expiryDate ?? '') === (expiryDate ?? ''));
  return { quantity, lotNo, expiryDate, warehouseId, existingLot };
}

/**
 * 入荷で加算されるロットの原価を求める。新規ロットならその単価をそのまま使う。
 * 既存ロットへ加算するときは、既存分と新規分を数量で加重平均する (円未満は四捨五入)。
 * 仕入単価が未入力 (0) の入荷では、既存ロットの原価をそのまま維持する
 * (支払った額が分からない入荷で、既に分かっている原価を上書きしないため)。
 */
export function mergedLotUnitPrice(existingLot: Lot | undefined, product: Product, addedQuantity: number, addedUnitPrice: number): number | undefined {
  if (addedUnitPrice <= 0) return existingLot?.unitPrice;
  if (!existingLot || existingLot.quantity <= 0) return addedUnitPrice;
  const priorPrice = lotUnitCost(existingLot, product);
  return Math.round((existingLot.quantity * priorPrice + addedQuantity * addedUnitPrice) / (existingLot.quantity + addedQuantity));
}

/** 入荷の結果 (呼び出し側が通知に使う) */
export interface ReceiptResult extends ReceiptTarget {
  /** 入荷後の残数 */
  remaining: number;
  /** 既存ロットへ加算したか (false なら新しいロットを作った) */
  merged: boolean;
}

// ---------------------------------------------------------------------------
// ダッシュボード
// 既存の products / categories / warehouses を集計するだけで、専用の永続データは持たない。
// ---------------------------------------------------------------------------

/** 「期限間近」の既定しきい値 (日)。在庫一覧のアラートバナーと同じ 7日 */
export const EXPIRY_SOON_DAYS = 7;

/** ダッシュボードの期限アラートで選べるしきい値 (日) */
export const DASHBOARD_EXPIRY_OPTIONS = [7, 14, 30];

export interface DashboardTotals {
  productCount: number;
  lotCount: number;
  quantity: number; // 全ロットの在庫数合計
  costValue: number; // 在庫金額 (原価ベース)
  retailValue: number; // 在庫金額 (販売定価ベース)
  expiredLots: number; // 期限切れロット数 (在庫が残っているロットのみ)
  expiringLots: number; // withinDays 以内に期限を迎えるロット数 (同上)
  lowStock: number; // 在庫数 <= 発注点 の商品数 (欠品を含む)
  outOfStock: number; // 在庫数 0 の商品数 (lowStock の内数)
}

export function dashboardTotals(products: Product[], withinDays: number = EXPIRY_SOON_DAYS): DashboardTotals {
  const totals: DashboardTotals = {
    productCount: products.length,
    lotCount: 0,
    quantity: 0,
    costValue: 0,
    retailValue: 0,
    expiredLots: 0,
    expiringLots: 0,
    lowStock: 0,
    outOfStock: 0,
  };
  for (const p of products) {
    const qty = totalQuantity(p);
    totals.lotCount += p.lots.length;
    totals.quantity += qty;
    totals.retailValue += qty * p.price;
    if (qty <= p.minQuantity) totals.lowStock++;
    if (qty === 0) totals.outOfStock++;
    for (const l of p.lots) {
      totals.costValue += l.quantity * lotUnitCost(l, p);
      if (!l.expiryDate || l.quantity <= 0) continue;
      const days = daysUntilExpiry(l.expiryDate);
      if (days < 0) totals.expiredLots++;
      else if (days <= withinDays) totals.expiringLots++;
    }
  }
  return totals;
}

/** 要発注リストの1行 = 1商品 (在庫数が発注点以下のもの) */
export interface LowStockRow {
  productId: string;
  productName: string;
  productSku: string;
  categoryId: string;
  quantity: number;
  minQuantity: number;
  shortage: number; // 発注点までの不足数 (発注点ちょうどなら 0)
  costPrice: number;
  restockCost: number; // 不足数を原価で埋めた場合の金額
}

/** 在庫数 <= 発注点 の商品を、不足数の大きい順 (同数なら商品名順) に返す */
export function lowStockRows(products: Product[]): LowStockRow[] {
  const rows: LowStockRow[] = [];
  for (const p of products) {
    const quantity = totalQuantity(p);
    if (quantity > p.minQuantity) continue;
    const shortage = Math.max(0, p.minQuantity - quantity);
    rows.push({
      productId: p.id,
      productName: p.name,
      productSku: p.sku,
      categoryId: p.categoryId,
      quantity,
      minQuantity: p.minQuantity,
      shortage,
      costPrice: p.costPrice,
      restockCost: shortage * p.costPrice,
    });
  }
  return rows.sort((a, b) => b.shortage - a.shortage || a.productName.localeCompare(b.productName));
}

/** 期限アラートの1行 = 1ロット */
export interface ExpiryRow {
  productId: string;
  productName: string;
  productSku: string;
  lotId: string;
  lotNo: string;
  expiryDate: string;
  days: number; // 期限までの日数 (負なら期限切れ)
  quantity: number;
  warehouseId: string;
  costValue: number; // そのロットの在庫金額 (原価ベース)
}

/**
 * 期限切れ + withinDays 以内に期限を迎えるロットを、期限の早い順に返す。
 * 在庫が残っていないロット・期限のないロットは対象外。
 */
export function expiringLotRows(products: Product[], withinDays: number = EXPIRY_SOON_DAYS): ExpiryRow[] {
  const rows: ExpiryRow[] = [];
  for (const p of products) {
    for (const l of p.lots) {
      if (!l.expiryDate || l.quantity <= 0) continue;
      const days = daysUntilExpiry(l.expiryDate);
      if (days > withinDays) continue;
      rows.push({
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        lotId: l.id,
        lotNo: l.lotNo,
        expiryDate: l.expiryDate,
        days,
        quantity: l.quantity,
        warehouseId: l.warehouseId,
        costValue: l.quantity * lotUnitCost(l, p),
      });
    }
  }
  return rows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.productName.localeCompare(b.productName));
}

/** 倉庫別・カテゴリ別サマリの1行 */
export interface GroupSummary {
  id: string;
  name: string;
  productCount: number;
  lotCount: number;
  quantity: number;
  costValue: number;
  retailValue: number;
  share: number; // 原価金額の構成比 (0〜1)。全体が0なら0
}

function withShare(rows: GroupSummary[]): GroupSummary[] {
  const total = rows.reduce((s, r) => s + r.costValue, 0);
  if (total <= 0) return rows;
  return rows.map(r => ({ ...r, share: r.costValue / total }));
}

/**
 * 倉庫ごとの在庫サマリ。マスタに存在しない倉庫を参照するロット
 * (通常は起こらない — 使用中の倉庫は削除できない) は集計から外れる。
 */
export function warehouseSummaries(products: Product[], warehouses: Warehouse[]): GroupSummary[] {
  const rows = warehouses.map(w => {
    const row: GroupSummary = {
      id: w.id, name: w.name, productCount: 0, lotCount: 0, quantity: 0, costValue: 0, retailValue: 0, share: 0,
    };
    for (const p of products) {
      const lots = p.lots.filter(l => l.warehouseId === w.id);
      if (lots.length === 0) continue;
      const qty = lots.reduce((s, l) => s + l.quantity, 0);
      row.productCount++;
      row.lotCount += lots.length;
      row.quantity += qty;
      row.costValue += lots.reduce((s, l) => s + l.quantity * lotUnitCost(l, p), 0);
      row.retailValue += qty * p.price;
    }
    return row;
  });
  return withShare(rows);
}

/** カテゴリごとの在庫サマリ */
export function categorySummaries(products: Product[], categories: Category[]): GroupSummary[] {
  const rows = categories.map(c => {
    const row: GroupSummary = {
      id: c.id, name: c.name, productCount: 0, lotCount: 0, quantity: 0, costValue: 0, retailValue: 0, share: 0,
    };
    for (const p of products) {
      if (p.categoryId !== c.id) continue;
      const qty = totalQuantity(p);
      row.productCount++;
      row.lotCount += p.lots.length;
      row.quantity += qty;
      row.costValue += p.lots.reduce((s, l) => s + l.quantity * lotUnitCost(l, p), 0);
      row.retailValue += qty * p.price;
    }
    return row;
  });
  return withShare(rows);
}

// ---------------------------------------------------------------------------
// 発注提案 (要発注リスト → 入荷予定)
// 発注点を下回った商品を見つけるところまでは lowStockRows がやっていたが、そこから先
// (いくつ・どこへ・いつ発注するか) は入荷予定を1件ずつ手で作るしかなかった。
// ここでは要発注の各行に「入荷予定残」「推奨発注数」「仕入先」を足し、そのまま
// InboundPlanInput へ変換できるようにする。発注は在庫を動かさない (動くのは
// receiveInboundPlan のとき) ので、帳票には何も書かない。
// ---------------------------------------------------------------------------

/** 目標在庫 = 発注点の何倍まで戻すか。ダッシュボードで切り替える */
export const REORDER_TARGET_RATIOS = [1, 1.5, 2] as const;
export const DEFAULT_REORDER_RATIO = 2;

/** 発注提案から作った入荷予定の備考。入荷予定タブでこの操作由来だと分かるようにする */
export const REORDER_NOTE = '発注提案';

/** 発注提案の1行 = 要発注リストの1行 + 発注に必要な既定値 */
export interface ReorderSuggestion extends LowStockRow {
  incoming: number; // 未入荷の入荷予定の残数合計 (キャンセル済みは除く)
  projected: number; // 入荷予定を織り込んだ見込在庫 = quantity + incoming
  projectedShortage: number; // 見込在庫でも発注点に届かない不足数
  suggestedQuantity: number; // 推奨発注数 = max(0, 発注点 × 倍率 - 見込在庫)
  supplierId: string; // 直近の入荷予定から引き継いだ仕入先。取引停止・削除済みなら空文字
  supplierName: string;
  leadTimeDays: number;
  expectedDate: string; // 入荷予定日の既定値 = 今日 + 標準リードタイム
  warehouseId: string; // 入荷先倉庫の既定値。直近の入荷予定の倉庫、なければ既定倉庫
  unitPrice: number; // 仕入単価の既定値。直近の入荷予定の単価、未入力なら商品の原価
  orderCost: number; // suggestedQuantity × unitPrice
}

export interface ReorderOptions {
  targetRatio?: number; // 目標在庫の倍率 (既定 DEFAULT_REORDER_RATIO)
  from?: Date; // 入荷予定日の起点 (既定は今日)。テストで固定するために外から渡せる
}

/**
 * 要発注の各商品について「何をいくつ発注すればよいか」を組み立てる。状態は変更しない。
 * 入荷予定の残数を差し引くので、すでに発注済みの商品は推奨発注数が 0 になり、二重発注を防ぐ。
 * 仕入先・倉庫・仕入単価は「直近に作った入荷予定」から引き継ぐ (過去と同じ条件で頼み直すのが通常のため)。
 */
export function reorderSuggestions(
  products: Product[],
  inboundPlans: InboundPlan[],
  suppliers: Supplier[],
  warehouses: Warehouse[],
  options: ReorderOptions = {},
): ReorderSuggestion[] {
  const { targetRatio = DEFAULT_REORDER_RATIO, from = new Date() } = options;

  const incoming = new Map<string, number>();
  const latestPlan = new Map<string, InboundPlan>();
  for (const plan of inboundPlans) {
    if (plan.canceledAt) continue;
    incoming.set(plan.productId, (incoming.get(plan.productId) ?? 0) + remainingInbound(plan));
    const current = latestPlan.get(plan.productId);
    if (!current || plan.createdAt > current.createdAt) latestPlan.set(plan.productId, plan);
  }

  const fallbackWarehouseId = warehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID)
    ? DEFAULT_WAREHOUSE_ID
    : (warehouses[0]?.id ?? '');

  return lowStockRows(products).map(row => {
    const plan = latestPlan.get(row.productId);
    // 取引停止・削除済みの仕入先は引き継がない (入荷予定フォームの選択肢から消えているため)
    const supplier = suppliers.find(s => s.id === plan?.supplierId && s.active);
    const inbound = incoming.get(row.productId) ?? 0;
    const projected = row.quantity + inbound;
    const suggestedQuantity = Math.max(0, Math.ceil(row.minQuantity * targetRatio) - projected);
    const unitPrice = plan && plan.unitPrice > 0 ? plan.unitPrice : row.costPrice;
    return {
      ...row,
      incoming: inbound,
      projected,
      projectedShortage: Math.max(0, row.minQuantity - projected),
      suggestedQuantity,
      supplierId: supplier?.id ?? '',
      supplierName: supplier?.name ?? '',
      leadTimeDays: supplier?.leadTimeDays ?? 0,
      expectedDate: expectedDateFromLeadTime(supplier, from),
      warehouseId: warehouses.some(w => w.id === plan?.warehouseId) ? plan!.warehouseId : fallbackWarehouseId,
      unitPrice,
      orderCost: suggestedQuantity * unitPrice,
    };
  });
}

/** 発注提案の行に対する画面での上書き (数量と仕入先はその場で変えられる) */
export interface ReorderOverride {
  quantity?: number;
  supplierId?: string;
}

/**
 * 発注提案の1行を入荷予定の入力値へ変換する。
 * 仕入先を変えたときは入荷予定日もその仕入先の標準リードタイムで引き直す。
 * ロットNo・賞味期限は発注時点では決まらないので空にしておき、入荷時に入力させる
 * (planReceipt は空のロットNo を賞味期限から採番する)。
 */
export function reorderPlanInput(
  row: ReorderSuggestion,
  suppliers: Supplier[],
  override: ReorderOverride = {},
  from = new Date(),
): InboundPlanInput {
  const supplierId = override.supplierId ?? row.supplierId;
  const supplier = suppliers.find(s => s.id === supplierId);
  return {
    productId: row.productId,
    expectedDate: supplierId === row.supplierId ? row.expectedDate : expectedDateFromLeadTime(supplier, from),
    quantity: Math.max(0, Math.floor(override.quantity ?? row.suggestedQuantity)),
    warehouseId: row.warehouseId,
    lotNo: '',
    expiryDate: '',
    supplierId,
    unitPrice: row.unitPrice,
    note: REORDER_NOTE,
  };
}

/** 発注登録する1商品。確認ダイアログの表示に要るものを平坦に持たせる */
export interface ReorderTarget {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  supplierId: string;
  supplierName: string;
  expectedDate: string;
  unitPrice: number;
  orderCost: number;
  warehouseId: string;
}

export interface ReorderPlan {
  targets: ReorderTarget[];
  inputs: InboundPlanInput[]; // targets と同じ並びの入荷予定入力値 (そのまま addInboundPlans に渡せる)
  quantity: number; // 発注数の合計
  orderCost: number; // 発注金額の合計
  noSupplier: number; // 仕入先が決まっていない件数 (注意喚起に使う)
}

/**
 * 選んだ商品を発注登録したときに何がいくつ作られるかを求める。状態は一切変更しない
 * (確認ダイアログのプレビューと実行が同じ結果を共有するための純粋関数)。
 * 発注数が 0 の行と、提案に出ていない productId は黙って除外する。
 */
export function planReorder(
  rows: ReorderSuggestion[],
  productIds: Iterable<string>,
  suppliers: Supplier[],
  overrides: Record<string, ReorderOverride> = {},
  from = new Date(),
): ReorderPlan {
  const wanted = new Set(productIds);
  const plan: ReorderPlan = { targets: [], inputs: [], quantity: 0, orderCost: 0, noSupplier: 0 };

  for (const row of rows) {
    if (!wanted.has(row.productId)) continue;
    const input = reorderPlanInput(row, suppliers, overrides[row.productId], from);
    if (input.quantity <= 0) continue;
    plan.targets.push({
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku,
      quantity: input.quantity,
      supplierId: input.supplierId,
      supplierName: supplierName(suppliers, input.supplierId),
      expectedDate: input.expectedDate,
      unitPrice: input.unitPrice,
      orderCost: input.quantity * input.unitPrice,
      warehouseId: input.warehouseId,
    });
    plan.inputs.push(input);
    plan.quantity += input.quantity;
    plan.orderCost += input.quantity * input.unitPrice;
    if (!input.supplierId) plan.noSupplier++;
  }
  return plan;
}

/** 要発注リストの CSV。推奨発注数と仕入先まで入っているので、そのまま発注依頼の下書きに使える */
export function reorderCsv(rows: ReorderSuggestion[], categories: Category[]): string {
  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? '';
  const header = '商品名,SKU,カテゴリ,在庫数,発注点,入荷予定残,見込在庫,不足数,推奨発注数,仕入先,入荷予定日,発注見込金額';
  const body = rows.map(r => [
    r.productName, r.productSku, catName(r.categoryId), r.quantity, r.minQuantity,
    r.incoming, r.projected, r.projectedShortage, r.suggestedQuantity,
    r.supplierName, r.expectedDate, r.orderCost,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportReorderCsv(rows: ReorderSuggestion[], categories: Category[]) {
  downloadCsv(csvFileName('reorder'), reorderCsv(rows, categories));
}

// ---------------------------------------------------------------------------
// 廃棄 (期限切れロスの処分)
// 期限切れロットは1ロットずつ 出庫→廃棄 するしかなかったので、ダッシュボードの期限アラートから
// まとめて処分できるようにする。廃棄そのものは既存の 廃棄 区分の出庫なので、専用の永続データは
// 持たず、実績は帳票 (ledger) から集計する。
// ---------------------------------------------------------------------------

/** 一括廃棄の既定の備考。帳票でこの操作による廃棄だと分かるようにする */
export const DISPOSAL_NOTE = '一括廃棄';

/** 廃棄する1ロット。廃棄は「そのロットを処分しきる」操作なので数量はロットの全在庫 */
export interface DisposalTarget {
  productId: string;
  productName: string;
  productSku: string;
  lotId: string;
  lotNo: string;
  expiryDate?: string;
  warehouseId: string;
  quantity: number;
  costPrice: number;
  costValue: number; // quantity × costPrice
  expired: boolean; // 実行時点で期限切れか (期限内のロットを選んだときの注意喚起に使う)
}

export interface DisposalPlan {
  targets: DisposalTarget[];
  quantity: number; // 廃棄する数量の合計
  costValue: number; // 廃棄ロス金額 (原価ベース) の合計
  expiredCount: number;
  notExpiredCount: number; // まだ期限の来ていないロットの件数
}

/**
 * 選んだロットを全量廃棄したときに何がいくつ減るかを求める。状態は一切変更しない
 * (確認ダイアログのプレビューと disposeLots が同じ結果を共有するための純粋関数)。
 * 在庫の残っていないロットと、見つからない lotId は黙って除外する。
 */
export function planDisposal(products: Product[], lotIds: Iterable<string>): DisposalPlan {
  const wanted = new Set(lotIds);
  const targets: DisposalTarget[] = [];
  for (const p of products) {
    for (const l of p.lots) {
      if (!wanted.has(l.id) || l.quantity <= 0) continue;
      const costPrice = lotUnitCost(l, p);
      targets.push({
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        lotId: l.id,
        lotNo: l.lotNo,
        expiryDate: l.expiryDate,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        costPrice,
        costValue: l.quantity * costPrice,
        expired: isExpired(l),
      });
    }
  }
  // 期限アラートの並び (期限の早い順) に合わせる。期限なしは最後
  targets.sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    }
    return a.productName.localeCompare(b.productName);
  });

  const plan: DisposalPlan = { targets, quantity: 0, costValue: 0, expiredCount: 0, notExpiredCount: 0 };
  for (const t of targets) {
    plan.quantity += t.quantity;
    plan.costValue += t.costValue;
    if (t.expired) plan.expiredCount++;
    else plan.notExpiredCount++;
  }
  return plan;
}

/** 廃棄ロスの集計期間。全期間は開始日なし */
export const DISPOSAL_PERIODS = ['今月', '今年', '全期間'] as const;
export type DisposalPeriod = typeof DISPOSAL_PERIODS[number];

/**
 * 集計期間の開始日 (ローカル日付 YYYY-MM-DD)。全期間は空文字 = 絞らない。
 * 帳票の絞り込みと同じくローカル日付で比べるので、画面の日時表示と食い違わない。
 */
export function disposalPeriodStart(period: DisposalPeriod, today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (period === '今月') return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  if (period === '今年') return `${today.getFullYear()}-01-01`;
  return '';
}

/** 帳票から廃棄の記録だけを取り出す。from は開始日 (この日を含む)、空文字なら全期間 */
export function disposalTransactions(ledger: StockTransaction[], from = ''): StockTransaction[] {
  return ledger.filter(t => t.type === '廃棄' && (!from || localDateKey(t.date) >= from));
}

/** 廃棄ロスの商品別集計の1行 */
export interface DisposalRow {
  productId: string;
  productName: string;
  productSku: string;
  count: number; // 廃棄の記録件数
  quantity: number;
  costValue: number; // 廃棄ロス金額 (原価ベース)
}

/**
 * 廃棄の記録を商品ごとにまとめ、ロス金額の大きい順に返す。
 * 廃棄時にロットの実原価が記録されていればそれを使う (disposeLots が書く unitPrice)。
 * それがない古い記録や、削除された商品 (マスタにない) は商品マスタの「現在の原価」を掛けた概算になり、
 * マスタにもない場合は原価0として数量だけを数える。
 */
export function disposalRows(txns: StockTransaction[], products: Product[]): DisposalRow[] {
  const costById = new Map(products.map(p => [p.id, p.costPrice]));
  const byProduct = new Map<string, DisposalRow>();
  for (const t of txns) {
    const row = byProduct.get(t.productId) ?? {
      productId: t.productId,
      productName: t.productName,
      productSku: t.productSku,
      count: 0,
      quantity: 0,
      costValue: 0,
    };
    row.count++;
    row.quantity += t.quantity;
    row.costValue += t.quantity * (t.unitPrice ?? costById.get(t.productId) ?? 0);
    byProduct.set(t.productId, row);
  }
  return [...byProduct.values()].sort((a, b) =>
    b.costValue - a.costValue || b.quantity - a.quantity || a.productName.localeCompare(b.productName));
}

export interface DisposalTotals {
  count: number;
  quantity: number;
  costValue: number;
}

export function disposalTotals(rows: DisposalRow[]): DisposalTotals {
  return rows.reduce<DisposalTotals>((totals, r) => ({
    count: totals.count + r.count,
    quantity: totals.quantity + r.quantity,
    costValue: totals.costValue + r.costValue,
  }), { count: 0, quantity: 0, costValue: 0 });
}

export function disposalCsv(rows: DisposalRow[]): string {
  const header = '商品名,SKU,廃棄件数,廃棄数量,廃棄金額（原価）';
  const body = rows.map(r => [r.productName, r.productSku, r.count, r.quantity, r.costValue].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportDisposalCsv(rows: DisposalRow[]) {
  downloadCsv(csvFileName('disposal'), disposalCsv(rows));
}

// ---------------------------------------------------------------------------
// 仕入価格・原価履歴 (原価履歴)
// 入荷予定に仕入単価を持たせ、受け入れ (receiveInboundPlan) がその単価を「入荷」帳票へ
// 書き写す。専用の永続データは持たず、廃棄ロス集計・ロット追跡と同じく帳票から組み立てる。
// ---------------------------------------------------------------------------

export interface CostHistoryRow {
  txnId: string;
  date: string;
  productId: string;
  productName: string;
  productSku: string;
  lotNo: string;
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  quantity: number;
  amount: number; // unitPrice * quantity
  /** 同一商品×同一仕入先の1つ前の記録の単価。なければ undefined (初回入荷) */
  previousUnitPrice?: number;
}

/**
 * 帳票の「入荷」のうち仕入単価が入っているもの (入荷予定からの入荷) だけを新しい順に整形する。
 * unitPrice が 0 (未入力) の記録は履歴として無意味なので除外する。
 */
export function costHistoryRows(ledger: StockTransaction[], suppliers: Supplier[]): CostHistoryRow[] {
  const supplierNameById = new Map(suppliers.map(s => [s.id, s.name]));
  const source = ledger
    .filter(t => t.type === '入荷' && t.unitPrice != null && t.unitPrice > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date)); // 前回比を求めるため古い順に処理する

  const lastPriceByKey = new Map<string, number>();
  const rows: CostHistoryRow[] = source.map(t => {
    const supplierId = t.supplierId ?? '';
    const key = `${t.productId} ${supplierId}`;
    const previousUnitPrice = lastPriceByKey.get(key);
    lastPriceByKey.set(key, t.unitPrice!);
    return {
      txnId: t.id,
      date: t.date,
      productId: t.productId,
      productName: t.productName,
      productSku: t.productSku,
      lotNo: t.lotNo,
      supplierId,
      supplierName: supplierNameById.get(supplierId) ?? '',
      unitPrice: t.unitPrice!,
      quantity: t.quantity,
      amount: t.unitPrice! * t.quantity,
      previousUnitPrice,
    };
  });

  return rows.sort((a, b) => b.date.localeCompare(a.date)); // 表示は新しい順
}

// 原価履歴の絞り込み条件。ledger 帳票と同じ方針で「空文字はその条件では絞らない」
export interface CostHistoryFilter {
  keyword: string; // 商品名・SKU・仕入先名の部分一致
  supplierId: string;
  from: string; // YYYY-MM-DD (この日を含む)
  to: string; // YYYY-MM-DD (この日を含む)
}

export const EMPTY_COST_HISTORY_FILTER: CostHistoryFilter = { keyword: '', supplierId: '', from: '', to: '' };

export function filterCostHistory(rows: CostHistoryRow[], filter: CostHistoryFilter): CostHistoryRow[] {
  const q = filter.keyword.trim().toLowerCase();
  return rows.filter(r => {
    if (q && !(
      r.productName.toLowerCase().includes(q)
      || r.productSku.toLowerCase().includes(q)
      || r.supplierName.toLowerCase().includes(q)
    )) return false;
    if (filter.supplierId && r.supplierId !== filter.supplierId) return false;
    if (filter.from || filter.to) {
      const day = localDateKey(r.date);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
    }
    return true;
  });
}

export interface CostHistoryTotals {
  count: number;
  averageUnitPrice: number;
  amount: number;
}

export function costHistoryTotals(rows: CostHistoryRow[]): CostHistoryTotals {
  if (rows.length === 0) return { count: 0, averageUnitPrice: 0, amount: 0 };
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const quantity = rows.reduce((s, r) => s + r.quantity, 0);
  return { count: rows.length, averageUnitPrice: quantity > 0 ? amount / quantity : 0, amount };
}

export function costHistoryCsv(rows: CostHistoryRow[]): string {
  const header = '日時,商品名,SKU,ロットNo,仕入先,仕入単価,前回単価,数量,金額';
  const body = rows.map(r => [
    formatLedgerDateTime(r.date),
    r.productName,
    r.productSku,
    r.lotNo,
    r.supplierName,
    r.unitPrice,
    r.previousUnitPrice ?? '',
    r.quantity,
    r.amount,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportCostHistoryCsv(rows: CostHistoryRow[]) {
  downloadCsv(csvFileName('costHistory'), costHistoryCsv(rows));
}

// ---------------------------------------------------------------------------
// 売上管理 (実際の売上の記録と集計)
// 出庫のうち「売上出庫」だけが、実際に売れた単価 (実売単価) と売り先 (得意先) を持てる。
// 帳票へ書き写すのは 実売単価 (unitPrice) / 得意先 (customerId) / 出庫時点のロット原価
// (costUnitPrice) の3つで、売上専用のテーブルは持たない。売上高・原価・粗利はすべて
// 帳票から組み立てる (原価履歴・廃棄ロス・ロット追跡と同じ「帳票が唯一の情報源」方針)。
//
// 売れたロットは在庫から減るので、あとから原価を引き直すことはできない。だから粗利のもとに
// なる原価は出庫したその場で帳票に写し取る (廃棄ロスが廃棄時の原価を残すのと同じ理由)。
// ---------------------------------------------------------------------------

/** 新規登録フォームの初期値。取引中 (active) で始める */
export const EMPTY_CUSTOMER: CustomerInput = {
  name: '', code: '', contact: '', phone: '', email: '', address: '', note: '', active: true,
};

/** 前後の空白を落とす (得意先は数値項目を持たないので整形はこれだけ) */
export function normalizeCustomerInput(input: CustomerInput): CustomerInput {
  return {
    name: input.name.trim(),
    code: input.code.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    note: input.note.trim(),
    active: input.active,
  };
}

/**
 * 入力チェック。問題がなければ空文字を返す。
 * 画面 (CustomerModal) と登録処理 (addCustomer / updateCustomer) が同じ判定を共有するので、
 * 画面に出るエラーと実際に弾かれる条件がずれない (supplierValidationError と同じ方針)。
 */
export function customerValidationError(input: CustomerInput, customers: Customer[], selfId?: string): string {
  const c = normalizeCustomerInput(input);
  if (!c.name) return '得意先名は必須です';
  const others = customers.filter(x => x.id !== selfId);
  if (others.some(x => x.name === c.name)) return '同じ名前の得意先がすでにあります';
  if (c.code && others.some(x => x.code === c.code)) return '同じ得意先コードがすでにあります';
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'メールアドレスの形式が正しくありません';
  return '';
}

/** 表示用の得意先名。マスタにない (削除された) id は空文字 */
export function customerName(customers: Customer[], id: string): string {
  return customers.find(c => c.id === id)?.name ?? '';
}

/**
 * 売上登録フォームに出す選択肢。取引停止の得意先は隠すが、
 * すでにその得意先を指しているときだけは残す (selectableSuppliers と同じ方針)。
 */
export function selectableCustomers(customers: Customer[], currentId = ''): Customer[] {
  return customers.filter(c => c.active || c.id === currentId);
}

/** 売上出庫のときだけ帳票に足す入力 (実売単価・得意先) */
export interface SaleFields {
  /** 実売単価 (税抜・円)。0 と未指定は「未入力」扱い (帳票には書かず、集計時に販売定価で代用する) */
  unitPrice?: number;
  /** 得意先マスタの id。空文字・未指定は「得意先なし」 */
  customerId?: string;
}

/**
 * 売上出庫の帳票に足す項目を組み立てる。
 * 原価は出庫したそのロットの原価を、税率はその時点の商品の税率をそのまま写し取る
 * (売れたロットは減るのであとから引き直せない / 商品の税率はあとで変わりうる)。
 * 実売単価 (税抜) は 0 なら「未入力」として書かない (入荷予定の仕入単価と同じ扱い)。
 */
function saleFields(product: Product, unitCost: number, unitPrice?: number, customerId?: string) {
  return {
    costUnitPrice: Math.round(unitCost),
    taxRate: productTaxRate(product),
    ...(unitPrice != null && unitPrice > 0 ? { unitPrice: Math.round(unitPrice) } : {}),
    ...(customerId ? { customerId } : {}),
  };
}

/** 売上登録 (売上管理タブ) の入力。実際の出庫は FEFO で引き当てる */
export interface SaleInput {
  productId: string;
  quantity: number;
  /** 実売単価 (税抜・円)。0 は「未入力」扱いで、集計時に商品の販売定価で代用する */
  unitPrice: number;
  /** 得意先マスタの id。空文字は「得意先なし」 */
  customerId: string;
  /** 指定するとその倉庫のロットだけを引当対象にする (未指定は全倉庫) */
  warehouseId?: string;
  includeExpired?: boolean;
  note?: string;
}

/** 売上登録でつく帳票の備考 (在庫一覧からの FEFO出庫 と区別するため) */
export const SALE_NOTE = '売上登録';

/** 売上明細の1行 = 帳票の「売上出庫」1件 */
export interface SalesRow {
  txnId: string;
  date: string;
  productId: string;
  productName: string;
  productSku: string;
  lotNo: string;
  warehouseId: string; // 出庫元倉庫 (fromWarehouseId)
  customerId: string; // 空文字は得意先なし
  customerName: string;
  quantity: number;
  unitPrice: number; // 実売単価 (税抜。未記録なら商品の販売定価)
  amount: number; // unitPrice * quantity (税抜の売上金額)
  taxRate: TaxRate; // 出庫時点の税率 (未記録なら商品の現在の税率)
  tax: number; // amount にかかる消費税 (この明細1行で四捨五入)
  amountWithTax: number; // amount + tax
  unitCost: number; // 出庫時点のロット原価 (未記録なら商品の現在原価)
  cost: number; // unitCost * quantity
  profit: number; // amount - cost
  profitRate: number; // profit / amount (売上0なら0)
  note: string;
  /** 実売単価が帳票になく、商品の販売定価で代用した行 (概算) */
  estimatedPrice: boolean;
  /** 出庫時点の原価が帳票になく、商品の現在原価で代用した行 (概算) */
  estimatedCost: boolean;
}

/**
 * 帳票の「売上出庫」を新しい順に売上明細へ整形する。
 *
 * 単価がこの機能より前の記録 (実売単価なし) や、単価を入力しなかった出庫では、
 * 商品の販売定価 / 現在原価で代用し estimatedPrice / estimatedCost を立てる
 * (廃棄ロスが古い記録で現在原価にフォールバックするのと同じ概算)。
 * 商品ごと削除されている場合は 0 円として扱う。
 */
export function salesRows(ledger: StockTransaction[], products: Product[], customers: Customer[]): SalesRow[] {
  const productById = new Map(products.map(p => [p.id, p]));
  const customerNameById = new Map(customers.map(c => [c.id, c.name]));
  return ledger
    .filter(t => t.type === '売上出庫')
    .map(t => {
      const product = productById.get(t.productId);
      const estimatedPrice = t.unitPrice == null;
      const estimatedCost = t.costUnitPrice == null;
      const unitPrice = t.unitPrice ?? product?.price ?? 0;
      const unitCost = t.costUnitPrice ?? product?.costPrice ?? 0;
      // 消費税の導入前の記録は税率を持たないので、商品の現在の税率を使う。商品の税率が変わることは
      // まずなく、全件を「概算」扱いにすると印だらけになるため、単価・原価と違って印はつけない
      const taxRate = isTaxRate(t.taxRate) ? t.taxRate : product ? productTaxRate(product) : DEFAULT_TAX_RATE;
      const amount = unitPrice * t.quantity;
      const tax = taxAmount(amount, taxRate);
      const cost = unitCost * t.quantity;
      const customerId = t.customerId ?? '';
      return {
        txnId: t.id,
        date: t.date,
        productId: t.productId,
        productName: t.productName,
        productSku: t.productSku,
        lotNo: t.lotNo,
        warehouseId: t.fromWarehouseId ?? '',
        customerId,
        customerName: customerNameById.get(customerId) ?? '',
        quantity: t.quantity,
        unitPrice,
        amount,
        taxRate,
        tax,
        amountWithTax: amount + tax,
        unitCost,
        cost,
        profit: amount - cost,
        profitRate: amount > 0 ? (amount - cost) / amount : 0,
        note: t.note,
        estimatedPrice,
        estimatedCost,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// 売上明細の絞り込み条件。帳票と同じ方針で「空文字はその条件では絞らない」
export interface SalesFilter {
  keyword: string; // 商品名・SKU・得意先名の部分一致
  customerId: string; // '' = 全得意先。'none' は得意先なしの売上だけ
  warehouseId: string;
  from: string; // YYYY-MM-DD (この日を含む)
  to: string; // YYYY-MM-DD (この日を含む)
}

export const EMPTY_SALES_FILTER: SalesFilter = { keyword: '', customerId: '', warehouseId: '', from: '', to: '' };

/** 得意先の絞り込みで「得意先なし」を選ぶための値 (空文字は「全得意先」に使っているため) */
export const NO_CUSTOMER = 'none';

export function filterSales(rows: SalesRow[], filter: SalesFilter): SalesRow[] {
  const q = filter.keyword.trim().toLowerCase();
  return rows.filter(r => {
    if (q && !(
      r.productName.toLowerCase().includes(q)
      || r.productSku.toLowerCase().includes(q)
      || r.customerName.toLowerCase().includes(q)
    )) return false;
    if (filter.customerId === NO_CUSTOMER) {
      if (r.customerId) return false;
    } else if (filter.customerId && r.customerId !== filter.customerId) return false;
    if (filter.warehouseId && r.warehouseId !== filter.warehouseId) return false;
    if (filter.from || filter.to) {
      const day = localDateKey(r.date);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
    }
    return true;
  });
}

/** 税率ごとの売上 (適格請求書と同じく 8% 対象 / 10% 対象を分けて見るため) */
export interface SalesTaxBreakdown {
  taxRate: TaxRate;
  amount: number; // 税抜の売上金額
  tax: number; // 消費税 (明細ごとに四捨五入した額の合計)
  amountWithTax: number;
}

export interface SalesTotals {
  count: number; // 明細件数
  quantity: number;
  amount: number; // 売上高 (税抜)
  tax: number; // 消費税
  amountWithTax: number; // 税込売上高
  cost: number; // 売上原価
  profit: number; // 粗利 (税抜の売上高 − 原価)
  profitRate: number; // 粗利率 (売上0なら0)
  averageUnitPrice: number; // 売上高 (税抜) ÷ 数量
  /** 税率別の内訳 (軽減税率が先)。売上の無い税率も 0 円で含める */
  byTaxRate: SalesTaxBreakdown[];
}

export function salesTotals(rows: SalesRow[]): SalesTotals {
  const quantity = rows.reduce((s, r) => s + r.quantity, 0);
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const tax = rows.reduce((s, r) => s + r.tax, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const byTaxRate = TAX_RATES.map(taxRate => {
    const ofRate = rows.filter(r => r.taxRate === taxRate);
    const rateAmount = ofRate.reduce((s, r) => s + r.amount, 0);
    const rateTax = ofRate.reduce((s, r) => s + r.tax, 0);
    return { taxRate, amount: rateAmount, tax: rateTax, amountWithTax: rateAmount + rateTax };
  });
  return {
    count: rows.length,
    quantity,
    amount,
    tax,
    amountWithTax: amount + tax,
    cost,
    profit: amount - cost,
    profitRate: amount > 0 ? (amount - cost) / amount : 0,
    averageUnitPrice: quantity > 0 ? amount / quantity : 0,
    byTaxRate,
  };
}

/** 集計の1行 (商品別・得意先別・日別で同じ形。画面は同じ表で3つの切り口を描く) */
export interface SalesSummary {
  key: string; // 商品id / 得意先id ('' = 得意先なし) / 日付 (YYYY-MM-DD)
  label: string; // 商品名 / 得意先名 / 日付
  sub: string; // SKU など補足 (なければ空文字)
  count: number; // 明細件数
  quantity: number;
  amount: number; // 税抜
  tax: number;
  amountWithTax: number;
  cost: number;
  profit: number;
  profitRate: number;
  share: number; // 売上高 (税抜) の構成比 (全体の売上高が0なら0)
}

/** 集計の共通処理。キーごとに足し上げ、売上高の多い順に並べて構成比を付ける */
function summarize(rows: SalesRow[], keyOf: (r: SalesRow) => { key: string; label: string; sub: string }): SalesSummary[] {
  const byKey = new Map<string, SalesSummary>();
  for (const r of rows) {
    const { key, label, sub } = keyOf(r);
    const current = byKey.get(key)
      ?? { key, label, sub, count: 0, quantity: 0, amount: 0, tax: 0, amountWithTax: 0, cost: 0, profit: 0, profitRate: 0, share: 0 };
    current.count++;
    current.quantity += r.quantity;
    current.amount += r.amount;
    current.tax += r.tax;
    current.amountWithTax += r.amountWithTax;
    current.cost += r.cost;
    byKey.set(key, current);
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return [...byKey.values()]
    .map(s => ({
      ...s,
      profit: s.amount - s.cost,
      profitRate: s.amount > 0 ? (s.amount - s.cost) / s.amount : 0,
      share: total > 0 ? s.amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

/** 商品別の売上集計 (売上高の多い順) */
export function salesProductSummaries(rows: SalesRow[]): SalesSummary[] {
  return summarize(rows, r => ({ key: r.productId, label: r.productName, sub: r.productSku }));
}

/** 得意先別の売上集計 (売上高の多い順)。得意先なしの売上は1つにまとめる */
export function salesCustomerSummaries(rows: SalesRow[]): SalesSummary[] {
  return summarize(rows, r => ({
    key: r.customerId,
    label: r.customerName || (r.customerId ? '（削除された得意先）' : '得意先なし'),
    sub: '',
  }));
}

/** 日別の売上集計。表示はこれだけ売上高順ではなく新しい日付順 (売上の推移を見るため) */
export function salesDailySummaries(rows: SalesRow[]): SalesSummary[] {
  const day = (r: SalesRow) => localDateKey(r.date);
  return summarize(rows, r => ({ key: day(r), label: day(r), sub: '' }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function salesCsv(rows: SalesRow[], warehouses: Warehouse[]): string {
  const whName = (id: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '';
  const header = '日時,商品名,SKU,ロットNo,倉庫,得意先,数量,売上単価(税抜),売上金額(税抜),税率,消費税,売上金額(税込),原価単価,原価金額,粗利,粗利率,概算,備考';
  const body = rows.map(r => [
    formatLedgerDateTime(r.date),
    r.productName,
    r.productSku,
    r.lotNo,
    whName(r.warehouseId),
    r.customerName,
    r.quantity,
    r.unitPrice,
    r.amount,
    `${r.taxRate}%`,
    r.tax,
    r.amountWithTax,
    r.unitCost,
    r.cost,
    r.profit,
    `${(r.profitRate * 100).toFixed(1)}%`,
    r.estimatedPrice || r.estimatedCost ? '概算' : '',
    r.note,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportSalesCsv(rows: SalesRow[], warehouses: Warehouse[]) {
  downloadCsv(csvFileName('sales'), salesCsv(rows, warehouses));
}

/** 集計表の CSV。1列目の見出し (商品名 / 得意先 / 日付) だけが切り口で変わる */
export function salesSummaryCsv(summaries: SalesSummary[], columnLabel: string): string {
  const header = `${columnLabel},補足,件数,数量,売上金額(税抜),消費税,売上金額(税込),原価,粗利,粗利率,構成比`;
  const body = summaries.map(s => [
    s.label,
    s.sub,
    s.count,
    s.quantity,
    s.amount,
    s.tax,
    s.amountWithTax,
    s.cost,
    s.profit,
    `${(s.profitRate * 100).toFixed(1)}%`,
    `${(s.share * 100).toFixed(1)}%`,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportSalesSummaryCsv(summaries: SalesSummary[], columnLabel: string) {
  downloadCsv(csvFileName('salesSummary'), salesSummaryCsv(summaries, columnLabel));
}

/** 得意先ごとの売上実績 (削除可否の判定と一覧表示に使う) */
export interface CustomerUsage {
  saleCount: number; // 売上明細の件数
  quantity: number;
  amount: number; // 売上金額
  profit: number;
  lastSaleAt: string; // 直近の売上日時 (ISO)。実績なしは空文字
}

const EMPTY_CUSTOMER_USAGE: CustomerUsage = { saleCount: 0, quantity: 0, amount: 0, profit: 0, lastSaleAt: '' };

/** customerId → 売上実績。得意先なし ('') の分もキー '' に集計する */
export function customerUsage(rows: SalesRow[]): Map<string, CustomerUsage> {
  const byId = new Map<string, CustomerUsage>();
  for (const r of rows) {
    const usage = byId.get(r.customerId) ?? { ...EMPTY_CUSTOMER_USAGE };
    usage.saleCount++;
    usage.quantity += r.quantity;
    usage.amount += r.amount;
    usage.profit += r.profit;
    if (r.date > usage.lastSaleAt) usage.lastSaleAt = r.date;
    byId.set(r.customerId, usage);
  }
  return byId;
}

/** 得意先マスタの1行 = 1得意先 + その得意先の売上実績 */
export interface CustomerRow {
  customer: Customer;
  usage: CustomerUsage;
}

/**
 * 絞り込み済みの得意先一覧。キーワードは得意先名・コード・担当者・電話・メールの部分一致。
 * 並びは 取引中が先 → 得意先名 (supplierRows と同じ)。includeInactive=false なら取引停止を除く。
 */
export function customerRows(
  customers: Customer[],
  sales: SalesRow[],
  keyword = '',
  includeInactive = true,
): CustomerRow[] {
  const q = keyword.trim().toLowerCase();
  const usageById = customerUsage(sales);
  return customers
    .filter(c => includeInactive || c.active)
    .filter(c => !q || [c.name, c.code, c.contact, c.phone, c.email].some(v => v.toLowerCase().includes(q)))
    .map(c => ({ customer: c, usage: usageById.get(c.id) ?? { ...EMPTY_CUSTOMER_USAGE } }))
    .sort((a, b) =>
      Number(b.customer.active) - Number(a.customer.active) || a.customer.name.localeCompare(b.customer.name));
}

export function customerCsv(rows: CustomerRow[]): string {
  const header = '得意先名,得意先コード,担当者,電話番号,メールアドレス,住所,取引状態,売上件数,売上数量,売上金額,粗利,最終売上日,備考';
  const body = rows.map(r => [
    r.customer.name,
    r.customer.code,
    r.customer.contact,
    r.customer.phone,
    r.customer.email,
    r.customer.address,
    r.customer.active ? '取引中' : '取引停止',
    r.usage.saleCount,
    r.usage.quantity,
    r.usage.amount,
    r.usage.profit,
    r.usage.lastSaleAt ? localDateKey(r.usage.lastSaleAt) : '',
    r.customer.note,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportCustomerCsv(rows: CustomerRow[]) {
  downloadCsv(csvFileName('customer'), customerCsv(rows));
}

// ---------------------------------------------------------------------------
// 発注履歴 (発注書として印刷した明細の履歴)
// ---------------------------------------------------------------------------

/** 発注履歴の1件 = 1回の印刷操作 (同じ printGroupId の行をまとめたもの) */
export interface PurchaseOrderPrintGroup {
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
  items: PurchaseOrderPrintItem[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PurchaseOrderHistoryFilter {
  keyword: string; // 仕入先名・商品名・SKU の部分一致
  supplierId: string;
  from: string; // 印刷日 YYYY-MM-DD (この日を含む)
  to: string;
}

export const EMPTY_PURCHASE_ORDER_HISTORY_FILTER: PurchaseOrderHistoryFilter = { keyword: '', supplierId: '', from: '', to: '' };

/**
 * 印刷履歴 (1行1明細) を印刷操作単位 (printGroupId) にまとめ、印刷日時の新しい順に返す。
 * 絞り込みはグループ単位で行う (キーワードは仕入先名か、含まれる明細のどれか1件の商品名・SKU に一致すればヒット)。
 */
export function purchaseOrderPrintGroups(
  prints: PurchaseOrderPrintItem[],
  filter: PurchaseOrderHistoryFilter = EMPTY_PURCHASE_ORDER_HISTORY_FILTER,
): PurchaseOrderPrintGroup[] {
  const byGroup = new Map<string, PurchaseOrderPrintItem[]>();
  for (const p of prints) {
    const list = byGroup.get(p.printGroupId);
    if (list) list.push(p); else byGroup.set(p.printGroupId, [p]);
  }

  const q = filter.keyword.trim().toLowerCase();
  const groups: PurchaseOrderPrintGroup[] = [];
  for (const items of byGroup.values()) {
    const head = items[0];
    if (filter.supplierId && head.supplierId !== filter.supplierId) continue;
    if (filter.from || filter.to) {
      const day = localDateKey(head.printedAt);
      if (filter.from && day < filter.from) continue;
      if (filter.to && day > filter.to) continue;
    }
    if (q && !(
      head.supplierName.toLowerCase().includes(q)
      || items.some(i => i.productName.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q))
    )) continue;

    groups.push({
      printGroupId: head.printGroupId,
      printedAt: head.printedAt,
      supplierId: head.supplierId,
      supplierName: head.supplierName,
      supplierAddress: head.supplierAddress,
      supplierContact: head.supplierContact,
      supplierPhone: head.supplierPhone,
      orderDate: head.orderDate,
      senderName: head.senderName,
      senderAddress: head.senderAddress,
      senderPhone: head.senderPhone,
      senderContact: head.senderContact,
      items,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      totalAmount: items.reduce((s, i) => s + i.amount, 0),
    });
  }
  return groups.sort((a, b) => b.printedAt.localeCompare(a.printedAt));
}

export function purchaseOrderHistoryCsv(groups: PurchaseOrderPrintGroup[]): string {
  const header = '印刷日時,発注日,仕入先,商品名,SKU,入荷予定日,数量,単価,金額';
  const body = groups.flatMap(g => g.items.map(i => [
    formatLedgerDateTime(g.printedAt),
    g.orderDate,
    g.supplierName,
    i.productName,
    i.productSku,
    i.expectedDate,
    i.quantity,
    i.unitPrice,
    i.amount,
  ].map(csvCell).join(',')));
  return [header, ...body].join('\n');
}

export function exportPurchaseOrderHistoryCsv(groups: PurchaseOrderPrintGroup[]) {
  downloadCsv(csvFileName('purchaseOrderHistory'), purchaseOrderHistoryCsv(groups));
}

// ---------------------------------------------------------------------------
// ロットトレーサビリティ (ロット追跡)
// リコール時に要るのは「このロットが、いつ入って、どこを経由して、いつ出たか」。
// 必要な記録は帳票 (ledger) にすべて残っているので専用の永続データは持たず、集計だけで組み立てる。
//
// ロットNo は賞味期限から自動生成される (generateLotNo) ため、期限が同じなら別商品でも同じ番号に
// なりうる。追跡は必ず「商品 + ロットNo」の組 (LotTraceKey) で行い、他商品の記録を巻き込まない。
// ---------------------------------------------------------------------------

/** 追跡対象のロット。ロットNo は商品をまたいで重複しうるので商品とセットで扱う */
export interface LotTraceKey {
  productId: string;
  lotNo: string;
}

export function isSameLotTraceKey(a?: LotTraceKey | null, b?: LotTraceKey | null): boolean {
  return !!a && !!b && a.productId === b.productId && a.lotNo === b.lotNo;
}

/**
 * 帳票を古い順 (時系列) に並べ直す。
 *
 * ledger は新しい記録を先頭に積むので基本は逆順にすればよいが、1回の操作でまとめて記録した分
 * (FEFO出庫の引当ごとの記録、ロット編集の 移動+数量調整 など) だけは日時が同一のまま
 * 「記録した順」で並んでいる。同じ日時が続く塊はそのままに、塊の並びだけを逆にすることで
 * 本来の時系列に戻す。最後に日時で安定ソートし、並びの崩れた入力にも耐えるようにする。
 */
export function chronologicalLedger(txns: StockTransaction[]): StockTransaction[] {
  const groups: StockTransaction[][] = [];
  for (const t of txns) {
    const last = groups.at(-1);
    if (last && last[0].date === t.date) last.push(t);
    else groups.push([t]);
  }
  return groups.reverse().flat().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/** タイムラインの1件 */
export interface LotTraceEvent {
  txn: StockTransaction;
  direction: 'in' | 'out' | 'move';
  /** この記録の直後のロット残数 (入庫の累計 − 出庫の累計)。移動では増減しない */
  balance: number;
}

/** 入庫・出庫の区分別内訳 */
export interface LotTraceBreakdown {
  type: TransactionType;
  count: number;
  quantity: number;
}

export interface LotTrace extends LotTraceKey {
  /** 商品名・SKU は帳票に残った「最後に記録した時点」のもの。記録がなければ空文字 */
  productName: string;
  productSku: string;
  /** 古い順 (入荷 → 移動 → 出庫) に並べたタイムライン */
  events: LotTraceEvent[];
  inbound: number; // 入庫の合計
  outbound: number; // 出庫の合計 (= 既に出た数量)
  balance: number; // 入庫 − 出庫 = 帳票から見た残数
  inboundBreakdown: LotTraceBreakdown[];
  outboundBreakdown: LotTraceBreakdown[];
  moveCount: number; // 移動の記録件数
  firstDate: string; // 最初に動いた日時 (ISO)。記録がなければ空文字
  lastDate: string; // 最後に動いた日時 (ISO)。同上
  /** 経由した倉庫を初めて現れた順に並べたもの */
  warehouseIds: string[];
}

export interface LotTraceOptions {
  /** 指定するとその商品の記録だけを追う (同じロットNoを持つ別商品を除く) */
  productId?: string;
}

const TYPE_ORDER = new Map(ALL_TRANSACTION_TYPES.map((t, i) => [t, i]));

function traceBreakdown(txns: StockTransaction[]): LotTraceBreakdown[] {
  const byType = new Map<TransactionType, LotTraceBreakdown>();
  for (const t of txns) {
    const row = byType.get(t.type) ?? { type: t.type, count: 0, quantity: 0 };
    row.count++;
    row.quantity += t.quantity;
    byType.set(t.type, row);
  }
  return [...byType.values()].sort((a, b) =>
    b.quantity - a.quantity || (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0));
}

/**
 * 1ロットの入出庫履歴を時系列に組み立てる。状態は一切参照・変更しない純粋関数。
 * 記録が1件もない場合も空の追跡結果を返す (在庫にはあるが帳票に記録のないロット
 * — サンプルデータの初期在庫など — を「記録なし」として表示できるように)。
 */
export function traceLot(ledger: StockTransaction[], lotNo: string, options: LotTraceOptions = {}): LotTrace {
  const matched = chronologicalLedger(
    ledger.filter(t => t.lotNo === lotNo && (!options.productId || t.productId === options.productId)),
  );
  const latest = matched.at(-1);

  const events: LotTraceEvent[] = [];
  const warehouseIds: string[] = [];
  const seenWarehouses = new Set<string>();
  const visit = (id?: string) => {
    if (!id || seenWarehouses.has(id)) return;
    seenWarehouses.add(id);
    warehouseIds.push(id);
  };

  let balance = 0;
  for (const txn of matched) {
    const direction = transactionDirection(txn.type);
    if (direction === 'in') balance += txn.quantity;
    else if (direction === 'out') balance -= txn.quantity;
    // 移動は「移動元 → 移動先」の順に経路へ積む
    visit(txn.fromWarehouseId);
    visit(txn.toWarehouseId);
    events.push({ txn, direction, balance });
  }

  const inboundTxns = matched.filter(t => transactionDirection(t.type) === 'in');
  const outboundTxns = matched.filter(t => transactionDirection(t.type) === 'out');

  return {
    productId: options.productId ?? latest?.productId ?? '',
    lotNo,
    productName: latest?.productName ?? '',
    productSku: latest?.productSku ?? '',
    events,
    inbound: inboundTxns.reduce((s, t) => s + t.quantity, 0),
    outbound: outboundTxns.reduce((s, t) => s + t.quantity, 0),
    balance,
    inboundBreakdown: traceBreakdown(inboundTxns),
    outboundBreakdown: traceBreakdown(outboundTxns),
    moveCount: matched.filter(t => t.type === '移動').length,
    firstDate: matched[0]?.date ?? '',
    lastDate: latest?.date ?? '',
    warehouseIds,
  };
}

/** いま在庫に残っている分の1行。部分移動で同じロットNoが複数の倉庫に分かれることがある */
export interface LotStockRow {
  lotId: string;
  warehouseId: string;
  quantity: number;
  expiryDate?: string;
}

/**
 * 追跡対象のロットが、いまどの倉庫にいくつ残っているか (在庫数の多い順)。
 * 出しきって空になったロット (FEFO出庫や部分移動の残り) は「残っている在庫」ではないので除く。
 */
export function lotStockRows(products: Product[], key: LotTraceKey): LotStockRow[] {
  const product = products.find(p => p.id === key.productId);
  if (!product) return [];
  return product.lots
    .filter(l => l.lotNo === key.lotNo && l.quantity > 0)
    .map(l => ({ lotId: l.id, warehouseId: l.warehouseId, quantity: l.quantity, expiryDate: l.expiryDate }))
    .sort((a, b) => b.quantity - a.quantity || a.warehouseId.localeCompare(b.warehouseId));
}

/** 追跡対象のロットの現在庫合計 */
export function lotStockQuantity(products: Product[], key: LotTraceKey): number {
  return lotStockRows(products, key).reduce((s, r) => s + r.quantity, 0);
}

/** 追跡できるロットの候補 */
export interface LotTraceCandidate extends LotTraceKey {
  productName: string;
  productSku: string;
  expiryDate?: string;
  stockQuantity: number; // 現在の在庫数。出しきった・廃棄したロットは 0
  eventCount: number; // 帳票に残っている記録件数
  lastDate: string; // 最後に動いた日時 (ISO)。記録がなければ空文字
}

/**
 * 追跡できるロットの一覧。キーワード (商品名・SKU・ロットNo の部分一致) で絞り込む。
 * 在庫から消えたロットも帳票に記録が残っていれば候補に出す
 * (リコールの連絡は出しきった後に来るので、現在庫だけを候補にすると追跡できない)。
 * 並びは「最後に動いた日時の新しい順」→ 商品名 → ロットNo。
 */
export function lotTraceCandidates(products: Product[], ledger: StockTransaction[], keyword = ''): LotTraceCandidate[] {
  const q = keyword.trim().toLowerCase();
  const keyOf = (productId: string, lotNo: string) => `${productId} ${lotNo}`;
  const byKey = new Map<string, LotTraceCandidate>();

  for (const p of products) {
    for (const l of p.lots) {
      const key = keyOf(p.id, l.lotNo);
      const row = byKey.get(key) ?? {
        productId: p.id, lotNo: l.lotNo, productName: p.name, productSku: p.sku,
        expiryDate: l.expiryDate, stockQuantity: 0, eventCount: 0, lastDate: '',
      };
      // 同じロットNoが複数倉庫に分かれている (部分移動の結果) 場合は1行にまとめる
      row.stockQuantity += l.quantity;
      row.expiryDate = row.expiryDate ?? l.expiryDate;
      byKey.set(key, row);
    }
  }

  const productById = new Map(products.map(p => [p.id, p]));
  for (const t of ledger) {
    const key = keyOf(t.productId, t.lotNo);
    const product = productById.get(t.productId);
    const row = byKey.get(key) ?? {
      productId: t.productId, lotNo: t.lotNo,
      // 商品マスタから消えていれば、帳票に残った当時の名前で追跡できるようにする
      productName: product?.name ?? t.productName,
      productSku: product?.sku ?? t.productSku,
      stockQuantity: 0, eventCount: 0, lastDate: '',
    };
    row.eventCount++;
    if (t.date > row.lastDate) row.lastDate = t.date;
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .filter(r => !q
      || r.lotNo.toLowerCase().includes(q)
      || r.productName.toLowerCase().includes(q)
      || r.productSku.toLowerCase().includes(q))
    .sort((a, b) =>
      b.lastDate.localeCompare(a.lastDate)
      || a.productName.localeCompare(b.productName)
      || a.lotNo.localeCompare(b.lotNo));
}

/** 追跡結果の CSV。回収報告の資料にそのまま添えられるよう、残数の推移も列に持たせる */
export function lotTraceCsv(trace: LotTrace, warehouses: Warehouse[]): string {
  const whName = (id?: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '';
  const header = '日時,区分,商品名,SKU,ロットNo,数量,移動元倉庫,移動先倉庫,残数,備考';
  const rows = trace.events.map(e => [
    formatLedgerDateTime(e.txn.date),
    e.txn.type,
    e.txn.productName,
    e.txn.productSku,
    e.txn.lotNo,
    signedQuantity(e.txn),
    whName(e.txn.fromWarehouseId),
    whName(e.txn.toWarehouseId),
    e.balance,
    e.txn.note,
  ].map(csvCell).join(','));
  return [header, ...rows].join('\n');
}

export function exportLotTraceCsv(trace: LotTrace, warehouses: Warehouse[]) {
  downloadCsv(csvFileName('trace'), lotTraceCsv(trace, warehouses));
}

// ---------------------------------------------------------------------------
// 在庫分析 (ABC分析・在庫回転率・滞留在庫・発注点の見直し提案)
// 専用の永続データは持たず、廃棄ロス集計・原価履歴と同じく「商品マスタ × 帳票」から
// 組み立てる読み取り専用の集計。唯一の例外が発注点の見直し提案で、これだけは
// Product.minQuantity を書き換えられる (在庫は動かないので帳票には何も書かない)。
//
// 金額はすべて原価ベース。現在庫は lotUnitCost (ロットの実原価) で評価するが、
// 出庫金額は帳票に単価が残っていない区分があるため「出庫数 × 商品の現在の原価」の
// 概算になる (廃棄ロス金額のフォールバックと同じ割り切り)。
// ---------------------------------------------------------------------------

/** 分析の対象期間 (日)。画面で切り替える */
export const ANALYSIS_PERIODS = [30, 90, 180, 365] as const;
export type AnalysisPeriod = typeof ANALYSIS_PERIODS[number];
export const DEFAULT_ANALYSIS_PERIOD: AnalysisPeriod = 90;

/** 「最終出庫からこの日数以上動いていなければ滞留」とみなすしきい値 (日)。画面で切り替える */
export const STAGNANT_THRESHOLDS = [30, 60, 90] as const;
export const DEFAULT_STAGNANT_DAYS = 60;

/** ABC分析の境目 (出庫金額の累計構成比)。上位70%がA、90%までがB、残りがC */
export const ABC_A_SHARE = 0.7;
export const ABC_B_SHARE = 0.9;

export type AbcRank = 'A' | 'B' | 'C';

/**
 * 分析期間の開始日 (ローカル日付 YYYY-MM-DD, この日を含む)。
 * days = 90 なら「今日を含む直近90日」なので 89日前が開始日になる。
 */
export function analysisPeriodStart(days: number, today = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Math.max(1, days) - 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

/** ローカル日付キー (YYYY-MM-DD) 同士の日数差。to が後なら正 */
function daysBetweenKeys(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24));
}

/** 在庫分析の1行 = 1商品 */
export interface StockAnalysisRow {
  productId: string;
  productName: string;
  productSku: string;
  categoryId: string;
  kind: ProductKind;
  quantity: number; // 現在庫数
  stockValue: number; // 現在庫金額 (ロットの実原価ベース)
  outboundQuantity: number; // 期間内の出庫数 (売上出庫 + 資材使用 + 調整出庫 + 廃棄)
  salesQuantity: number; // うち売上出庫の数
  disposalQuantity: number; // うち廃棄の数
  outboundValue: number; // 期間内の出庫金額 (原価ベースの概算)
  share: number; // 出庫金額の構成比 (0〜1)。販売品の中での比率 (資材は 0)
  cumulativeShare: number; // 出庫金額の累計構成比 (0〜1)。この行までの合計 (資材は 0)
  rank: AbcRank | null; // 資材は売らないので ABC の対象外 (null)
  dailyOutbound: number; // 1日あたりの平均出庫数 = 期間出庫数 ÷ 期間日数
  turnoverRate: number; // 期間の在庫回転率 = 期間出庫数 ÷ 現在庫数 (在庫0なら0)
  daysOfStock: number | null; // 在庫日数 = 現在庫数 ÷ 1日あたり出庫数。出庫実績がなければ null (= 減らない)
  lastOutboundAt: string; // 全期間での最終出庫日時 (ISO)。一度も出ていなければ空文字
  stagnantDays: number | null; // 最終出庫からの経過日数。一度も出ていなければ null
}

export interface StockAnalysisOptions {
  days?: number; // 集計期間 (既定 DEFAULT_ANALYSIS_PERIOD)
  today?: Date; // 集計の基準日 (既定は今日)。テストで固定するために外から渡せる
}

/**
 * 商品ごとに「どれだけ出たか (ABC)」「何日分の在庫を持っているか (回転)」
 * 「最後に動いたのはいつか (滞留)」をまとめる。状態は変更しない。
 *
 * - 出庫数は売上出庫・資材使用・調整出庫・廃棄の合計 (移動は総在庫を動かさないので数えない)。
 * - ABCランクは販売品だけで付ける (資材は rank = null)。資材は販売品のあとに出庫金額の大きい順で並べる。
 *   滞留・発注点の提案は資材も対象のまま (ラベルも切らしたり抱えすぎたりするため)。
 * - 最終出庫日だけは期間で絞らず全期間の帳票から探す (滞留の判定に期間を切ると、
 *   期間より前にしか動いていない商品が「出庫実績なし」と区別できなくなるため)。
 * - 並びは出庫金額の大きい順 (ABCランクを振る順序そのもの)。
 */
export function stockAnalysisRows(
  products: Product[],
  ledger: StockTransaction[],
  options: StockAnalysisOptions = {},
): StockAnalysisRow[] {
  const { days = DEFAULT_ANALYSIS_PERIOD, today = new Date() } = options;
  const from = analysisPeriodStart(days, today);
  const todayKey = localDateKey(today.toISOString());
  const periodDays = Math.max(1, days);

  const outbound = new Map<string, { total: number; sales: number; disposal: number; lastAt: string }>();
  for (const t of ledger) {
    if (transactionDirection(t.type) !== 'out') continue;
    const entry = outbound.get(t.productId) ?? { total: 0, sales: 0, disposal: 0, lastAt: '' };
    // 最終出庫日は期間外の記録も見る (滞留日数は「いつから動いていないか」なので期間に縛れない)
    if (t.date > entry.lastAt) entry.lastAt = t.date;
    if (localDateKey(t.date) >= from) {
      entry.total += t.quantity;
      if (t.type === '売上出庫') entry.sales += t.quantity;
      if (t.type === '廃棄') entry.disposal += t.quantity;
    }
    outbound.set(t.productId, entry);
  }

  const rows = products.map(p => {
    const entry = outbound.get(p.id);
    const quantity = totalQuantity(p);
    const outboundQuantity = entry?.total ?? 0;
    const dailyOutbound = outboundQuantity / periodDays;
    const lastOutboundAt = entry?.lastAt ?? '';
    return {
      productId: p.id,
      productName: p.name,
      productSku: p.sku,
      categoryId: p.categoryId,
      kind: productKind(p),
      quantity,
      stockValue: p.lots.reduce((s, l) => s + l.quantity * lotUnitCost(l, p), 0),
      outboundQuantity,
      salesQuantity: entry?.sales ?? 0,
      disposalQuantity: entry?.disposal ?? 0,
      outboundValue: outboundQuantity * p.costPrice,
      share: 0,
      cumulativeShare: 0,
      rank: null as AbcRank | null,
      dailyOutbound,
      turnoverRate: quantity > 0 ? outboundQuantity / quantity : 0,
      daysOfStock: dailyOutbound > 0 ? quantity / dailyOutbound : null,
      lastOutboundAt,
      stagnantDays: lastOutboundAt ? Math.max(0, daysBetweenKeys(localDateKey(lastOutboundAt), todayKey)) : null,
    };
  });

  rows.sort((a, b) =>
    Number(a.kind === '資材') - Number(b.kind === '資材')
    || b.outboundValue - a.outboundValue
    || b.outboundQuantity - a.outboundQuantity
    || a.productName.localeCompare(b.productName));

  // 累計構成比で A/B/C を振る。境目をまたぐ商品は上のランクに含める (ABC分析の慣習)。
  // 資材は売上に関係しないので、構成比の分母にも入れない
  const ranked = rows.filter(r => r.kind === '販売品');
  const total = ranked.reduce((s, r) => s + r.outboundValue, 0);
  let cumulative = 0;
  for (const row of ranked) {
    const share = total > 0 ? row.outboundValue / total : 0;
    const before = cumulative;
    cumulative += share;
    row.share = share;
    row.cumulativeShare = cumulative;
    // 出庫のなかった商品は構成比0なので、境目の手前にいても C に落とす
    row.rank = row.outboundValue <= 0 ? 'C' : before < ABC_A_SHARE ? 'A' : before < ABC_B_SHARE ? 'B' : 'C';
  }
  return rows;
}

/** 在庫を抱えたまま thresholdDays 以上出庫のない商品か (出庫実績が一度もないものも滞留扱い) */
export function isStagnant(row: StockAnalysisRow, thresholdDays: number = DEFAULT_STAGNANT_DAYS): boolean {
  if (row.quantity <= 0) return false; // 在庫がなければ「滞留している在庫」ではない
  return row.stagnantDays === null || row.stagnantDays >= thresholdDays;
}

/** 滞留在庫の一覧。金額の大きい順 (処分の検討はインパクトの大きいものから) */
export function stagnantRows(rows: StockAnalysisRow[], thresholdDays: number = DEFAULT_STAGNANT_DAYS): StockAnalysisRow[] {
  return rows
    .filter(r => isStagnant(r, thresholdDays))
    .sort((a, b) => b.stockValue - a.stockValue || (b.stagnantDays ?? Infinity) - (a.stagnantDays ?? Infinity));
}

export interface StockAnalysisTotals {
  productCount: number;
  stockValue: number; // 現在庫金額の合計
  outboundQuantity: number;
  outboundValue: number; // 期間内の出庫金額の合計
  daysOfStock: number | null; // 全体の在庫日数 = 在庫金額 ÷ 1日あたり出庫金額。出庫がなければ null
  rankCounts: Record<AbcRank, number>; // 販売品だけ (資材はランクなし)
  materialCount: number; // 資材の商品数
  stagnantCount: number;
  stagnantValue: number; // 滞留在庫の金額
}

export function stockAnalysisTotals(
  rows: StockAnalysisRow[],
  options: StockAnalysisOptions & { stagnantDays?: number } = {},
): StockAnalysisTotals {
  const { days = DEFAULT_ANALYSIS_PERIOD, stagnantDays = DEFAULT_STAGNANT_DAYS } = options;
  const totals: StockAnalysisTotals = {
    productCount: rows.length,
    stockValue: 0,
    outboundQuantity: 0,
    outboundValue: 0,
    daysOfStock: null,
    rankCounts: { A: 0, B: 0, C: 0 },
    materialCount: 0,
    stagnantCount: 0,
    stagnantValue: 0,
  };
  for (const r of rows) {
    totals.stockValue += r.stockValue;
    totals.outboundQuantity += r.outboundQuantity;
    totals.outboundValue += r.outboundValue;
    if (r.rank) totals.rankCounts[r.rank]++;
    else totals.materialCount++;
    if (isStagnant(r, stagnantDays)) {
      totals.stagnantCount++;
      totals.stagnantValue += r.stockValue;
    }
  }
  const dailyValue = totals.outboundValue / Math.max(1, days);
  totals.daysOfStock = dailyValue > 0 ? totals.stockValue / dailyValue : null;
  return totals;
}

/** 在庫分析の絞り込み条件。帳票と同じく「空文字はその条件では絞らない」 */
export interface StockAnalysisFilter {
  keyword: string; // 商品名・SKU の部分一致
  categoryId: string;
  rank: AbcRank | '';
}

export const EMPTY_STOCK_ANALYSIS_FILTER: StockAnalysisFilter = { keyword: '', categoryId: '', rank: '' };

export function filterStockAnalysis(rows: StockAnalysisRow[], filter: StockAnalysisFilter): StockAnalysisRow[] {
  const q = filter.keyword.trim().toLowerCase();
  return rows.filter(r => {
    if (q && !(r.productName.toLowerCase().includes(q) || r.productSku.toLowerCase().includes(q))) return false;
    if (filter.categoryId && r.categoryId !== filter.categoryId) return false;
    if (filter.rank && r.rank !== filter.rank) return false;
    return true;
  });
}

// ---- 発注点 (最低在庫数) の見直し提案 ----
// 発注点はこれまで商品マスタの手入力だけで、実際の出庫ペースとは無関係だった。
// 出庫実績から「リードタイム中に売れる数 + 安全在庫日数分」を計算して提案する。

/** 安全在庫として何日分を上乗せするか。画面で切り替える */
export const SAFETY_STOCK_DAYS_OPTIONS = [3, 7, 14] as const;
export const DEFAULT_SAFETY_STOCK_DAYS = 7;

/** 発注点の見直し提案の1行 = 1商品 */
export interface MinQuantitySuggestion {
  productId: string;
  productName: string;
  productSku: string;
  currentMinQuantity: number;
  suggestedMinQuantity: number;
  diff: number; // 提案値 - 現在値 (正なら引き上げ、負なら引き下げ)
  dailyOutbound: number;
  leadTimeDays: number; // 直近の入荷予定から引き継いだ仕入先の標準リードタイム
  safetyDays: number;
  supplierName: string; // 引き継いだ仕入先。なければ空文字 (リードタイム0で計算)
}

export interface MinQuantityOptions {
  safetyDays?: number;
}

/**
 * 出庫ペースから発注点の見直しを提案する。状態は変更しない。
 * 提案値 = ceil(1日あたり出庫数 × (標準リードタイム + 安全在庫日数))、最低1。
 *
 * リードタイムは発注提案 (reorderSuggestions) と同じく「直近に作った入荷予定の仕入先」から
 * 引き継ぐ。期間内に一度も出ていない商品は提案しない — 出庫ペース0から機械的に計算すると
 * 発注点が下がり、たまにしか動かない商品が欠品するため (滞留在庫として別に見る)。
 * 現在値と同じになる商品も提案には出さない。
 */
export function minQuantitySuggestions(
  rows: StockAnalysisRow[],
  products: Product[],
  inboundPlans: InboundPlan[],
  suppliers: Supplier[],
  options: MinQuantityOptions = {},
): MinQuantitySuggestion[] {
  const { safetyDays = DEFAULT_SAFETY_STOCK_DAYS } = options;

  const latestPlan = new Map<string, InboundPlan>();
  for (const plan of inboundPlans) {
    if (plan.canceledAt) continue;
    const current = latestPlan.get(plan.productId);
    if (!current || plan.createdAt > current.createdAt) latestPlan.set(plan.productId, plan);
  }
  const productById = new Map(products.map(p => [p.id, p]));

  const suggestions: MinQuantitySuggestion[] = [];
  for (const row of rows) {
    const product = productById.get(row.productId);
    if (!product || row.dailyOutbound <= 0) continue;
    // 取引停止・削除済みの仕入先のリードタイムは引き継がない (発注提案と同じ扱い)
    const supplier = suppliers.find(s => s.id === latestPlan.get(row.productId)?.supplierId && s.active);
    const leadTimeDays = supplier?.leadTimeDays ?? 0;
    const suggestedMinQuantity = Math.max(1, Math.ceil(row.dailyOutbound * (leadTimeDays + safetyDays)));
    if (suggestedMinQuantity === product.minQuantity) continue;
    suggestions.push({
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku,
      currentMinQuantity: product.minQuantity,
      suggestedMinQuantity,
      diff: suggestedMinQuantity - product.minQuantity,
      dailyOutbound: row.dailyOutbound,
      leadTimeDays,
      safetyDays,
      supplierName: supplier?.name ?? '',
    });
  }
  // ずれの大きい順 = 直す価値の大きい順
  return suggestions.sort((a, b) =>
    Math.abs(b.diff) - Math.abs(a.diff) || a.productName.localeCompare(b.productName));
}

/** 発注点の一括更新で渡す入力 */
export interface MinQuantityUpdate {
  productId: string;
  minQuantity: number;
}

/**
 * 選択された提案を一括更新の入力へ変換する。確認ダイアログのプレビューと実行が
 * この1つの結果を共有する (発注提案の planReorder・一括廃棄の planDisposal と同じ作り)。
 */
export interface MinQuantityPlan {
  targets: MinQuantitySuggestion[];
  updates: MinQuantityUpdate[];
  raised: number; // 引き上げる商品数
  lowered: number; // 引き下げる商品数
}

export function planMinQuantities(
  suggestions: MinQuantitySuggestion[],
  productIds: Iterable<string>,
): MinQuantityPlan {
  const ids = new Set(productIds);
  const targets = suggestions.filter(s => ids.has(s.productId));
  return {
    targets,
    updates: targets.map(s => ({ productId: s.productId, minQuantity: s.suggestedMinQuantity })),
    raised: targets.filter(s => s.diff > 0).length,
    lowered: targets.filter(s => s.diff < 0).length,
  };
}

export function stockAnalysisCsv(rows: StockAnalysisRow[], categories: Category[]): string {
  const categoryName = (id: string) => categories.find(c => c.id === id)?.name ?? '';
  const header = 'ABCランク,区分,商品名,SKU,カテゴリ,在庫数,在庫金額（原価）,期間出庫数,売上出庫数,廃棄数,'
    + '出庫金額（原価）,構成比,累計構成比,1日あたり出庫数,在庫回転率,在庫日数,最終出庫日,滞留日数';
  const body = rows.map(r => [
    r.rank ?? '対象外',
    r.kind,
    r.productName,
    r.productSku,
    categoryName(r.categoryId),
    r.quantity,
    Math.round(r.stockValue),
    r.outboundQuantity,
    r.salesQuantity,
    r.disposalQuantity,
    Math.round(r.outboundValue),
    (r.share * 100).toFixed(1),
    (r.cumulativeShare * 100).toFixed(1),
    r.dailyOutbound.toFixed(2),
    r.turnoverRate.toFixed(2),
    r.daysOfStock == null ? '' : Math.round(r.daysOfStock),
    r.lastOutboundAt ? localDateKey(r.lastOutboundAt) : '',
    r.stagnantDays ?? '',
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportStockAnalysisCsv(rows: StockAnalysisRow[], categories: Category[]) {
  downloadCsv(csvFileName('analysis'), stockAnalysisCsv(rows, categories));
}

/** 入荷予定の入力値 (id・入荷実績・日時は画面から編集しない) */
export type InboundPlanInput = Omit<InboundPlan, 'id' | 'receivedQuantity' | 'canceledAt' | 'createdAt' | 'updatedAt'>;

export function useInventory() {
  // API から取得できるまで (またはできない環境では) サンプルデータで動作する
  const [products, setProducts] = useState<Product[]>(SAMPLE_DATA);
  const [ledger, setLedger] = useState<StockTransaction[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(DEFAULT_WAREHOUSES);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [inboundPlans, setInboundPlans] = useState<InboundPlan[]>(SAMPLE_INBOUND_PLANS);
  const [suppliers, setSuppliers] = useState<Supplier[]>(DEFAULT_SUPPLIERS);
  const [purchaseOrderPrints, setPurchaseOrderPrints] = useState<PurchaseOrderPrintItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>(DEFAULT_CUSTOMERS);

  // マウント時に D1 の内容で状態を上書きする (サーバー側が常に正)
  useEffect(() => {
    let cancelled = false;
    fetchState().then(state => {
      if (cancelled || !state) return;
      const baseCategories = (state.categories?.length ?? 0) > 0 ? state.categories : DEFAULT_CATEGORIES;
      const migrated = migrateProducts(state.products, baseCategories);
      setProducts(migrated.products);
      setCategories(migrated.categories);
      setWarehouses(state.warehouses.length > 0 ? state.warehouses : DEFAULT_WAREHOUSES);
      // 仕入先マスタ導入前の予定は仕入先が自由入力の文字列なので、マスタへ移してから保存し直す
      const migratedPlans = migrateInboundPlans(state.inboundPlans ?? [], state.suppliers ?? []);
      setInboundPlans(migratedPlans.plans);
      setSuppliers(migratedPlans.suppliers);
      if (migratedPlans.suppliers.length !== (state.suppliers?.length ?? 0)) {
        saveSuppliers(migratedPlans.suppliers);
        saveInboundPlans(migratedPlans.plans);
      }
      const { txns, changed } = migrateLedger(state.ledger);
      setLedger(txns);
      if (changed) saveLedger(txns);
      setPurchaseOrderPrints(state.purchaseOrderPrints ?? []);
      setCustomers(state.customers ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  // 棚卸のように複数件をまとめて記録したいとき用。1回の state 更新・1回の保存で済ませる
  const addTransactions = useCallback((txns: Omit<StockTransaction, 'id' | 'date'>[]) => {
    if (txns.length === 0) return;
    setLedger(prev => {
      const date = new Date().toISOString();
      const created = txns.map(t => ({ ...t, id: crypto.randomUUID(), date }));
      const next = [...created, ...prev];
      saveLedger(next);
      return next;
    });
  }, []);

  const addTransaction = useCallback((txn: Omit<StockTransaction, 'id' | 'date'>) => {
    addTransactions([txn]);
  }, [addTransactions]);

  const update = (next: Product[]) => { save(next); setProducts(next); };

  const addProduct = useCallback((data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => {
    setProducts(prev => {
      const next = [...prev, { ...data, id: crypto.randomUUID(), lots: [], updatedAt: new Date().toISOString() }];
      save(next); return next;
    });
  }, []);

  const updateProduct = useCallback((id: string, data: Omit<Product, 'id' | 'updatedAt' | 'lots'>) => {
    setProducts(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p);
      save(next); return next;
    });
  }, []);

  // 在庫分析の発注点提案からの一括更新。在庫は動かないので帳票には何も書かない。
  // 棚卸 (applyStocktake) と同じく1回の state 更新・1回の保存でまとめて反映する。
  const applyMinQuantities = useCallback((updates: MinQuantityUpdate[]): number => {
    const byId = new Map<string, number>();
    for (const u of updates) {
      if (!Number.isFinite(u.minQuantity) || u.minQuantity < 0) continue;
      byId.set(u.productId, Math.floor(u.minQuantity));
    }
    // 実際に値が変わる商品だけを数える (同じ値・存在しない商品は更新件数に含めない)
    const changed = products.filter(p => {
      const min = byId.get(p.id);
      return min != null && min !== p.minQuantity;
    }).length;
    if (changed === 0) return 0;
    setProducts(prev => {
      const now = new Date().toISOString();
      let dirty = false;
      const next = prev.map(p => {
        const min = byId.get(p.id);
        if (min == null || min === p.minQuantity) return p;
        dirty = true;
        return { ...p, minQuantity: min, updatedAt: now };
      });
      if (!dirty) return prev;
      save(next); return next;
    });
    return changed;
  }, [products]);

  const deleteProduct = useCallback((id: string) => {
    const product = products.find(p => p.id === id);
    setProducts(prev => { const next = prev.filter(p => p.id !== id); save(next); return next; });
    // 商品のない入荷予定は入荷しようがないので一緒に消す (帳票に残った入荷実績はそのまま)
    setInboundPlans(prev => {
      if (!prev.some(p => p.productId === id)) return prev;
      const next = prev.filter(p => p.productId !== id);
      saveInboundPlans(next); return next;
    });
    // 商品を消すと在庫も一緒に消えるので、残っていたロットの分を 調整出庫 として帳票に残す
    if (product) {
      addTransactions(product.lots.filter(l => l.quantity > 0).map(l => ({
        type: '調整出庫' as TransactionType,
        productId: id,
        productName: product.name,
        productSku: product.sku,
        lotNo: l.lotNo,
        quantity: l.quantity,
        note: '商品削除',
        fromWarehouseId: l.warehouseId,
      })));
    }
  }, [addTransactions, products]);

  const addLot = useCallback((productId: string, lot: Omit<Lot, 'id' | 'warehouseId'> & { warehouseId?: string }) => {
    const lotWithWarehouse = { ...lot, warehouseId: lot.warehouseId ?? DEFAULT_WAREHOUSE_ID };
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: [...p.lots, { ...lotWithWarehouse, id: crypto.randomUUID() }], updatedAt: new Date().toISOString() }
        : p);
      save(next);
      return next;
    });
    const product = products.find(p => p.id === productId);
    if (product && lot.quantity > 0) {
      addTransaction({ type: '入荷', productId, productName: product.name, productSku: product.sku, lotNo: lot.lotNo, quantity: lot.quantity, note: 'ロット追加', toWarehouseId: lotWithWarehouse.warehouseId });
    }
  }, [addTransaction, products]);

  // 編集フォームは数量も倉庫も直接書き換えられるので、その差分を帳票に残す。
  // 両方変わったときは「移動してから数量を調整した」とみなす (移動は編集前の数量、
  // 数量調整は移動後の倉庫に付く) ことで、倉庫ごとの増減が食い違わないようにする。
  const updateLot = useCallback((productId: string, lotId: string, lot: Omit<Lot, 'id'>) => {
    const product = products.find(p => p.id === productId);
    const before = product?.lots.find(l => l.id === lotId);
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.map(l => l.id === lotId ? { ...lot, id: lotId } : l), updatedAt: new Date().toISOString() }
        : p);
      save(next); return next;
    });
    if (!product || !before) return;

    const base = { productId, productName: product.name, productSku: product.sku, lotNo: lot.lotNo, note: 'ロット編集' };
    const txns: Omit<StockTransaction, 'id' | 'date'>[] = [];
    if (before.warehouseId !== lot.warehouseId && before.quantity > 0) {
      txns.push({ ...base, type: '移動', quantity: before.quantity, fromWarehouseId: before.warehouseId, toWarehouseId: lot.warehouseId });
    }
    const delta = lot.quantity - before.quantity;
    if (delta !== 0) {
      txns.push({
        ...base,
        type: delta > 0 ? '調整入庫' : '調整出庫',
        quantity: Math.abs(delta),
        ...(delta > 0 ? { toWarehouseId: lot.warehouseId } : { fromWarehouseId: lot.warehouseId }),
      });
    }
    addTransactions(txns);
  }, [addTransactions, products]);

  const deleteLot = useCallback((productId: string, lotId: string) => {
    const product = products.find(p => p.id === productId);
    const lot = product?.lots.find(l => l.id === lotId);
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.filter(l => l.id !== lotId), updatedAt: new Date().toISOString() }
        : p);
      save(next); return next;
    });
    // ロットを消した分だけ在庫が減るので、調整出庫として帳票に残す
    if (product && lot && lot.quantity > 0) {
      addTransaction({
        type: '調整出庫',
        productId,
        productName: product.name,
        productSku: product.sku,
        lotNo: lot.lotNo,
        quantity: lot.quantity,
        note: 'ロット削除',
        fromWarehouseId: lot.warehouseId,
      });
    }
  }, [addTransaction, products]);

  const adjustLotQuantity = useCallback((productId: string, lotId: string, delta: number, type?: TransactionType, sale?: SaleFields) => {
    const product = products.find(p => p.id === productId);
    const lot = product?.lots.find(l => l.id === lotId);
    const actualDelta = lot ? (delta > 0 ? delta : -Math.min(-delta, lot.quantity)) : 0;
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.map(l => l.id === lotId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l), updatedAt: new Date().toISOString() }
        : p);
      save(next);
      return next;
    });
    if (product && lot && actualDelta !== 0) {
      const requestedType = type ?? (actualDelta > 0 ? '調整入庫' : '調整出庫');
      // 資材の売上出庫・販売品の資材使用は区分の取り違えなので、調整出庫として記録する (在庫は減らす)
      const txnType = transactionDirection(requestedType) === 'out'
        && !outboundTypesFor(product).includes(requestedType as OutboundTransactionType)
        ? '調整出庫'
        : requestedType;
      addTransaction({
        type: txnType,
        productId,
        productName: product.name,
        productSku: product.sku,
        lotNo: lot.lotNo,
        quantity: Math.abs(actualDelta),
        note: '',
        // 倉庫での絞り込み・集計ができるよう、入出庫にもロットの倉庫を残す
        ...(transactionDirection(txnType) === 'out'
          ? { fromWarehouseId: lot.warehouseId }
          : { toWarehouseId: lot.warehouseId }),
        // 売上出庫のときだけ実売単価・得意先・そのロットの原価も残す (FEFO出庫と同じ)
        ...(txnType === '売上出庫' ? saleFields(product, lotUnitCost(lot, product), sale?.unitPrice, sale?.customerId) : {}),
      });
    }
  }, [addTransaction, products]);

  // FEFO 出庫: 商品と数量だけを受け取り、賞味期限の近いロットから順に引き落とす。
  // 引当先の決定は planFefoShipment (純粋関数) に任せ、ここでは在庫の反映と帳票への記録だけを行う。
  // 在庫が足りないときは引ける分だけ引き当て、不足数を shortage として返す (呼び出し側が通知する)。
  const shipFefo = useCallback((productId: string, quantity: number, options: FefoShipOptions = {}): FefoPlan => {
    const product = products.find(p => p.id === productId);
    if (!product) return { allocations: [], allocated: 0, shortage: Math.max(0, Math.floor(quantity)), skippedExpired: 0, cost: 0 };

    const plan = planFefoShipment(product, quantity, options);
    if (plan.allocations.length === 0) return plan;

    const takenByLotId = new Map(plan.allocations.map(a => [a.lotId, a.quantity]));
    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => p.id === productId
        ? {
            ...p,
            updatedAt: now,
            lots: p.lots.map(l => takenByLotId.has(l.id) ? { ...l, quantity: l.quantity - takenByLotId.get(l.id)! } : l),
          }
        : p);
      save(next);
      return next;
    });

    // 引き当てたロットごとに1件ずつ記録する (どのロットを何個出したかが帳票に残るように)
    // 区分の既定は 販売品なら売上出庫・資材なら資材使用。その商品で選べない区分 (資材の売上出庫など) は
    // 取り違えなので調整出庫として記録する (adjustLotQuantity と同じ扱い)
    const allowedTypes = outboundTypesFor(product);
    const type: TransactionType = !options.type ? allowedTypes[0]
      : allowedTypes.includes(options.type) ? options.type
      : '調整出庫';
    const isSale = type === '売上出庫';
    addTransactions(plan.allocations.map(a => ({
      type,
      productId,
      productName: product.name,
      productSku: product.sku,
      lotNo: a.lotNo,
      quantity: a.quantity,
      note: options.note ?? 'FEFO出庫',
      fromWarehouseId: a.warehouseId,
      // 売上だけが実売単価・得意先・出庫時点の原価を持つ (売上高と粗利をあとから集計するため)。
      // 単価 0 は入荷予定の仕入単価と同じく「未入力」扱いで、帳票には書かない
      ...(isSale ? saleFields(product, a.unitCost, options.unitPrice, options.customerId) : {}),
    })));

    return plan;
  }, [addTransactions, products]);

  /**
   * 売上登録 (売上管理タブ)。実際の出庫は FEFO 出庫そのもので、区分を 売上出庫 に固定し、
   * 実売単価と得意先を一緒に帳票へ残すだけの薄いラッパー。引当結果 (不足の有無) を返す。
   */
  const recordSale = useCallback((input: SaleInput): FefoPlan => {
    // 資材は売らないので売上にしない (在庫も動かさず、全量を不足として返す)
    const product = products.find(p => p.id === input.productId);
    if (product && isMaterial(product)) {
      return { allocations: [], allocated: 0, shortage: Math.max(0, Math.floor(input.quantity)), skippedExpired: 0, cost: 0 };
    }
    return shipFefo(input.productId, input.quantity, {
      warehouseId: input.warehouseId,
      includeExpired: input.includeExpired,
      type: '売上出庫',
      note: input.note?.trim() || SALE_NOTE,
      unitPrice: input.unitPrice,
      customerId: input.customerId,
    });
  }, [products, shipFefo]);

  /**
   * 選んだロットをまとめて廃棄する。引当先の決定は planDisposal (純粋関数) に任せ、
   * ここでは在庫の反映と帳票への記録だけを行う。ロットごとに 廃棄 を1件記録する。
   *
   * 廃棄したロットは在庫0にするのではなく取り除く。中身の無くなったロットを一覧に
   * 残さないためで、何をいくつ廃棄したかは帳票に残る。
   */
  const disposeLots = useCallback((lotIds: string[], note: string = DISPOSAL_NOTE): DisposalPlan => {
    const plan = planDisposal(products, lotIds);
    if (plan.targets.length === 0) return plan;

    const disposed = new Set(plan.targets.map(t => t.lotId));
    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => p.lots.some(l => disposed.has(l.id))
        ? { ...p, updatedAt: now, lots: p.lots.filter(l => !disposed.has(l.id)) }
        : p);
      save(next);
      return next;
    });

    addTransactions(plan.targets.map(t => ({
      type: '廃棄' as TransactionType,
      productId: t.productId,
      productName: t.productName,
      productSku: t.productSku,
      lotNo: t.lotNo,
      quantity: t.quantity,
      note,
      fromWarehouseId: t.warehouseId,
      unitPrice: t.costPrice,
    })));

    return plan;
  }, [addTransactions, products]);

  // ---- 入荷予定 ----
  // 予定の作成・編集・キャンセルは在庫を動かさないので帳票には記録しない。
  // 在庫が動くのは receiveInboundPlan (入荷) のときだけ。

  const addInboundPlan = useCallback((data: InboundPlanInput) => {
    setInboundPlans(prev => {
      const now = new Date().toISOString();
      const next = [...prev, { ...data, id: crypto.randomUUID(), receivedQuantity: 0, createdAt: now, updatedAt: now }];
      saveInboundPlans(next); return next;
    });
  }, []);

  /**
   * 入荷予定の一括登録 (発注提案からの発注登録)。1回の state 更新 / 1回の PUT にまとめる。
   * 数量 0 の入力は予定として意味がないので落とす。作成した件数を返す。
   */
  const addInboundPlans = useCallback((inputs: InboundPlanInput[]): number => {
    const valid = inputs.filter(i => i.quantity > 0);
    if (valid.length === 0) return 0;
    setInboundPlans(prev => {
      const now = new Date().toISOString();
      const created = valid.map(data => ({ ...data, id: crypto.randomUUID(), receivedQuantity: 0, createdAt: now, updatedAt: now }));
      const next = [...prev, ...created];
      saveInboundPlans(next); return next;
    });
    return valid.length;
  }, []);

  // 入荷実績 (receivedQuantity) は編集対象外。キャンセル済みの予定は編集しない
  const updateInboundPlan = useCallback((id: string, data: InboundPlanInput) => {
    setInboundPlans(prev => {
      if (!prev.some(p => p.id === id && !p.canceledAt)) return prev;
      const next = prev.map(p => p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p);
      saveInboundPlans(next); return next;
    });
  }, []);

  // キャンセルは予定を消さずに残す (入荷済みの分は在庫・帳票にそのまま残るため)
  const cancelInboundPlan = useCallback((id: string) => {
    setInboundPlans(prev => {
      if (!prev.some(p => p.id === id && !p.canceledAt)) return prev;
      const now = new Date().toISOString();
      const next = prev.map(p => p.id === id ? { ...p, canceledAt: now, updatedAt: now } : p);
      saveInboundPlans(next); return next;
    });
  }, []);

  const deleteInboundPlan = useCallback((id: string) => {
    setInboundPlans(prev => {
      const next = prev.filter(p => p.id !== id);
      saveInboundPlans(next); return next;
    });
  }, []);

  /**
   * 発注書を印刷する (PurchaseOrderModal の「印刷」ボタンから、選択中の明細をまとめて渡す)。
   * 1) 対象の入荷予定に印刷日時を記録し、次回発注書を開いたときチェックできなくする
   *    (purchaseOrderRows 自体は前回印刷したかを見ないため。二重発注の防止)
   * 2) 印刷内容 (仕入先・発注元・明細) のスナップショットを purchaseOrderPrints に追加し、
   *    あとから同じ内容を再表示・再印刷できるようにする (docs/purchase-order-history-feature.md)
   * 在庫は動かないので帳票には何も記録しない
   */
  const printPurchaseOrder = useCallback((input: PrintPurchaseOrderInput) => {
    if (input.rows.length === 0) return;
    const now = new Date().toISOString();
    const printGroupId = crypto.randomUUID();

    setInboundPlans(prev => {
      const idSet = new Set(input.rows.map(r => r.plan.id));
      const next = prev.map(p => idSet.has(p.id) ? { ...p, printedAt: now, updatedAt: now } : p);
      saveInboundPlans(next); return next;
    });

    setPurchaseOrderPrints(prev => {
      const created: PurchaseOrderPrintItem[] = input.rows.map(r => ({
        id: crypto.randomUUID(),
        printGroupId,
        printedAt: now,
        supplierId: input.supplier.id,
        supplierName: input.supplier.name,
        supplierAddress: input.supplier.address,
        supplierContact: input.supplier.contact,
        supplierPhone: input.supplier.phone,
        orderDate: input.orderDate,
        senderName: input.sender.name,
        senderAddress: input.sender.address,
        senderPhone: input.sender.phone,
        senderContact: input.sender.contact,
        inboundPlanId: r.plan.id,
        productName: r.productName,
        productSku: r.productSku,
        expectedDate: r.plan.expectedDate,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        amount: r.amount,
      }));
      const next = [...prev, ...created];
      savePurchaseOrderPrints(next); return next;
    });
  }, []);

  /**
   * 入荷予定にもとづく入荷。予定のロットへ在庫を積み、帳票に 入荷 を1件記録する。
   * 引当先の決定は planReceipt (純粋関数) に任せ、ここでは在庫・予定・帳票の更新だけを行う。
   * 数量は残数を超えない範囲に丸められ、0 になる場合は何もしない (null を返す)。
   */
  const receiveInboundPlan = useCallback((id: string, input: ReceiveInput): ReceiptResult | null => {
    const plan = inboundPlans.find(p => p.id === id);
    if (!plan || plan.canceledAt) return null;
    const product = products.find(p => p.id === plan.productId);
    if (!product) return null;

    const target = planReceipt(plan, product, input);
    if (target.quantity <= 0) return null;
    const mergedPrice = mergedLotUnitPrice(target.existingLot, product, target.quantity, plan.unitPrice);

    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => {
        if (p.id !== product.id) return p;
        const lots = target.existingLot
          ? p.lots.map(l => l.id === target.existingLot!.id
              ? { ...l, quantity: l.quantity + target.quantity, ...(mergedPrice != null ? { unitPrice: mergedPrice } : {}) }
              : l)
          : [...p.lots, {
              id: crypto.randomUUID(),
              lotNo: target.lotNo,
              ...(target.expiryDate ? { expiryDate: target.expiryDate } : {}),
              quantity: target.quantity,
              warehouseId: target.warehouseId,
              ...(mergedPrice != null ? { unitPrice: mergedPrice } : {}),
            }];
        return { ...p, lots, updatedAt: now };
      });
      save(next);
      return next;
    });

    setInboundPlans(prev => {
      const next = prev.map(p => p.id === id
        ? { ...p, receivedQuantity: p.receivedQuantity + target.quantity, updatedAt: new Date().toISOString() }
        : p);
      saveInboundPlans(next);
      return next;
    });

    // 仕入先は id 参照なので、帳票に残す名前はこの時点のマスタから解決する
    const supplier = supplierName(suppliers, plan.supplierId);
    addTransaction({
      type: '入荷',
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      lotNo: target.lotNo,
      quantity: target.quantity,
      note: input.note?.trim() || (supplier ? `入荷予定（${supplier}）` : '入荷予定'),
      toWarehouseId: target.warehouseId,
      unitPrice: plan.unitPrice,
      ...(plan.supplierId ? { supplierId: plan.supplierId } : {}),
    });

    return {
      ...target,
      remaining: remainingInbound(plan) - target.quantity,
      merged: !!target.existingLot,
    };
  }, [addTransaction, inboundPlans, products, suppliers]);

  const exportExcel = useCallback(() => {
    const wsData: (string | number)[][] = [['SKU', 'ロットNo', '在庫数']];
    for (const p of products) {
      for (const l of p.lots) {
        wsData.push([p.sku, l.lotNo, l.quantity]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '在庫インポート');
    XLSX.writeFile(wb, `inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [products]);

  const exportCsv = useCallback(() => {
    const categoryName = (id: string) => categories.find(c => c.id === id)?.name ?? '';
    const header = '商品名,SKU,JANコード,カテゴリ,区分,販売定価(税抜),原価,税率,ロットNo,賞味期限,在庫数';
    const rows = products.flatMap(p => {
      // 資材は売らないので販売定価・税率は空欄にする
      const material = isMaterial(p);
      const head = [
        p.name, p.sku, p.janCode ?? '', categoryName(p.categoryId), productKind(p),
        material ? '' : p.price, p.costPrice, material ? '' : `${productTaxRate(p)}%`,
      ];
      return p.lots.length > 0
        ? p.lots.map(l => [...head, l.lotNo, l.expiryDate ?? '', l.quantity].join(','))
        : [[...head, '', '', 0].join(',')];
    });
    downloadCsv(csvFileName('inventory'), header + '\n' + rows.join('\n'));
  }, [products, categories]);

  const importExcel = useCallback((file: File): Promise<{ updated: number; errors: string[] }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

          const errors: string[] = [];
          type Change = { productId: string; lotId: string; newQty: number; delta: number };
          const changes: Change[] = [];

          for (const row of rows) {
            const sku = String(row['SKU'] ?? row['sku'] ?? '').trim();
            const lotNo = String(row['ロットNo'] ?? row['lotNo'] ?? row['lot_no'] ?? '').trim();
            const rawQty = row['在庫数'] ?? row['quantity'] ?? row['数量'];
            const qty = Number(rawQty);

            if (!sku) { errors.push(`SKUが空の行をスキップ`); continue; }
            if (!lotNo) { errors.push(`ロットNoが空の行をスキップ (SKU: ${sku})`); continue; }
            if (isNaN(qty) || qty < 0) { errors.push(`在庫数が不正: SKU=${sku} ロット=${lotNo}`); continue; }

            const product = products.find(p => p.sku === sku);
            if (!product) { errors.push(`SKUが見つかりません: ${sku}`); continue; }

            const lot = product.lots.find(l => l.lotNo === lotNo);
            if (!lot) { errors.push(`ロットが見つかりません: SKU=${sku} ロット=${lotNo}`); continue; }

            const delta = qty - lot.quantity;
            if (delta !== 0) changes.push({ productId: product.id, lotId: lot.id, newQty: qty, delta });
          }

          if (changes.length > 0) {
            setProducts(prev => {
              const now = new Date().toISOString();
              const next = prev.map(p => {
                const affected = changes.filter(c => c.productId === p.id);
                if (affected.length === 0) return p;
                return {
                  ...p,
                  updatedAt: now,
                  lots: p.lots.map(l => {
                    const c = affected.find(c => c.lotId === l.id);
                    return c ? { ...l, quantity: c.newQty } : l;
                  }),
                };
              });
              save(next);
              return next;
            });

            for (const c of changes) {
              const product = products.find(p => p.id === c.productId);
              const lot = product?.lots.find(l => l.id === c.lotId);
              if (product && lot) {
                addTransaction({
                  type: c.delta > 0 ? '調整入庫' : '調整出庫',
                  productId: product.id,
                  productName: product.name,
                  productSku: product.sku,
                  lotNo: lot.lotNo,
                  quantity: Math.abs(c.delta),
                  note: 'Excelインポート',
                  ...(c.delta > 0 ? { toWarehouseId: lot.warehouseId } : { fromWarehouseId: lot.warehouseId }),
                });
              }
            }
          }

          resolve({ updated: changes.length, errors });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }, [addTransaction, products]);

  const addWarehouse = useCallback((name: string, color: string) => {
    setWarehouses(prev => {
      const next = [...prev, { id: crypto.randomUUID(), name, color }];
      saveWarehouses(next); return next;
    });
  }, []);

  const updateWarehouse = useCallback((id: string, name: string, color: string) => {
    setWarehouses(prev => {
      const next = prev.map(w => w.id === id ? { ...w, name, color } : w);
      saveWarehouses(next); return next;
    });
  }, []);

  // ロットだけでなく、入荷先に指定されている入荷予定 (未入荷・一部入荷) が残っていても削除しない
  const deleteWarehouse = useCallback((id: string) => {
    const inUse = products.some(p => p.lots.some(l => l.warehouseId === id))
      || inboundPlans.some(p => p.warehouseId === id && remainingInbound(p) > 0);
    if (inUse) return;
    setWarehouses(prev => {
      const next = prev.filter(w => w.id !== id);
      saveWarehouses(next); return next;
    });
  }, [inboundPlans, products]);

  const addCategory = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories(prev => {
      if (prev.some(c => c.name === trimmed)) return prev;
      const next = [...prev, { id: crypto.randomUUID(), name: trimmed }];
      saveCategories(next); return next;
    });
  }, []);

  const updateCategory = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories(prev => {
      // 他カテゴリと同名になる変更は不可 (名前の一意性を保つ)
      if (prev.some(c => c.id !== id && c.name === trimmed)) return prev;
      const next = prev.map(c => c.id === id ? { ...c, name: trimmed } : c);
      saveCategories(next); return next;
    });
  }, []);

  const deleteCategory = useCallback((id: string) => {
    const inUse = products.some(p => p.categoryId === id);
    if (inUse) return;
    setCategories(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCategories(next); return next;
    });
  }, [products]);

  // ---- 仕入先マスタ ----
  // 入荷予定が id で参照するだけなので在庫は動かない (帳票にも記録しない)。
  // 画面と同じ supplierValidationError で弾くので、画面に出るエラーと実際の拒否条件がずれない。

  const addSupplier = useCallback((input: SupplierInput) => {
    setSuppliers(prev => {
      if (supplierValidationError(input, prev)) return prev;
      const next = [...prev, { ...normalizeSupplierInput(input), id: crypto.randomUUID() }];
      saveSuppliers(next); return next;
    });
  }, []);

  const updateSupplier = useCallback((id: string, input: SupplierInput) => {
    setSuppliers(prev => {
      if (!prev.some(s => s.id === id)) return prev;
      if (supplierValidationError(input, prev, id)) return prev;
      const next = prev.map(s => s.id === id ? { ...normalizeSupplierInput(input), id } : s);
      saveSuppliers(next); return next;
    });
  }, []);

  // 入荷予定から参照されている仕入先は削除しない (予定の仕入先が消えてしまうため)。
  // 取引が終わっただけなら削除ではなく active=false にしてもらう
  const deleteSupplier = useCallback((id: string) => {
    if (inboundPlans.some(p => p.supplierId === id)) return;
    setSuppliers(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSuppliers(next); return next;
    });
  }, [inboundPlans]);

  // ---- 得意先マスタ ----
  // 売上出庫の帳票が id で参照するだけなので、マスタ自体は在庫を動かさない (帳票にも記録しない)。
  // 画面と同じ customerValidationError で弾くので、画面に出るエラーと実際の拒否条件がずれない。

  const addCustomer = useCallback((input: CustomerInput) => {
    setCustomers(prev => {
      if (customerValidationError(input, prev)) return prev;
      const next = [...prev, { ...normalizeCustomerInput(input), id: crypto.randomUUID() }];
      saveCustomers(next); return next;
    });
  }, []);

  const updateCustomer = useCallback((id: string, input: CustomerInput) => {
    setCustomers(prev => {
      if (!prev.some(c => c.id === id)) return prev;
      if (customerValidationError(input, prev, id)) return prev;
      const next = prev.map(c => c.id === id ? { ...normalizeCustomerInput(input), id } : c);
      saveCustomers(next); return next;
    });
  }, []);

  // 売上の記録から参照されている得意先は削除しない (過去の売上の得意先が消えてしまうため)。
  // 取引が終わっただけなら削除ではなく active=false にしてもらう (仕入先と同じ)
  const deleteCustomer = useCallback((id: string) => {
    if (ledger.some(t => t.type === '売上出庫' && t.customerId === id)) return;
    setCustomers(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCustomers(next); return next;
    });
  }, [ledger]);

  const moveLot = useCallback((productId: string, lotId: string, targetWarehouseId: string, quantity: number) => {
    const product = products.find(p => p.id === productId);
    const lot = product?.lots.find(l => l.id === lotId);
    if (!product || !lot) return;

    const moveQty = Math.min(quantity, lot.quantity);
    const fromWarehouseId = lot.warehouseId;

    if (moveQty === lot.quantity) {
      // 全量移動: warehouseId を更新するだけ
      setProducts(prev => {
        const next = prev.map(p => p.id === productId
          ? { ...p, lots: p.lots.map(l => l.id === lotId ? { ...l, warehouseId: targetWarehouseId } : l), updatedAt: new Date().toISOString() }
          : p);
        save(next); return next;
      });
    } else {
      // 部分移動: 元ロットを減らし、新ロットを追加
      setProducts(prev => {
        const next = prev.map(p => {
          if (p.id !== productId) return p;
          const updatedLots = p.lots.map(l => l.id === lotId ? { ...l, quantity: l.quantity - moveQty } : l);
          const newLot: Lot = { id: crypto.randomUUID(), lotNo: lot.lotNo, expiryDate: lot.expiryDate, quantity: moveQty, warehouseId: targetWarehouseId, ...(lot.unitPrice != null ? { unitPrice: lot.unitPrice } : {}) };
          return { ...p, lots: [...updatedLots, newLot], updatedAt: new Date().toISOString() };
        });
        save(next); return next;
      });
    }

    // 移動トランザクション: 移動元→移動先を1件で記録
    addTransaction({ type: '移動', productId, productName: product.name, productSku: product.sku, lotNo: lot.lotNo, quantity: moveQty, note: '倉庫移動', fromWarehouseId, toWarehouseId: targetWarehouseId });
  }, [addTransaction, products]);

  // 棚卸の確定。差異のあるロットだけ実数に置き換え、差異を 調整入庫/調整出庫 として帳票に残す。
  // 画面の絞り込みに関係なく counts に入っているロットすべてを対象にする (絞り込みを変えても
  // 入力済みのカウントが落ちないように)。確定した件数を返す。
  const applyStocktake = useCallback((counts: StocktakeCounts): number => {
    const diffs = stocktakeDiffs(stocktakeRows(products, EMPTY_STOCKTAKE_FILTER), counts).filter(d => d.diff !== 0);
    if (diffs.length === 0) return 0;

    const qtyByLotId = new Map(diffs.map(d => [d.lotId, d.actualQuantity]));
    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => {
        if (!p.lots.some(l => qtyByLotId.has(l.id))) return p;
        return {
          ...p,
          updatedAt: now,
          lots: p.lots.map(l => qtyByLotId.has(l.id) ? { ...l, quantity: qtyByLotId.get(l.id)! } : l),
        };
      });
      save(next);
      return next;
    });

    addTransactions(diffs.map(d => ({
      type: (d.diff > 0 ? '調整入庫' : '調整出庫') as TransactionType,
      productId: d.productId,
      productName: d.productName,
      productSku: d.productSku,
      lotNo: d.lotNo,
      quantity: Math.abs(d.diff),
      note: '棚卸',
      ...(d.diff > 0 ? { toWarehouseId: d.warehouseId } : { fromWarehouseId: d.warehouseId }),
    })));

    return diffs.length;
  }, [addTransactions, products]);

  const resetToSample = useCallback(() => {
    const fresh = JSON.parse(JSON.stringify(SAMPLE_DATA));
    // 倉庫・カテゴリ→商品の順で保存する (ロットが倉庫を、商品がカテゴリを参照するため)
    setWarehouses(DEFAULT_WAREHOUSES);
    saveWarehouses(DEFAULT_WAREHOUSES);
    setCategories(DEFAULT_CATEGORIES);
    saveCategories(DEFAULT_CATEGORIES);
    setSuppliers(DEFAULT_SUPPLIERS);
    saveSuppliers(DEFAULT_SUPPLIERS);
    setCustomers(DEFAULT_CUSTOMERS);
    saveCustomers(DEFAULT_CUSTOMERS);
    update(fresh);
    setLedger([]);
    saveLedger([]);
    // 入荷予定は商品と仕入先を参照するので、どちらも入れ替えたあとに戻す
    const freshPlans: InboundPlan[] = JSON.parse(JSON.stringify(SAMPLE_INBOUND_PLANS));
    setInboundPlans(freshPlans);
    saveInboundPlans(freshPlans);
    // 発注書の印刷履歴にサンプルはないので、リセットのたびに空に戻す
    setPurchaseOrderPrints([]);
    savePurchaseOrderPrints([]);
  }, []);

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, shipFefo, disposeLots, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, addWarehouse, updateWarehouse, deleteWarehouse, moveLot, categories, addCategory, updateCategory, deleteCategory, applyStocktake, applyMinQuantities, inboundPlans, addInboundPlan, addInboundPlans, updateInboundPlan, cancelInboundPlan, deleteInboundPlan, receiveInboundPlan, suppliers, addSupplier, updateSupplier, deleteSupplier, purchaseOrderPrints, printPurchaseOrder, customers, addCustomer, updateCustomer, deleteCustomer, recordSale };
}
