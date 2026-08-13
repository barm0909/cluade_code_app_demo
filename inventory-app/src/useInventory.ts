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

type Slice = 'products' | 'warehouses' | 'categories' | 'ledger';

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

// ---- CSV エクスポートの種類 ----
// 画面に CSV エクスポートボタンが4つあり、どれも中身が違う。ボタンの表示名・ツールチップ・
// 出力ファイル名をここ1箇所で決めることで、「どのボタンから何のファイルが出るのか」を
// 画面上でもダウンロードフォルダでも見分けられるようにする。
export const CSV_EXPORTS = {
  inventory: { label: '在庫一覧', description: '商品×ロット単位の在庫一覧' },
  ledger: { label: '入出庫帳票', description: '絞り込み後の入出庫履歴' },
  stocktake: { label: '棚卸表', description: '帳簿在庫と実数カウントの一覧' },
  reorder: { label: '要発注リスト', description: '発注点を下回っている商品' },
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

export function useInventory() {
  // API から取得できるまで (またはできない環境では) サンプルデータで動作する
  const [products, setProducts] = useState<Product[]>(SAMPLE_DATA);
  const [ledger, setLedger] = useState<StockTransaction[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(DEFAULT_WAREHOUSES);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);

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

  const deleteWarehouse = useCallback((id: string) => {
    const inUse = products.some(p => p.lots.some(l => l.warehouseId === id));
    if (inUse) return;
    setWarehouses(prev => {
      const next = prev.filter(w => w.id !== id);
      saveWarehouses(next); return next;
    });
  }, [products]);

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
    update(fresh);
    setLedger([]);
    saveLedger([]);
  }, []);

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, shipFefo, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, addWarehouse, updateWarehouse, deleteWarehouse, moveLot, categories, addCategory, updateCategory, deleteCategory, applyStocktake };
}
