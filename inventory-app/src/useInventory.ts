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

export interface Lot {
  id: string;
  lotNo: string;
  expiryDate?: string;
  quantity: number;
  warehouseId: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  janCode?: string; // JANコード (8桁 or 13桁)。JANのない商品 (自社ラベル等) は未設定
  categoryId: string;
  lots: Lot[];
  minQuantity: number;
  price: number;
  costPrice: number;
  updatedAt: string;
}

export type TransactionType = '入荷' | '調整入庫' | '売上出庫' | '調整出庫' | '廃棄' | '移動';

/** 出庫系の区分だけを指す型 (FEFO出庫のように出庫しか受け付けない API 用) */
export type OutboundTransactionType = Extract<TransactionType, '売上出庫' | '調整出庫' | '廃棄'>;

export const INBOUND_TYPES: TransactionType[] = ['入荷', '調整入庫'];
export const OUTBOUND_TYPES: OutboundTransactionType[] = ['売上出庫', '調整出庫', '廃棄'];
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
  /** 仕入単価 (円)。入荷予定からの「入荷」だけが持つ。それ以外の区分では未設定 */
  unitPrice?: number;
  /** 仕入先マスタの id。unitPrice と同じく「入荷予定からの入荷」だけが持つ */
  supplierId?: string;
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
  createdAt: string;
  updatedAt: string;
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

type Slice = 'products' | 'warehouses' | 'categories' | 'ledger' | 'inbound-plans' | 'suppliers';

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

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const SAMPLE_DATA: Product[] = [
  {
    id: '1', name: '牛乳', sku: 'ML-001', janCode: '4901234567894', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: d(3).replace(/-/g, ''), expiryDate: d(3), quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID },
      { id: 'l2', lotNo: d(7).replace(/-/g, ''), expiryDate: d(7), quantity: 10, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2', name: '食パン', sku: 'BR-001', janCode: '4912345678904', categoryId: 'cat-bread', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l3', lotNo: d(1).replace(/-/g, ''), expiryDate: d(1), quantity: 3, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3', name: '値札ラベル(赤)', sku: 'LB-R01', categoryId: 'cat-label', minQuantity: 100, price: 5, costPrice: 2,
    lots: [
      { id: 'l4', lotNo: '20260101', quantity: 500, warehouseId: DEFAULT_WAREHOUSE_ID },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4', name: 'チーズ', sku: 'CS-001', janCode: '4901987654322', categoryId: 'cat-dairy', minQuantity: 4, price: 350, costPrice: 220,
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

// ---- CSV エクスポートの種類 ----
// 画面に CSV エクスポートボタンが複数あり、どれも中身が違う。ボタンの表示名・ツールチップ・
// 出力ファイル名をここ1箇所で決めることで、「どのボタンから何のファイルが出るのか」を
// 画面上でもダウンロードフォルダでも見分けられるようにする。
export const CSV_EXPORTS = {
  inventory: { label: '在庫一覧', description: '商品×ロット単位の在庫一覧' },
  ledger: { label: '入出庫帳票', description: '絞り込み後の入出庫履歴' },
  stocktake: { label: '棚卸表', description: '帳簿在庫と実数カウントの一覧' },
  reorder: { label: '要発注リスト', description: '発注点を下回っている商品' },
  inbound: { label: '入荷予定', description: '絞り込み後の入荷予定' },
  disposal: { label: '廃棄ロス', description: '期間内の商品別の廃棄実績' },
  trace: { label: 'ロット追跡', description: '選択したロットの入荷から出庫までの履歴' },
  supplier: { label: '仕入先一覧', description: '仕入先マスタと入荷予定の状況' },
  costHistory: { label: '原価履歴', description: '入荷時に記録された仕入単価の履歴' },
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
        costPrice: p.costPrice,
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
}

export interface FefoPlan {
  allocations: FefoAllocation[];
  /** 引き当てられた合計数量 */
  allocated: number;
  /** 引き当てられなかった数量。0 より大きければ在庫不足 */
  shortage: number;
  /** 期限切れのため引当対象から除外した在庫数 (includeExpired 時は 0) */
  skippedExpired: number;
}

export interface FefoOptions {
  /** 指定するとその倉庫のロットだけを引当対象にする (未指定は全倉庫) */
  warehouseId?: string;
  /** 既定 false: 期限切れロットは引き当てない (食品は廃棄が原則のため) */
  includeExpired?: boolean;
}

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
    });
    remaining -= take;
  }

  return { allocations, allocated: requested - remaining, shortage: remaining, skippedExpired };
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
    totals.costValue += qty * p.costPrice;
    totals.retailValue += qty * p.price;
    if (qty <= p.minQuantity) totals.lowStock++;
    if (qty === 0) totals.outOfStock++;
    for (const l of p.lots) {
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
        costValue: l.quantity * p.costPrice,
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
      row.costValue += qty * p.costPrice;
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
      row.costValue += qty * p.costPrice;
      row.retailValue += qty * p.price;
    }
    return row;
  });
  return withShare(rows);
}

/** 要発注リストの CSV。そのまま発注依頼の下書きに使える想定 */
export function lowStockCsv(rows: LowStockRow[], categories: Category[]): string {
  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? '';
  const header = '商品名,SKU,カテゴリ,在庫数,発注点,不足数,発注見込金額';
  const body = rows.map(r => [
    r.productName, r.productSku, catName(r.categoryId), r.quantity, r.minQuantity, r.shortage, r.restockCost,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportLowStockCsv(rows: LowStockRow[], categories: Category[]) {
  downloadCsv(csvFileName('reorder'), lowStockCsv(rows, categories));
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
      targets.push({
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        lotId: l.id,
        lotNo: l.lotNo,
        expiryDate: l.expiryDate,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        costPrice: p.costPrice,
        costValue: l.quantity * p.costPrice,
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
 * 帳票は原価を持たないので金額は商品マスタの「現在の原価」を掛けた概算で、
 * 削除された商品 (マスタにない) は原価0として数量だけを数える。
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
    row.costValue += t.quantity * (costById.get(t.productId) ?? 0);
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

  const adjustLotQuantity = useCallback((productId: string, lotId: string, delta: number, type?: TransactionType) => {
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
      const txnType = type ?? (actualDelta > 0 ? '調整入庫' : '調整出庫');
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
      });
    }
  }, [addTransaction, products]);

  // FEFO 出庫: 商品と数量だけを受け取り、賞味期限の近いロットから順に引き落とす。
  // 引当先の決定は planFefoShipment (純粋関数) に任せ、ここでは在庫の反映と帳票への記録だけを行う。
  // 在庫が足りないときは引ける分だけ引き当て、不足数を shortage として返す (呼び出し側が通知する)。
  const shipFefo = useCallback((productId: string, quantity: number, options: FefoOptions & { type?: OutboundTransactionType; note?: string } = {}): FefoPlan => {
    const product = products.find(p => p.id === productId);
    if (!product) return { allocations: [], allocated: 0, shortage: Math.max(0, Math.floor(quantity)), skippedExpired: 0 };

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
    addTransactions(plan.allocations.map(a => ({
      type: (options.type ?? '売上出庫') as TransactionType,
      productId,
      productName: product.name,
      productSku: product.sku,
      lotNo: a.lotNo,
      quantity: a.quantity,
      note: options.note ?? 'FEFO出庫',
      fromWarehouseId: a.warehouseId,
    })));

    return plan;
  }, [addTransactions, products]);

  /**
   * 選んだロットをまとめて廃棄する。引当先の決定は planDisposal (純粋関数) に任せ、
   * ここでは在庫の反映と帳票への記録だけを行う。ロットごとに 廃棄 を1件記録する。
   *
   * 廃棄したロットは在庫0にするのではなく取り除く。中身が無くなったロットを残すと
   * 画面上部の「期限切れロットあり」バナー (在庫0のロットも数える) が消えないためで、
   * 何をいくつ廃棄したかは帳票に残る。
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

    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => {
        if (p.id !== product.id) return p;
        const lots = target.existingLot
          ? p.lots.map(l => l.id === target.existingLot!.id ? { ...l, quantity: l.quantity + target.quantity } : l)
          : [...p.lots, {
              id: crypto.randomUUID(),
              lotNo: target.lotNo,
              ...(target.expiryDate ? { expiryDate: target.expiryDate } : {}),
              quantity: target.quantity,
              warehouseId: target.warehouseId,
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
    const header = '商品名,SKU,JANコード,カテゴリ,販売定価,原価,ロットNo,賞味期限,在庫数';
    const rows = products.flatMap(p =>
      p.lots.length > 0
        ? p.lots.map(l => [p.name, p.sku, p.janCode ?? '', categoryName(p.categoryId), p.price, p.costPrice, l.lotNo, l.expiryDate ?? '', l.quantity].join(','))
        : [[p.name, p.sku, p.janCode ?? '', categoryName(p.categoryId), p.price, p.costPrice, '', '', 0].join(',')]
    );
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
          const newLot: Lot = { id: crypto.randomUUID(), lotNo: lot.lotNo, expiryDate: lot.expiryDate, quantity: moveQty, warehouseId: targetWarehouseId };
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
    update(fresh);
    setLedger([]);
    saveLedger([]);
    // 入荷予定は商品と仕入先を参照するので、どちらも入れ替えたあとに戻す
    const freshPlans: InboundPlan[] = JSON.parse(JSON.stringify(SAMPLE_INBOUND_PLANS));
    setInboundPlans(freshPlans);
    saveInboundPlans(freshPlans);
  }, []);

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, shipFefo, disposeLots, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, addWarehouse, updateWarehouse, deleteWarehouse, moveLot, categories, addCategory, updateCategory, deleteCategory, applyStocktake, inboundPlans, addInboundPlan, updateInboundPlan, cancelInboundPlan, deleteInboundPlan, receiveInboundPlan, suppliers, addSupplier, updateSupplier, deleteSupplier };
}
