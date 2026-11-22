import { useState, useEffect, useCallback } from 'react';

// xlsx (SheetJS) は 400kB 超あり、Excel の入出力ボタンを押したときにしか使わないので、
// 初期表示のバンドルに含めず、使う時点で別チャンクとして読み込む。
const loadXlsx = () => import('xlsx');

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
  /** 締め日 (5/10/15/20/25日、31 = 末日、0 = 都度請求)。未設定は末日 (customerClosingDay) */
  closingDay?: ClosingDay;
  /** お支払期限: 締め日の何か月後か (0 = 当月、1 = 翌月、2 = 翌々月)。未設定は翌月 */
  paymentMonths?: PaymentMonths;
  /** お支払期限: その月の何日か (31 = 末日)。未設定は末日 */
  paymentDay?: PaymentDay;
}

/** 得意先の入力値 (id は採番するので含まない) */
export type CustomerInput = Omit<Customer, 'id'>;

// ---- 締め日・支払条件 (docs/billing-closing-feature.md) ----
/** 締め日。31 は「末日」(2月なら28/29日)、0 は締めずに都度請求する得意先 */
export type ClosingDay = 0 | 5 | 10 | 15 | 20 | 25 | 31;
export type PaymentMonths = 0 | 1 | 2;
export type PaymentDay = 5 | 10 | 15 | 20 | 25 | 31;
export const END_OF_MONTH = 31;
export const AS_NEEDED_CLOSING: ClosingDay = 0;
export const CLOSING_DAYS: ClosingDay[] = [5, 10, 15, 20, 25, 31, 0];
export const PAYMENT_MONTHS: PaymentMonths[] = [0, 1, 2];
export const PAYMENT_DAYS: PaymentDay[] = [5, 10, 15, 20, 25, 31];
/** 締め日・支払条件を持たない得意先 (この機能より前の登録) は「末日締め・翌月末払い」とみなす */
export const DEFAULT_CLOSING_DAY: ClosingDay = 31;
export const DEFAULT_PAYMENT_MONTHS: PaymentMonths = 1;
export const DEFAULT_PAYMENT_DAY: PaymentDay = 31;

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

export type TransactionType = '入荷' | '調整入庫' | '売上返品' | '売上出庫' | '資材使用' | '調整出庫' | '廃棄' | '仕入返品' | '移動';

/** 出庫系の区分だけを指す型 (FEFO出庫のように出庫しか受け付けない API 用) */
export type OutboundTransactionType = Extract<TransactionType, '売上出庫' | '資材使用' | '調整出庫' | '廃棄'>;

/**
 * 入庫・出庫画面で手で選べる入庫区分。返品 (売上返品) は元の売上にひもづけて
 * 専用の画面 (returnSale) からしか記録しないので、ここには含めない。
 */
export const INBOUND_TYPES: TransactionType[] = ['入荷', '調整入庫'];
/**
 * 手で選べる出庫区分。商品ごとに選べる区分は outboundTypesFor で絞る (資材は売上出庫できない等)。
 * 仕入返品は専用の画面 (returnToSupplier) からしか記録しないので含めない。
 */
export const OUTBOUND_TYPES: OutboundTransactionType[] = ['売上出庫', '資材使用', '調整出庫', '廃棄'];
/** 返品の区分 (docs/return-feature.md)。売上返品は在庫が増え、仕入返品は在庫が減る */
export const RETURN_TYPES: TransactionType[] = ['売上返品', '仕入返品'];
export const ALL_TRANSACTION_TYPES: TransactionType[] = [...INBOUND_TYPES, '売上返品', ...OUTBOUND_TYPES, '仕入返品', '移動'];

export function transactionDirection(type: TransactionType): 'in' | 'out' | 'move' {
  if (INBOUND_TYPES.includes(type) || type === '売上返品') return 'in';
  if ((OUTBOUND_TYPES as TransactionType[]).includes(type) || type === '仕入返品') return 'out';
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
   * - 売上返品: 元の売上の実売単価 (元の売上が持っていたときだけ)
   * - 仕入返品: 返品単価 (仕入先へ返す1個あたりの金額。0 なら持たない)
   * それ以外の区分では未設定。
   */
  unitPrice?: number;
  /** 仕入先マスタの id。「入荷予定からの入荷」と「仕入返品」が持つ */
  supplierId?: string;
  /** 得意先マスタの id。「売上出庫」と「売上返品」が持つ (未設定 = 得意先なしの売上) */
  customerId?: string;
  /**
   * 返品の元になった取引の id。「売上返品」は元の売上出庫 (必ず持つ)、
   * 「仕入返品」は元の入荷 (帳票から見つかったときだけ) を指す。
   */
  returnOfTxnId?: string;
  /**
   * 出庫した時点のロット原価 (円)。「売上出庫」と、それを写した「売上返品」が持つ。
   * 売れたロットは在庫から減って原価が分からなくなるため、粗利 (売上金額 - 原価) を
   * あとから再計算できるようその場で写し取る (廃棄ロスが unitPrice を持つのと同じ理由)。
   */
  costUnitPrice?: number;
  /**
   * 出庫した時点の商品の消費税率 (%)。「売上出庫」と、それを写した「売上返品」が持つ。
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

// 受注 (出荷予定)。入荷予定の販売側の対で、得意先から受けた注文のうちまだ出荷していないものを持つ。
// 受注自体は在庫を動かさず、出荷して初めて「売上出庫」として在庫が減り帳票に残る。
// 分割出荷に対応するため受注数量とは別に出荷済数量を持ち、状態はそこから導出する
// (canceledAt だけは操作の結果として保存する。入荷予定と同じ方針)。
// 在庫の引当 (取り置き) はロットに予約を書き込むのではなく、受注残を出荷予定日の早い順に
// FEFO で割り付けたときに足りるかどうかを salesOrderAllocations で都度計算する。
export interface SalesOrder {
  id: string;
  customerId: string; // 得意先マスタの id
  productId: string;
  expectedDate: string; // 出荷予定日 YYYY-MM-DD
  quantity: number; // 受注数量
  shippedQuantity: number; // 出荷済数量 (分割出荷の累計)
  unitPrice: number; // 受注単価 (税抜・円)。0 は未入力 (出荷時は帳票に書かず、売上管理で販売定価に代用)
  warehouseId: string; // 出荷元倉庫。空文字は「全倉庫から引き当てる」
  note: string;
  canceledAt?: string; // キャンセル日時 (ISO)。未設定なら有効な受注
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
  // 返品のマイナス金額でも、同じ額のプラス金額とちょうど符号違いになるよう絶対値で丸める
  // (Math.round は -0.5 を 0 に寄せるため、そのままだと売上と返品で税額が1円ずれる)
  const tax = Math.round(Math.abs(amountExcludingTax) * rate / 100);
  return amountExcludingTax < 0 ? -tax : tax;
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

// ---- JANコード・バーコード (docs/barcode-feature.md) ----

/**
 * JAN (EAN-13 / EAN-8) のチェックデジット。最後の1桁を除いた数字列 body から計算する
 * (右から奇数桁 ×3 + 偶数桁 ×1 の合計を 10 の倍数に切り上げた差)。
 */
export function janCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** JANコードの入力チェック。未入力 (未設定) は可。問題がなければ空文字 */
export function janCodeError(value: string): string {
  if (value === '') return '';
  if (!/^(\d{8}|\d{13})$/.test(value)) return 'JANコードは数字8桁または13桁で入力してください';
  if (janCheckDigit(value.slice(0, -1)) !== Number(value.slice(-1))) {
    return 'JANコードの最後の1桁（チェックデジット）が合いません。打ち間違い・読み間違いがないか確認してください';
  }
  return '';
}

// 未入力 (未設定) は許可。入力があるときだけ 8桁/13桁 + 正しいチェックデジットを要求する
export function isValidJanCode(value: string): boolean {
  return janCodeError(value) === '';
}

/** スキャナー・カメラ・手入力で受け取った文字列から数字だけを取り出す (全角数字は半角へ) */
export function normalizeScanCode(text: string): string {
  return text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '');
}

/** 読み取り結果。product が null のときは error に理由が入る */
export interface ScanResult {
  code: string;
  product: Product | null;
  error: string;
}

/**
 * 読み取ったバーコード (または手入力) から商品を探す。JANコードの完全一致を先に見て、
 * 数字以外を含む入力は SKU の完全一致 (大文字小文字は区別しない) でも探す
 * (JAN のない自社ラベル品を SKU で呼び出せるように)。
 */
export function findProductByScan(products: Product[], text: string): ScanResult {
  const raw = text.trim();
  const code = normalizeScanCode(raw);
  const byJan = code ? products.find(p => p.janCode === code) : undefined;
  if (byJan) return { code, product: byJan, error: '' };
  const bySku = raw ? products.find(p => p.sku.toLowerCase() === raw.toLowerCase()) : undefined;
  if (bySku) return { code: raw, product: bySku, error: '' };
  if (!code) return { code: raw, product: null, error: raw ? `「${raw}」に一致する商品がありません` : '' };
  if (janCodeError(code)) return { code, product: null, error: `JANコードとして読み取れませんでした（${code}）。もう一度読み取ってください` };
  return { code, product: null, error: `未登録のJANコードです（${code}）。商品マスタでその商品にJANコードを登録してください` };
}

// EAN-13 / EAN-8 のバーの並び (1 = 黒, 0 = 白)。左側は L/G、右側は R の符号で、EAN-13 は先頭の数字で L/G の並びが決まる
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map(c => c.replace(/./g, b => (b === '0' ? '1' : '0')));
const EAN_G = EAN_R.map(c => [...c].reverse().join(''));
const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/**
 * JANコードをバーコードのモジュール列 ('1' = 黒) にする。EAN-13 は 95、EAN-8 は 67 モジュール。
 * JANコードとして正しくない (桁数・チェックデジット) ときは null。
 */
export function eanModules(code: string): string | null {
  if (code === '' || janCodeError(code)) return null;
  const digits = [...code].map(Number);
  if (code.length === 13) {
    const parity = EAN13_PARITY[digits[0]];
    const left = digits.slice(1, 7).map((d, i) => (parity[i] === 'L' ? EAN_L[d] : EAN_G[d])).join('');
    const right = digits.slice(7).map(d => EAN_R[d]).join('');
    return `101${left}01010${right}101`;
  }
  const left = digits.slice(0, 4).map(d => EAN_L[d]).join('');
  const right = digits.slice(4).map(d => EAN_R[d]).join('');
  return `101${left}01010${right}101`;
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
  salesOrders?: SalesOrder[]; // 受注も同様 (未導入のサーバーからは返ってこない)
  salesDocumentItems?: SalesDocumentItem[]; // 納品書・請求書の発行履歴も同様
  paymentItems?: PaymentItem[]; // 入金も同様 (未導入のサーバーからは返ってこない)
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

type Slice = 'products' | 'warehouses' | 'categories' | 'ledger' | 'inbound-plans' | 'suppliers' | 'purchase-order-prints' | 'customers' | 'sales-orders' | 'sales-documents' | 'payments';

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
    note: '毎朝配送', active: true, closingDay: 20, paymentMonths: 1, paymentDay: 10,
  },
  {
    id: 'cus-sakura', name: 'さくらカフェ', code: 'C-002', contact: '佐倉 美咲',
    phone: '06-4444-5555', email: 'cafe@sakura.example.jp', address: '大阪府大阪市中央区5-5-5',
    note: '', active: true, closingDay: 0, paymentMonths: 1, paymentDay: 31,
  },
  {
    id: 'cus-kita', name: '北町給食センター', code: 'C-003', contact: '', phone: '011-666-7777',
    email: '', address: '北海道札幌市北区6-6-6', note: '月末締め', active: true, closingDay: 31, paymentMonths: 1, paymentDay: 31,
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

// 受注のサンプル (seed.sql と同期)。so2 は在庫 (食パン 3) を超える受注で「在庫不足」、
// so3 は出荷予定日を過ぎた「遅延」の状態にしてある
const SAMPLE_SALES_ORDERS: SalesOrder[] = [
  {
    id: 'so1', customerId: 'cus-midori', productId: '1', expectedDate: d(1), quantity: 12, shippedQuantity: 0,
    unitPrice: 190, warehouseId: '', note: '定期配送', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'so2', customerId: 'cus-sakura', productId: '2', expectedDate: d(2), quantity: 10, shippedQuantity: 0,
    unitPrice: 150, warehouseId: '', note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'so3', customerId: 'cus-kita', productId: '4', expectedDate: d(-1), quantity: 3, shippedQuantity: 0,
    unitPrice: 330, warehouseId: DEFAULT_WAREHOUSE_ID, note: '給食用', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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

function saveSalesOrders(orders: SalesOrder[]) {
  persist('sales-orders', orders);
}

function saveSalesDocumentItems(items: SalesDocumentItem[]) {
  persist('sales-documents', items);
}

function savePaymentItems(items: PaymentItem[]) {
  persist('payments', items);
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
  salesOrder: { label: '受注一覧', description: '絞り込み後の受注（出荷予定）と引当の状況' },
  salesDocument: { label: '納品書・請求書', description: '発行した納品書・請求書の明細' },
  receivable: { label: '請求残高', description: '絞り込み後の請求書ごとの入金状況と残高' },
  customerReceivable: { label: '売掛金残高', description: '得意先ごとの請求残高・未請求売上・未消込入金' },
  payment: { label: '入金履歴', description: '絞り込み後の入金と請求書への消込' },
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
// 受注 (出荷予定)
// 入荷予定の販売側の対。受注は在庫を持たず、出荷 (shipSalesOrder) で初めて FEFO で
// 引き当てたロットから「売上出庫」として在庫が減る。状態は出荷済数量から導出する。
//
// 引当はロットに予約を書き込まない「見込み」の計算で、受注残を出荷予定日の早い順に
// 現在庫へ FEFO で割り付けたとき足りるかどうかを毎回求める (salesOrderAllocations)。
// 予約を保存しないので、売上登録や廃棄で在庫が減ればその場で引当結果に反映される。
// ---------------------------------------------------------------------------

export type SalesOrderStatus = '未出荷' | '一部出荷' | '出荷済' | 'キャンセル';

export const SALES_ORDER_STATUSES: SalesOrderStatus[] = ['未出荷', '一部出荷', '出荷済', 'キャンセル'];

export function salesOrderStatus(order: SalesOrder): SalesOrderStatus {
  if (order.canceledAt) return 'キャンセル';
  if (order.shippedQuantity <= 0) return '未出荷';
  if (order.shippedQuantity < order.quantity) return '一部出荷';
  return '出荷済';
}

/** まだ出荷していない数量 (受注残)。キャンセル済み・出荷済みは 0 */
export function remainingShipment(order: SalesOrder): number {
  if (order.canceledAt) return 0;
  return Math.max(0, order.quantity - order.shippedQuantity);
}

/** 出荷予定日を過ぎたまま受注残がある受注 (= 遅延) かどうか */
export function isOverdueSalesOrder(order: SalesOrder, today = new Date().toISOString().slice(0, 10)): boolean {
  return remainingShipment(order) > 0 && order.expectedDate < today;
}

/** 受注の入力値 (id・出荷実績・日時は画面から編集しない) */
export type SalesOrderInput = Omit<SalesOrder, 'id' | 'shippedQuantity' | 'canceledAt' | 'createdAt' | 'updatedAt'>;

/**
 * 受注の入力チェック。問題がなければ空文字を返す。
 * 画面 (SalesOrderModal) と登録処理 (addSalesOrder / updateSalesOrder) が同じ判定を共有する。
 * 資材は売らないので受注の対象にしない (売上登録と同じ)。
 */
export function salesOrderValidationError(input: SalesOrderInput, products: Product[], customers: Customer[]): string {
  const product = products.find(p => p.id === input.productId);
  if (!product) return '商品を選んでください';
  if (isMaterial(product)) return '資材は受注の対象にできません';
  if (!input.customerId || !customers.some(c => c.id === input.customerId)) return '得意先を選んでください';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate)) return '出荷予定日を入力してください';
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return '受注数量は1以上で入力してください';
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) return '受注単価は0以上で入力してください';
  return '';
}

/** 受注1件の引当結果 (見込み) */
export interface SalesOrderAllocation {
  /** いまの在庫から引き当てられる数量 (受注残以下) */
  allocated: number;
  /** 引き当てられない数量。0 より大きければ在庫不足 */
  shortage: number;
}

/** 受注の優先順。出荷予定日の早い順、同日は登録順 */
function compareSalesOrders(a: SalesOrder, b: SalesOrder): number {
  return a.expectedDate.localeCompare(b.expectedDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * 受注残を、出荷予定日の早い受注から順に現在庫へ FEFO で割り付けたときの引当結果を返す。
 * 先の受注に割り付けた在庫は後の受注からは引けない (同じ在庫を二重に数えない)。
 * 割付は出荷 (planSalesOrderShipment) と同じ planFefoShipment を使い、期限切れのロットは対象外。
 * 受注残のない受注 (出荷済・キャンセル) と、商品マスタにない商品の受注は結果に含めない。
 */
export function salesOrderAllocations(orders: SalesOrder[], products: Product[]): Map<string, SalesOrderAllocation> {
  // 割付で減らしていく作業用の在庫 (元の商品は変更しない)
  const working = new Map(products.map(p => [p.id, { ...p, lots: p.lots.map(l => ({ ...l })) }]));
  const result = new Map<string, SalesOrderAllocation>();
  for (const order of orders.filter(o => remainingShipment(o) > 0).sort(compareSalesOrders)) {
    const product = working.get(order.productId);
    if (!product) continue;
    const plan = planFefoShipment(product, remainingShipment(order), { warehouseId: order.warehouseId || undefined });
    const taken = new Map(plan.allocations.map(a => [a.lotId, a.quantity]));
    product.lots = product.lots.map(l => taken.has(l.id) ? { ...l, quantity: l.quantity - taken.get(l.id)! } : l);
    result.set(order.id, { allocated: plan.allocated, shortage: plan.shortage });
  }
  return result;
}

export interface SalesOrderFilter {
  keyword: string; // 商品名・SKU・得意先名の部分一致
  status: SalesOrderStatus | '';
  customerId: string;
  from: string; // 出荷予定日 YYYY-MM-DD (この日を含む)
  to: string;
}

export const EMPTY_SALES_ORDER_FILTER: SalesOrderFilter = { keyword: '', status: '', customerId: '', from: '', to: '' };

/** 受注一覧の1行。表示に要る情報を平坦に持たせる (入荷予定と同じ方針) */
export interface SalesOrderRow {
  order: SalesOrder;
  productName: string;
  productSku: string;
  /** 得意先マスタから解決した名前。マスタにない id なら空文字 */
  customerName: string;
  status: SalesOrderStatus;
  remaining: number;
  overdue: boolean;
  /** 受注残のうち今の在庫で引き当てられる数量 (受注残がなければ 0) */
  allocated: number;
  /** 受注残のうち在庫が足りない数量 */
  shortage: number;
  /** 金額の計算に使う単価 (税抜)。受注単価が未入力 (0) なら商品の販売定価 */
  unitPrice: number;
  /** 受注単価が未入力で販売定価を使った (概算) */
  estimatedPrice: boolean;
  /** 受注残の金額 (税抜) = remaining × unitPrice */
  remainingAmount: number;
}

/**
 * 絞り込み済みの受注を、出荷予定日の早い順 (同日は登録順) に返す。
 * 引当は絞り込みの前に全受注で計算する (絞り込みで先の受注が隠れても、その受注が押さえる在庫は変わらないため)。
 * 商品マスタから消えた商品を指す受注は表示できないので除外する。
 */
export function salesOrderRows(
  orders: SalesOrder[],
  products: Product[],
  customers: Customer[],
  filter: SalesOrderFilter = EMPTY_SALES_ORDER_FILTER,
): SalesOrderRow[] {
  const q = filter.keyword.trim().toLowerCase();
  const productById = new Map(products.map(p => [p.id, p]));
  const customerNameById = new Map(customers.map(c => [c.id, c.name]));
  const allocations = salesOrderAllocations(orders, products);
  const rows: SalesOrderRow[] = [];
  for (const order of orders) {
    const product = productById.get(order.productId);
    if (!product) continue;
    const status = salesOrderStatus(order);
    if (filter.status && status !== filter.status) continue;
    if (filter.customerId && order.customerId !== filter.customerId) continue;
    if (filter.from && order.expectedDate < filter.from) continue;
    if (filter.to && order.expectedDate > filter.to) continue;
    const name = customerNameById.get(order.customerId) ?? '';
    if (q && !(
      product.name.toLowerCase().includes(q)
      || product.sku.toLowerCase().includes(q)
      || name.toLowerCase().includes(q)
    )) continue;
    const remaining = remainingShipment(order);
    const allocation = allocations.get(order.id) ?? { allocated: 0, shortage: 0 };
    const estimatedPrice = order.unitPrice <= 0;
    const unitPrice = estimatedPrice ? product.price : order.unitPrice;
    rows.push({
      order,
      productName: product.name,
      productSku: product.sku,
      customerName: name,
      status,
      remaining,
      overdue: isOverdueSalesOrder(order),
      allocated: allocation.allocated,
      shortage: allocation.shortage,
      unitPrice,
      estimatedPrice,
      remainingAmount: remaining * unitPrice,
    });
  }
  return rows.sort((a, b) => compareSalesOrders(a.order, b.order));
}

export interface SalesOrderTotals {
  count: number;
  ordered: number; // 受注数量の合計 (キャンセルを除く)
  shipped: number; // 出荷済数量の合計
  remaining: number; // 受注残の合計
  remainingAmount: number; // 受注残の金額 (税抜)
  overdue: number; // 遅延している受注の件数
  short: number; // 在庫不足の受注の件数
  canceled: number;
}

export function salesOrderTotals(rows: SalesOrderRow[]): SalesOrderTotals {
  const totals: SalesOrderTotals = { count: rows.length, ordered: 0, shipped: 0, remaining: 0, remainingAmount: 0, overdue: 0, short: 0, canceled: 0 };
  for (const r of rows) {
    if (r.status === 'キャンセル') { totals.canceled++; continue; }
    totals.ordered += r.order.quantity;
    totals.shipped += r.order.shippedQuantity;
    totals.remaining += r.remaining;
    totals.remainingAmount += r.remainingAmount;
    if (r.overdue) totals.overdue++;
    if (r.shortage > 0) totals.short++;
  }
  return totals;
}

export function salesOrderCsv(rows: SalesOrderRow[], warehouses: Warehouse[]): string {
  const whName = (id: string) => id ? (warehouses.find(w => w.id === id)?.name ?? id) : '全倉庫';
  const header = '出荷予定日,得意先,商品名,SKU,出荷元倉庫,受注単価(税抜),受注数量,出荷済,受注残,引当可能,在庫不足,受注残金額(税抜),状態,概算,備考';
  const body = rows.map(r => [
    r.order.expectedDate,
    r.customerName,
    r.productName,
    r.productSku,
    whName(r.order.warehouseId),
    r.unitPrice,
    r.order.quantity,
    r.order.shippedQuantity,
    r.remaining,
    r.allocated,
    r.shortage,
    r.remainingAmount,
    r.status,
    r.estimatedPrice ? '概算' : '',
    r.order.note,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportSalesOrderCsv(rows: SalesOrderRow[], warehouses: Warehouse[]) {
  downloadCsv(csvFileName('salesOrder'), salesOrderCsv(rows, warehouses));
}

/** 得意先ごとの受注件数 (キャンセル・出荷済も含む)。得意先の削除可否の判定に使う */
export function salesOrderCountByCustomer(orders: SalesOrder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(o.customerId, (counts.get(o.customerId) ?? 0) + 1);
  return counts;
}

/** 出荷時の入力。数量以外は任意 */
export interface ShipOrderInput {
  quantity: number;
  /** 既定 false: 期限切れロットは引き当てない (FEFO出庫と同じ) */
  includeExpired?: boolean;
  note?: string;
}

/**
 * 受注を出荷したときに引き当てるロットを求める。状態は変更しない (ShipSalesOrderModal のプレビューと
 * shipSalesOrder が同じ結果を共有するための純粋関数)。
 * 数量は受注残を超えないよう丸め (過出荷は受け付けない)、出荷元倉庫は受注のものを使う。
 * 引当の見込み (salesOrderAllocations) と違い、他の受注のために見込んだ在庫も引ける
 * (どの受注から出すかは出荷する人が決めるため)。
 */
export function planSalesOrderShipment(order: SalesOrder, product: Product, input: ShipOrderInput): FefoPlan {
  const quantity = Math.min(Math.max(0, Math.floor(input.quantity)), remainingShipment(order));
  return planFefoShipment(product, quantity, { warehouseId: order.warehouseId || undefined, includeExpired: input.includeExpired });
}

/** 受注からの出荷でつく帳票の備考の既定値 (売上登録・FEFO出庫と区別するため) */
export function salesOrderShipmentNote(customer: string): string {
  return customer ? `受注出荷（${customer}）` : '受注出荷';
}

/** 出荷の結果 (呼び出し側が通知に使う) */
export interface ShipOrderResult {
  plan: FefoPlan;
  /** 出荷後の受注残 */
  remaining: number;
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
  closingDay: DEFAULT_CLOSING_DAY, paymentMonths: DEFAULT_PAYMENT_MONTHS, paymentDay: DEFAULT_PAYMENT_DAY,
};

/** 前後の空白を落とし、締め日・支払条件の不正な値・未設定を既定値にそろえる */
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
    closingDay: customerClosingDay(input),
    paymentMonths: customerPaymentMonths(input),
    paymentDay: customerPaymentDay(input),
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
  /**
   * 売上返品の行。数量・金額・消費税・原価・粗利はすべてマイナスで持つので、
   * そのまま足し上げれば返品を差し引いた売上になる。
   */
  isReturn: boolean;
  /** 返品の行だけ: 元の売上の帳票 id */
  returnOfTxnId: string;
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
    .filter(t => t.type === '売上出庫' || t.type === '売上返品')
    .map(t => {
      const product = productById.get(t.productId);
      const isReturn = t.type === '売上返品';
      // 返品は数量をマイナスにして、金額・消費税・原価・粗利もすべてマイナスにする
      const quantity = isReturn ? -t.quantity : t.quantity;
      const estimatedPrice = t.unitPrice == null;
      const estimatedCost = t.costUnitPrice == null;
      const unitPrice = t.unitPrice ?? product?.price ?? 0;
      const unitCost = t.costUnitPrice ?? product?.costPrice ?? 0;
      // 消費税の導入前の記録は税率を持たないので、商品の現在の税率を使う。商品の税率が変わることは
      // まずなく、全件を「概算」扱いにすると印だらけになるため、単価・原価と違って印はつけない
      const taxRate = isTaxRate(t.taxRate) ? t.taxRate : product ? productTaxRate(product) : DEFAULT_TAX_RATE;
      const amount = unitPrice * quantity;
      const tax = taxAmount(amount, taxRate);
      const cost = unitCost * quantity;
      const customerId = t.customerId ?? '';
      return {
        txnId: t.id,
        date: t.date,
        productId: t.productId,
        productName: t.productName,
        productSku: t.productSku,
        lotNo: t.lotNo,
        // 売上は出庫元、返品は戻し先の倉庫
        warehouseId: (isReturn ? t.toWarehouseId : t.fromWarehouseId) ?? '',
        customerId,
        customerName: customerNameById.get(customerId) ?? '',
        quantity,
        unitPrice,
        amount,
        taxRate,
        tax,
        amountWithTax: amount + tax,
        unitCost,
        cost,
        profit: amount - cost,
        // 返品は粗利も金額もマイナスなので、そのまま割れば元の売上と同じ粗利率になる
        profitRate: amount !== 0 ? (amount - cost) / amount : 0,
        note: t.note,
        estimatedPrice,
        estimatedCost,
        isReturn,
        returnOfTxnId: t.returnOfTxnId ?? '',
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
  /** 売上返品の件数と金額 (税抜・プラスの値)。売上高などはすでに返品を差し引いた値 */
  returnCount: number;
  returnAmount: number;
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
    returnCount: rows.filter(r => r.isReturn).length,
    returnAmount: rows.filter(r => r.isReturn).reduce((s, r) => s - r.amount, 0),
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

// ---------------------------------------------------------------------------
// 返品 (docs/return-feature.md)
// - 売上返品: 得意先から戻ってきた商品。元の売上出庫を1件選び、その数量の範囲で在庫へ戻す。
//   帳票には「売上返品」(入庫側) を1件書き、元の売上の単価・得意先・原価・税率をそのまま写す。
//   売上管理 (salesRows) はこれをマイナスの売上として差し引く。
// - 仕入返品: 仕入先へ返す商品。ロットを1つ選び、その在庫の範囲で減らす。
//   帳票には「仕入返品」(出庫側) を1件書き、仕入先と返品単価を残す。
// どちらも在庫が動くので必ず帳票に記録する。返品で受注・入荷予定の数量は戻さない。
// ---------------------------------------------------------------------------

/** 元の取引 id → これまでに返品した数量の合計 (売上返品・仕入返品の両方) */
export function returnedQuantities(ledger: StockTransaction[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of ledger) {
    if ((t.type === '売上返品' || t.type === '仕入返品') && t.returnOfTxnId) {
      map.set(t.returnOfTxnId, (map.get(t.returnOfTxnId) ?? 0) + t.quantity);
    }
  }
  return map;
}

/** その売上 (売上出庫) のうち、まだ返品できる数量 */
export function returnableSaleQuantity(ledger: StockTransaction[], saleTxnId: string): number {
  const sale = ledger.find(t => t.id === saleTxnId && t.type === '売上出庫');
  if (!sale) return 0;
  return Math.max(0, sale.quantity - (returnedQuantities(ledger).get(saleTxnId) ?? 0));
}

/** ロットNo が賞味期限から作られた8桁 (YYYYMMDD) なら、その日付を返す */
function expiryFromLotNo(lotNo: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(lotNo);
  if (!m) return undefined;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(`${date}T00:00:00`);
  return Number.isNaN(dt.getTime()) || localDateKey(dt.toISOString()) !== date ? undefined : date;
}

export interface SalesReturnInput {
  saleTxnId: string;
  quantity: number;
  /** 戻し先の倉庫。売り物にならないものは保留倉庫・不良倉庫へ戻し、あとで廃棄する想定 */
  warehouseId: string;
  note?: string;
}

/** 売上返品で在庫がどう戻るか (モーダルのプレビューと returnSale が共有する) */
export interface SalesReturnPlan {
  sale?: StockTransaction;
  product?: Product;
  /** 実際に戻す数量 (返品できる数量を超えないよう丸めたもの) */
  quantity: number;
  returnable: number;
  lotNo: string;
  expiryDate?: string;
  warehouseId: string;
  /** 戻し先の既存ロット (同じロットNo・倉庫・賞味期限)。なければ新しいロットを作る */
  existingLot?: Lot;
  /** 戻したロットの原価。売れたときのロット原価 (costUnitPrice) を使う */
  unitCost: number;
  /** 差し引く売上 (税抜・プラスの値) */
  amount: number;
  /** 返品できない理由 (できるなら空文字) */
  error: string;
}

/**
 * 売上返品の計画を立てる。状態は変更しない。
 * 戻すロットは元の売上と同じロットNo。同じ倉庫に同じロットNo・賞味期限のロットが残っていれば
 * そこへ足し、なければ作り直す (賞味期限は同じ商品の同じロットNoのロットから、なければロットNoから復元)。
 */
export function planSalesReturn(products: Product[], ledger: StockTransaction[], input: SalesReturnInput): SalesReturnPlan {
  const sale = ledger.find(t => t.id === input.saleTxnId && t.type === '売上出庫');
  const empty: SalesReturnPlan = {
    sale, quantity: 0, returnable: 0, lotNo: sale?.lotNo ?? '', warehouseId: input.warehouseId,
    unitCost: 0, amount: 0, error: '',
  };
  if (!sale) return { ...empty, error: '返品する売上が見つかりません' };
  const product = products.find(p => p.id === sale.productId);
  if (!product) return { ...empty, error: '商品が削除されているため、在庫に戻せません' };
  const returnable = returnableSaleQuantity(ledger, sale.id);
  const quantity = Math.min(Math.max(0, Math.floor(input.quantity)), returnable);
  const expiryDate = product.lots.find(l => l.lotNo === sale.lotNo && l.expiryDate)?.expiryDate ?? expiryFromLotNo(sale.lotNo);
  const existingLot = product.lots.find(l =>
    l.lotNo === sale.lotNo && l.warehouseId === input.warehouseId && (l.expiryDate ?? '') === (expiryDate ?? ''));
  const unitCost = sale.costUnitPrice ?? product.costPrice;
  const unitPrice = sale.unitPrice ?? product.price;
  let error = '';
  if (returnable <= 0) error = 'この売上はすべて返品済みです';
  else if (!input.warehouseId) error = '戻し先の倉庫を選んでください';
  else if (quantity <= 0) error = '返品数量を入力してください';
  return {
    sale, product, quantity, returnable, lotNo: sale.lotNo, expiryDate, warehouseId: input.warehouseId,
    existingLot, unitCost, amount: unitPrice * quantity, error,
  };
}

export interface PurchaseReturnInput {
  productId: string;
  lotId: string;
  quantity: number;
  /** 仕入先マスタの id (必須) */
  supplierId: string;
  /** 返品単価 (税抜・円)。0 は未入力 */
  unitPrice: number;
  note?: string;
}

/** 仕入返品の初期値: そのロットを入荷したときの仕入先・入荷記録と、ロットの原価 */
export function purchaseReturnDefaults(product: Product, lot: Lot, ledger: StockTransaction[]): { supplierId: string; inboundTxnId: string; unitPrice: number } {
  // 帳票は新しい順なので、最初に見つかった入荷がいちばん新しい入荷
  const inbound = ledger.find(t =>
    t.type === '入荷' && t.productId === product.id && t.lotNo === lot.lotNo && t.toWarehouseId === lot.warehouseId && t.supplierId)
    ?? ledger.find(t => t.type === '入荷' && t.productId === product.id && t.lotNo === lot.lotNo && t.supplierId);
  return {
    supplierId: inbound?.supplierId ?? '',
    inboundTxnId: inbound?.id ?? '',
    unitPrice: Math.round(lotUnitCost(lot, product)),
  };
}

export interface PurchaseReturnPlan {
  product?: Product;
  lot?: Lot;
  quantity: number;
  amount: number; // 返品金額 (税抜) = 返品単価 × 数量
  error: string;
}

/** 仕入返品の計画 (モーダルのプレビューと returnToSupplier が共有する)。数量はロットの在庫まで */
export function planPurchaseReturn(products: Product[], suppliers: Supplier[], input: PurchaseReturnInput): PurchaseReturnPlan {
  const product = products.find(p => p.id === input.productId);
  const lot = product?.lots.find(l => l.id === input.lotId);
  if (!product || !lot) return { quantity: 0, amount: 0, error: '返品するロットが見つかりません' };
  const quantity = Math.min(Math.max(0, Math.floor(input.quantity)), lot.quantity);
  let error = '';
  if (!input.supplierId || !suppliers.some(s => s.id === input.supplierId)) error = '返品先の仕入先を選んでください';
  else if (lot.quantity <= 0) error = 'このロットには在庫がありません';
  else if (quantity <= 0) error = '返品数量を入力してください';
  const unitPrice = Math.max(0, Math.round(input.unitPrice));
  return { product, lot, quantity, amount: unitPrice * quantity, error };
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
    // 返品は件数に数えず、数量・金額・粗利だけ差し引く
    if (!r.isReturn) usage.saleCount++;
    usage.quantity += r.quantity;
    usage.amount += r.amount;
    usage.profit += r.profit;
    if (!r.isReturn && r.date > usage.lastSaleAt) usage.lastSaleAt = r.date;
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
// 納品書・請求書 (docs/sales-document-feature.md)
// 売上 (帳票の「売上出庫」) を得意先ごとにまとめて書類にする。発注書・発注履歴の販売側の対で、
// 発行した内容は salesDocumentItems にスナップショットとして残し、あとから同じ内容で再印刷できる。
// 在庫は動かないので帳票には何も書かない。
//
// 消費税は売上管理 (salesRows) と違い「1枚の書類につき税率ごとに1回」端数処理する
// (適格請求書の端数処理のルール)。そのため書類の消費税額は、同じ売上を売上管理で
// 足し上げた額と数円ずれることがある。
// ---------------------------------------------------------------------------

export type SalesDocumentKind = '納品書' | '請求書';
export const SALES_DOCUMENT_KINDS: SalesDocumentKind[] = ['納品書', '請求書'];

/** 書類に載せる発行元 (自社) の情報。発注書の発注元と同じく端末ごとの入力補助 (localStorage) */
export interface SalesDocumentIssuer {
  name: string;
  address: string;
  phone: string;
  contact: string;
  /** 適格請求書発行事業者の登録番号 (T + 13桁)。空なら書類に載せない */
  registrationNo: string;
  /** 振込先 (請求書だけに載せる自由記述) */
  bankAccount: string;
}

export const EMPTY_SALES_DOCUMENT_ISSUER: SalesDocumentIssuer = {
  name: '', address: '', phone: '', contact: '', registrationNo: '', bankAccount: '',
};

/**
 * 発行した書類の明細1行 (永続化の単位)。発注履歴 (PurchaseOrderPrintItem) と同じく、
 * 同じ documentId の行が1枚の書類で、ヘッダ情報 (得意先・発行元など) は各行にそのまま持たせる。
 * 商品名・得意先名などは発行した時点のスナップショットなので、あとでマスタを変えても変わらない。
 */
export interface SalesDocumentItem {
  id: string;
  documentId: string;
  kind: SalesDocumentKind;
  documentNo: string; // 書類番号 (例: D20261117-001 / I20261117-001)
  issuedAt: string; // 発行操作をした日時 (ISO)
  issueDate: string; // 書類に記載する発行日 YYYY-MM-DD
  customerId: string;
  customerName: string;
  customerAddress: string;
  customerContact: string;
  periodFrom: string; // 対象期間 (納品書は納品日と同じ日)
  periodTo: string;
  dueDate: string; // お支払期限 (請求書だけ。納品書は空文字)
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerContact: string;
  issuerRegistrationNo: string;
  issuerBankAccount: string;
  lineNo: number; // 書類内の行番号 (1始まり)
  deliveryDate: string; // 納品日 YYYY-MM-DD
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number; // 税抜
  amount: number; // quantity * unitPrice (税抜)
  taxRate: TaxRate;
  txnIds: string[]; // この行にまとめた帳票 (売上出庫) の id
  /**
   * 繰越型の請求書だけ: 前回御請求額・御入金額・繰越額 (発行した時点のスナップショット。各行に同じ値)。
   * この機能より前の請求書と納品書は持たない (紙面に繰越欄を出さない)
   */
  balanceForward?: BalanceForward;
}

/** 書類に載せる候補の1行。同じ日・同じ商品・同じ単価・同じ税率の売上を1行にまとめたもの */
export interface SalesDocumentLine {
  key: string;
  deliveryDate: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: TaxRate;
  txnIds: string[];
  /** 実売単価が記録されておらず、販売定価で代用した売上を含む */
  estimatedPrice: boolean;
  /** すでに同じ種類の書類に載っている場合はその書類番号 (二重発行の防止) */
  issuedNo: string;
  /** 売上返品の行 (数量・金額はマイナス) */
  isReturn: boolean;
}

/** 帳票の id → その売上を載せた書類番号 (指定した種類の書類だけ) */
export function issuedSalesDocumentNos(items: SalesDocumentItem[], kind: SalesDocumentKind): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of items) {
    if (i.kind !== kind) continue;
    for (const id of i.txnIds) map.set(id, i.documentNo);
  }
  return map;
}

/**
 * 得意先・期間 (納品日。両端を含む) の売上を、書類の明細行にまとめる。
 * 同じ納品日・商品・単価・税率の売上 (FEFO でロットごとに分かれた行など) は1行にまとめる。
 * すでに発行済みの売上は issuedNo を付けて別の行にする (未発行の売上と混ぜない)。
 * 得意先なしの売上は宛先がないので対象外。納品日の古い順 → 商品名順。
 * 売上返品はマイナスの行として別にまとめる (includeReturns=false で除外。納品書は返品を載せない)。
 */
export function salesDocumentLines(
  sales: SalesRow[],
  customerId: string,
  from: string,
  to: string,
  issued: Map<string, string> = new Map(),
  options: { includeReturns?: boolean } = {},
): SalesDocumentLine[] {
  if (!customerId) return [];
  const { includeReturns = true } = options;
  const byKey = new Map<string, SalesDocumentLine>();
  for (const r of sales) {
    if (r.customerId !== customerId) continue;
    if (r.isReturn && !includeReturns) continue;
    const day = localDateKey(r.date);
    if (from && day < from) continue;
    if (to && day > to) continue;
    const issuedNo = issued.get(r.txnId) ?? '';
    const key = [day, r.productId, r.unitPrice, r.taxRate, issuedNo, r.isReturn ? 'R' : 'S'].join('|');
    const line = byKey.get(key) ?? {
      key,
      deliveryDate: day,
      productId: r.productId,
      productName: r.productName,
      productSku: r.productSku,
      quantity: 0,
      unitPrice: r.unitPrice,
      amount: 0,
      taxRate: r.taxRate,
      txnIds: [],
      estimatedPrice: false,
      issuedNo,
      isReturn: r.isReturn,
    };
    line.quantity += r.quantity;
    line.amount += r.amount;
    line.txnIds.push(r.txnId);
    line.estimatedPrice ||= r.estimatedPrice;
    byKey.set(key, line);
  }
  return [...byKey.values()].sort((a, b) =>
    a.deliveryDate.localeCompare(b.deliveryDate) || a.productName.localeCompare(b.productName)
    || a.unitPrice - b.unitPrice || Number(a.isReturn) - Number(b.isReturn));
}

export interface SalesDocumentTotals {
  quantity: number;
  amount: number; // 税抜
  tax: number;
  amountWithTax: number;
  /** 書類に載っている税率だけ (軽減税率が先) */
  byTaxRate: SalesTaxBreakdown[];
}

/**
 * 書類の合計。消費税は税率ごとに税抜金額を合計してから1回だけ四捨五入する
 * (適格請求書の端数処理。明細ごとに丸める salesTotals とは数円ずれることがある)。
 */
export function salesDocumentTotals(lines: Pick<SalesDocumentLine, 'quantity' | 'amount' | 'taxRate'>[]): SalesDocumentTotals {
  const byTaxRate = TAX_RATES
    .filter(rate => lines.some(l => l.taxRate === rate))
    .map(taxRate => {
      const amount = lines.filter(l => l.taxRate === taxRate).reduce((s, l) => s + l.amount, 0);
      const tax = taxAmount(amount, taxRate);
      return { taxRate, amount, tax, amountWithTax: amount + tax };
    });
  const amount = byTaxRate.reduce((s, b) => s + b.amount, 0);
  const tax = byTaxRate.reduce((s, b) => s + b.tax, 0);
  return { quantity: lines.reduce((s, l) => s + l.quantity, 0), amount, tax, amountWithTax: amount + tax, byTaxRate };
}

/**
 * 次の書類番号。種類ごとの接頭辞 (納品書 D / 請求書 I) + 発行日 + その日の連番3桁。
 * 連番は同じ接頭辞・日付の既存番号の最大値 + 1 (取り消した書類があっても既存の番号とは重ならない)。
 */
export function nextSalesDocumentNo(kind: SalesDocumentKind, issueDate: string, items: SalesDocumentItem[]): string {
  const prefix = `${kind === '納品書' ? 'D' : 'I'}${issueDate.replace(/-/g, '')}-`;
  let max = 0;
  for (const i of items) {
    if (!i.documentNo.startsWith(prefix)) continue;
    const n = Number(i.documentNo.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** 前月の1日〜末日 (請求書の対象期間の既定値 = 月末締め) */
export function previousMonthRange(today = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return {
    from: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

/** 締め日 (YYYY-MM-DD) の翌月末 (お支払期限の既定値) */
export function nextMonthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(y, m + 1, 0); // m は1始まりなので m+1 月の0日 = 翌月末
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
}

/** 登録番号の形式 (T + 13桁)。空は「載せない」なので可 */
export function isValidRegistrationNo(value: string): boolean {
  return value === '' || /^T\d{13}$/.test(value);
}

export interface IssueSalesDocumentInput {
  kind: SalesDocumentKind;
  issueDate: string;
  customer: Customer;
  periodFrom: string;
  periodTo: string;
  dueDate: string; // 納品書では使わない
  issuer: SalesDocumentIssuer;
  lines: SalesDocumentLine[];
  /**
   * 請求書に繰越欄を載せるとき。値は発行時に balanceForward() で計算し直すので、
   * 呼び出し側の値 (プレビュー用) が古くても保存されるのは発行した時点の繰越になる
   */
  balanceForward?: BalanceForward;
}

/** 発行できない理由 (できるなら空文字)。モーダルのボタンと issueSalesDocument で共有する */
export function salesDocumentValidationError(input: IssueSalesDocumentInput): string {
  if (!input.customer?.id) return '得意先を選んでください';
  if (!input.issueDate) return '発行日を入力してください';
  if (!input.periodFrom || !input.periodTo) return input.kind === '納品書' ? '納品日を入力してください' : '対象期間を入力してください';
  if (input.periodFrom > input.periodTo) return '対象期間の開始日が終了日より後になっています';
  if (!isValidRegistrationNo(input.issuer.registrationNo.trim())) return '登録番号は「T」に続けて13桁の数字で入力してください';
  if (input.lines.length === 0) return '書類に載せる売上を1件以上選んでください';
  if (input.lines.some(l => l.issuedNo)) return `すでに${input.kind}に載っている売上は選べません`;
  return '';
}

/** 1枚の書類 (同じ documentId の明細をまとめたもの) */
export interface SalesDocument {
  documentId: string;
  kind: SalesDocumentKind;
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
  issuer: SalesDocumentIssuer;
  items: SalesDocumentItem[];
  totals: SalesDocumentTotals;
  /** 繰越型の請求書だけ */
  balanceForward?: BalanceForward;
}

/**
 * 発行内容から保存する明細行を作る。モーダルのプレビューも同じ関数で組み立てる
 * (documentId だけ仮の値) ので、プレビューと保存される内容は食い違わない。
 */
export function buildSalesDocumentItems(
  input: IssueSalesDocumentInput,
  existing: SalesDocumentItem[],
  documentId: string,
  issuedAt: string,
): SalesDocumentItem[] {
  const documentNo = nextSalesDocumentNo(input.kind, input.issueDate, existing);
  const issuer = input.issuer;
  return input.lines.map((l, idx) => ({
    id: `${documentId}-${idx + 1}`,
    documentId,
    kind: input.kind,
    documentNo,
    issuedAt,
    issueDate: input.issueDate,
    customerId: input.customer.id,
    customerName: input.customer.name,
    customerAddress: input.customer.address,
    customerContact: input.customer.contact,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    dueDate: input.kind === '請求書' ? input.dueDate : '',
    issuerName: issuer.name.trim(),
    issuerAddress: issuer.address.trim(),
    issuerPhone: issuer.phone.trim(),
    issuerContact: issuer.contact.trim(),
    issuerRegistrationNo: issuer.registrationNo.trim(),
    issuerBankAccount: input.kind === '請求書' ? issuer.bankAccount.trim() : '',
    lineNo: idx + 1,
    deliveryDate: l.deliveryDate,
    productName: l.productName,
    productSku: l.productSku,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    taxRate: l.taxRate,
    txnIds: [...l.txnIds],
    ...(input.kind === '請求書' && input.balanceForward ? { balanceForward: { ...input.balanceForward } } : {}),
  }));
}

/** 同じ書類の明細行 (1件以上) から書類を組み立てる */
function toSalesDocument(items: SalesDocumentItem[]): SalesDocument {
  const sorted = [...items].sort((a, b) => a.lineNo - b.lineNo);
  const h = sorted[0];
  return {
    documentId: h.documentId,
    kind: h.kind,
    documentNo: h.documentNo,
    issuedAt: h.issuedAt,
    issueDate: h.issueDate,
    customerId: h.customerId,
    customerName: h.customerName,
    customerAddress: h.customerAddress,
    customerContact: h.customerContact,
    periodFrom: h.periodFrom,
    periodTo: h.periodTo,
    dueDate: h.dueDate,
    issuer: {
      name: h.issuerName,
      address: h.issuerAddress,
      phone: h.issuerPhone,
      contact: h.issuerContact,
      registrationNo: h.issuerRegistrationNo,
      bankAccount: h.issuerBankAccount,
    },
    items: sorted,
    totals: salesDocumentTotals(sorted),
    ...(h.balanceForward ? { balanceForward: h.balanceForward } : {}),
  };
}

/** 発行内容をプレビュー用の書類にする (明細0件でも見出しだけの書類を返す) */
export function draftSalesDocument(input: IssueSalesDocumentInput, existing: SalesDocumentItem[]): SalesDocument {
  const items = buildSalesDocumentItems(input, existing, 'preview', '');
  if (items.length > 0) return toSalesDocument(items);
  return {
    documentId: 'preview',
    kind: input.kind,
    documentNo: nextSalesDocumentNo(input.kind, input.issueDate, existing),
    issuedAt: '',
    issueDate: input.issueDate,
    customerId: input.customer?.id ?? '',
    customerName: input.customer?.name ?? '',
    customerAddress: input.customer?.address ?? '',
    customerContact: input.customer?.contact ?? '',
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    dueDate: input.kind === '請求書' ? input.dueDate : '',
    issuer: input.issuer,
    items: [],
    totals: salesDocumentTotals([]),
    ...(input.kind === '請求書' && input.balanceForward ? { balanceForward: input.balanceForward } : {}),
  };
}

/** 複数の書類をまとめてプレビューする (締め請求)。書類番号は発行と同じく続き番号になる */
export function draftSalesDocuments(inputs: IssueSalesDocumentInput[], existing: SalesDocumentItem[]): SalesDocument[] {
  let all = existing;
  return inputs.map((input, idx) => {
    const rows = buildSalesDocumentItems(input, all, `preview-${idx}`, '');
    const doc = rows.length > 0 ? toSalesDocument(rows) : draftSalesDocument(input, all);
    all = [...all, ...rows];
    return doc;
  });
}

/**
 * 書類をまとめて発行するときの中身 (issueSalesDocument / 締め請求の issueSalesDocuments が使う)。
 * 1枚ずつ、それまでに発行した分 (同じ呼び出しで先に作った書類も含む) で
 * - 載せる売上がすでに同じ種類の書類に載っていないかを付け直して検証し (二重請求の防止)
 * - 繰越型の請求書は繰越を計算し直す
 * 発行できない入力は飛ばす。書類番号は続き番号になる。
 */
export function prepareSalesDocuments(
  inputs: IssueSalesDocumentInput[],
  existing: SalesDocumentItem[],
  payments: PaymentItem[],
  newId: () => string,
  issuedAt: string,
): { created: SalesDocumentItem[]; docs: SalesDocument[] } {
  let all = existing;
  const created: SalesDocumentItem[] = [];
  const docs: SalesDocument[] = [];
  for (const input of inputs) {
    const issued = issuedSalesDocumentNos(all, input.kind);
    const lines = input.lines.map(l => ({ ...l, issuedNo: l.txnIds.map(id => issued.get(id)).find(Boolean) ?? '' }));
    const checked: IssueSalesDocumentInput = {
      ...input,
      lines,
      ...(input.kind === '請求書' && input.balanceForward
        ? { balanceForward: balanceForward(input.customer.id, all, payments, input.issueDate) }
        : {}),
    };
    if (salesDocumentValidationError(checked)) continue;
    const rows = buildSalesDocumentItems(checked, all, newId(), issuedAt);
    all = [...all, ...rows];
    created.push(...rows);
    docs.push(toSalesDocument(rows));
  }
  return { created, docs };
}

export interface SalesDocumentFilter {
  keyword: string; // 書類番号・得意先名・商品名・SKU の部分一致
  kind: SalesDocumentKind | '';
  customerId: string;
  from: string; // 発行日 YYYY-MM-DD (この日を含む)
  to: string;
}

export const EMPTY_SALES_DOCUMENT_FILTER: SalesDocumentFilter = { keyword: '', kind: '', customerId: '', from: '', to: '' };

/** 発行した書類の一覧 (発行操作の新しい順)。絞り込みは書類単位 */
export function salesDocuments(
  items: SalesDocumentItem[],
  filter: SalesDocumentFilter = EMPTY_SALES_DOCUMENT_FILTER,
): SalesDocument[] {
  const byDoc = new Map<string, SalesDocumentItem[]>();
  for (const i of items) {
    const list = byDoc.get(i.documentId);
    if (list) list.push(i); else byDoc.set(i.documentId, [i]);
  }
  const q = filter.keyword.trim().toLowerCase();
  const docs: SalesDocument[] = [];
  for (const list of byDoc.values()) {
    const doc = toSalesDocument(list);
    if (filter.kind && doc.kind !== filter.kind) continue;
    if (filter.customerId && doc.customerId !== filter.customerId) continue;
    if (filter.from && doc.issueDate < filter.from) continue;
    if (filter.to && doc.issueDate > filter.to) continue;
    if (q && !(
      doc.documentNo.toLowerCase().includes(q)
      || doc.customerName.toLowerCase().includes(q)
      || doc.items.some(i => i.productName.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q))
    )) continue;
    docs.push(doc);
  }
  return docs.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.documentNo.localeCompare(a.documentNo));
}

export function salesDocumentCsv(docs: SalesDocument[]): string {
  const header = '種類,書類番号,発行日,得意先,対象期間（開始）,対象期間（終了）,お支払期限,納品日,商品名,SKU,数量,単価（税抜）,金額（税抜）,税率';
  const body = docs.flatMap(d => d.items.map(i => [
    d.kind,
    d.documentNo,
    d.issueDate,
    d.customerName,
    d.periodFrom,
    d.periodTo,
    d.dueDate,
    i.deliveryDate,
    i.productName,
    i.productSku,
    i.quantity,
    i.unitPrice,
    i.amount,
    `${i.taxRate}%`,
  ].map(csvCell).join(',')));
  return [header, ...body].join('\n');
}

export function exportSalesDocumentCsv(docs: SalesDocument[]) {
  downloadCsv(csvFileName('salesDocument'), salesDocumentCsv(docs));
}

// ---------------------------------------------------------------------------
// 入金管理・売掛金 (docs/receivable-feature.md)
// 発行した請求書 (salesDocumentItems の 請求書) に入金を充てて (消込)、請求書ごとの残高と
// 得意先ごとの売掛金残高を出す。入金は paymentItems に保存し、状態 (未入金/一部入金/入金済) や
// 残高・期限超過は保存せず毎回計算する (入荷予定・受注の状態と同じ方針)。
// 在庫は動かないので帳票には何も書かない。
//
// 1回の入金 (振込1回) は receiptId でまとめ、充てた請求書ごとに1行に分けて持つ。
// 請求書に充てきれなかった分は documentId が空の行 (未消込 = 前受・過入金) として残す。
// 振込手数料 (先方が差し引いて振り込んだ額) は入金額と合わせて請求書の消込に充てる。
// ---------------------------------------------------------------------------

export type PaymentMethod = '振込' | '現金' | '手形' | '相殺' | 'その他';
export const PAYMENT_METHODS: PaymentMethod[] = ['振込', '現金', '手形', '相殺', 'その他'];

/** 入金の明細1行 (永続化の単位)。同じ receiptId の行が1回の入金 */
export interface PaymentItem {
  id: string;
  receiptId: string;
  customerId: string;
  paymentDate: string; // 入金日 YYYY-MM-DD
  method: PaymentMethod;
  documentId: string; // 消込先の請求書 ('' = 未消込)
  documentNo: string; // 消込先の請求書番号 (表示用のスナップショット)
  amount: number; // この行の入金額
  fee: number; // この行に充てた振込手数料
  note: string;
  createdAt: string; // 登録操作の日時 (ISO)
}

/** 請求書の入金状況。保存せず、請求額と消込額から毎回求める */
export type InvoicePaymentStatus = '未入金' | '一部入金' | '入金済';
export const INVOICE_PAYMENT_STATUSES: InvoicePaymentStatus[] = ['未入金', '一部入金', '入金済'];

/** 請求書1枚の入金状況 (入金管理の「請求書別」の1行) */
export interface ReceivableRow {
  documentId: string;
  documentNo: string;
  customerId: string;
  customerName: string; // 請求書を発行した時点の得意先名
  issueDate: string;
  dueDate: string; // お支払期限 ('' = 期限なし)
  periodFrom: string;
  periodTo: string;
  billed: number; // 請求額 (税込)
  paid: number; // 消込済みの額 (入金額 + 振込手数料)
  remaining: number; // 残高 = billed - paid
  status: InvoicePaymentStatus;
  /** お支払期限を過ぎて残高がある日数 (期限内・入金済は 0) */
  overdueDays: number;
  lastPaymentDate: string; // 最後に入金を充てた日 ('' = なし)
}

/** 端末のローカル日付で今日の YYYY-MM-DD */
export function todayKey(now = new Date()): string {
  return localDateKey(now.toISOString());
}

export function invoicePaymentStatus(billed: number, paid: number): InvoicePaymentStatus {
  // 返品だけの請求書など請求額が 0 以下のものは、回収するものがないので入金済扱い
  if (billed <= 0 || paid >= billed) return '入金済';
  return paid > 0 ? '一部入金' : '未入金';
}

/**
 * 発行した請求書ごとの入金状況。納品書は請求ではないので含めない。
 * 並びは お支払期限の早い順 (期限なしは最後) → 発行日 → 書類番号。
 */
export function receivableRows(
  items: SalesDocumentItem[],
  payments: PaymentItem[],
  today = todayKey(),
): ReceivableRow[] {
  const paidByDoc = new Map<string, { paid: number; last: string }>();
  for (const p of payments) {
    if (!p.documentId) continue;
    const cur = paidByDoc.get(p.documentId) ?? { paid: 0, last: '' };
    cur.paid += p.amount + p.fee;
    if (p.paymentDate > cur.last) cur.last = p.paymentDate;
    paidByDoc.set(p.documentId, cur);
  }
  return salesDocuments(items.filter(i => i.kind === '請求書'))
    .map(doc => {
      const billed = doc.totals.amountWithTax;
      const { paid, last } = paidByDoc.get(doc.documentId) ?? { paid: 0, last: '' };
      const remaining = billed - paid;
      const overdueDays = remaining > 0 && doc.dueDate && doc.dueDate < today ? daysBetweenKeys(doc.dueDate, today) : 0;
      return {
        documentId: doc.documentId,
        documentNo: doc.documentNo,
        customerId: doc.customerId,
        customerName: doc.customerName,
        issueDate: doc.issueDate,
        dueDate: doc.dueDate,
        periodFrom: doc.periodFrom,
        periodTo: doc.periodTo,
        billed,
        paid,
        remaining,
        status: invoicePaymentStatus(billed, paid),
        overdueDays,
        lastPaymentDate: last,
      };
    })
    .sort((a, b) =>
      (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')
      || a.issueDate.localeCompare(b.issueDate)
      || a.documentNo.localeCompare(b.documentNo));
}

/** 請求書別の絞り込み。'未回収' は 未入金 + 一部入金、'期限超過' はお支払期限を過ぎて残高があるもの */
export type ReceivableStatusFilter = '' | InvoicePaymentStatus | '未回収' | '期限超過';

export interface ReceivableFilter {
  keyword: string; // 請求書番号・得意先名の部分一致
  customerId: string;
  status: ReceivableStatusFilter;
}

/** 入金管理を開いたときの絞り込み。回収が要るものだけを見せる */
export const DEFAULT_RECEIVABLE_FILTER: ReceivableFilter = { keyword: '', customerId: '', status: '未回収' };

export function filterReceivables(rows: ReceivableRow[], filter: ReceivableFilter): ReceivableRow[] {
  const q = filter.keyword.trim().toLowerCase();
  return rows.filter(r => {
    if (filter.customerId && r.customerId !== filter.customerId) return false;
    if (filter.status === '未回収' && r.status === '入金済') return false;
    if (filter.status === '期限超過' && r.overdueDays <= 0) return false;
    if ((INVOICE_PAYMENT_STATUSES as string[]).includes(filter.status) && r.status !== filter.status) return false;
    if (q && !(r.documentNo.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** 得意先1件の売掛金 (入金管理の「得意先別」の1行) */
export interface CustomerReceivable {
  customerId: string;
  customerName: string;
  invoiceBalance: number; // 請求済みで未回収の額 (請求書の残高の合計)
  overdue: number; // うちお支払期限を過ぎている額
  openInvoices: number; // 残高のある請求書の枚数
  unbilled: number; // まだ請求書に載せていない売上 (税込。返品は差し引く)
  unapplied: number; // 請求書に充てていない入金 (前受・過入金)
  balance: number; // 売掛金残高 = invoiceBalance + unbilled - unapplied
  lastPaymentDate: string;
}

/**
 * 得意先ごとの売掛金。請求済みの残高に、まだ請求していない売上を足し、どの請求書にも充てていない
 * 入金を差し引く。未請求売上の税込金額は売上管理と同じ明細ごとの端数処理 (salesRows の amountWithTax)
 * なので、あとで請求書にすると (税率ごとに1回の端数処理で) 数円ずれることがある。
 * 得意先なしの売上は請求できないので含めない。残高・未請求・未消込がすべて 0 の得意先は出さない。
 * 並びは 売掛金残高の多い順 → 得意先名。
 */
export function customerReceivables(
  receivables: ReceivableRow[],
  sales: SalesRow[],
  items: SalesDocumentItem[],
  payments: PaymentItem[],
  customers: Customer[],
): CustomerReceivable[] {
  const nameById = new Map(customers.map(c => [c.id, c.name]));
  const byId = new Map<string, CustomerReceivable>();
  const get = (customerId: string, fallbackName = '') => {
    let r = byId.get(customerId);
    if (!r) {
      r = {
        customerId,
        customerName: nameById.get(customerId) ?? (fallbackName || '（削除された得意先）'),
        invoiceBalance: 0, overdue: 0, openInvoices: 0, unbilled: 0, unapplied: 0, balance: 0, lastPaymentDate: '',
      };
      byId.set(customerId, r);
    }
    return r;
  };
  for (const r of receivables) {
    const c = get(r.customerId, r.customerName);
    c.invoiceBalance += r.remaining;
    if (r.overdueDays > 0) c.overdue += r.remaining;
    if (r.remaining > 0) c.openInvoices++;
  }
  const invoiced = issuedSalesDocumentNos(items, '請求書');
  for (const s of sales) {
    if (!s.customerId || invoiced.has(s.txnId)) continue;
    get(s.customerId, s.customerName).unbilled += s.amountWithTax;
  }
  for (const p of payments) {
    const c = get(p.customerId);
    if (!p.documentId) c.unapplied += p.amount + p.fee;
    if (p.paymentDate > c.lastPaymentDate) c.lastPaymentDate = p.paymentDate;
  }
  return [...byId.values()]
    .map(c => ({ ...c, balance: c.invoiceBalance + c.unbilled - c.unapplied }))
    .filter(c => c.invoiceBalance !== 0 || c.unbilled !== 0 || c.unapplied !== 0)
    .sort((a, b) => b.balance - a.balance || a.customerName.localeCompare(b.customerName));
}

export interface ReceivableTotals {
  invoiceBalance: number;
  openInvoices: number;
  overdue: number;
  overdueInvoices: number;
  unbilled: number;
  unapplied: number;
  balance: number;
  /** 今月 (today の月) の入金額 (振込手数料は含めない) */
  receivedThisMonth: number;
}

export function receivableTotals(
  receivables: ReceivableRow[],
  customerRows: CustomerReceivable[],
  payments: PaymentItem[],
  today = todayKey(),
): ReceivableTotals {
  const month = today.slice(0, 7);
  return {
    invoiceBalance: customerRows.reduce((s, c) => s + c.invoiceBalance, 0),
    openInvoices: receivables.filter(r => r.remaining > 0).length,
    overdue: receivables.reduce((s, r) => s + (r.overdueDays > 0 ? r.remaining : 0), 0),
    overdueInvoices: receivables.filter(r => r.overdueDays > 0).length,
    unbilled: customerRows.reduce((s, c) => s + c.unbilled, 0),
    unapplied: customerRows.reduce((s, c) => s + c.unapplied, 0),
    balance: customerRows.reduce((s, c) => s + c.balance, 0),
    receivedThisMonth: payments.filter(p => p.paymentDate.startsWith(month)).reduce((s, p) => s + p.amount, 0),
  };
}

/** 入金の入力値 (入金登録モーダルから) */
export interface PaymentInput {
  customerId: string;
  paymentDate: string;
  method: PaymentMethod;
  amount: number; // 入金額 (実際に受け取った額)
  fee: number; // 振込手数料 (先方が差し引いた額。請求額の消込に含める)
  /** 充てる請求書。お支払期限の早いものから順に充てる */
  documentIds: string[];
  note: string;
}

/** 請求書1枚への充当 */
export interface PaymentAllocation {
  documentId: string;
  documentNo: string;
  dueDate: string;
  remainingBefore: number;
  applied: number; // この請求書に充てた額 (amount + fee)
  amount: number;
  fee: number;
  remainingAfter: number;
}

export interface PaymentPlan {
  allocations: PaymentAllocation[];
  /** 請求書に充てきれず未消込として残す入金額 */
  unappliedAmount: number;
  /** 未消込に残る振込手数料 (請求書を選ばなかったときなど) */
  unappliedFee: number;
  total: number; // amount + fee
  /** 登録できない理由 (できるなら空文字) */
  error: string;
}

/** 入金を登録できない理由 (できるなら空文字)。モーダルのボタンと recordPayment で共有する */
export function paymentValidationError(input: PaymentInput): string {
  if (!input.customerId) return '得意先を選んでください';
  if (!input.paymentDate) return '入金日を入力してください';
  if (!Number.isInteger(input.amount) || input.amount <= 0) return '入金額は1円以上の整数で入力してください';
  if (!Number.isInteger(input.fee) || input.fee < 0) return '振込手数料は0円以上の整数で入力してください';
  return '';
}

/**
 * 入金を請求書に充てる計画。選んだ請求書のうち残高のあるものへ、お支払期限の早い順
 * (receivableRows の並び) に残高いっぱいまで充て、充てきれない分は未消込にする。
 * 振込手数料は先に充てた請求書から順に割り当てる (請求書側から見ると「入金 + 手数料」で消し込まれる)。
 * モーダルのプレビューと recordPayment の両方がこの関数を使うので、表示と保存は食い違わない。
 */
export function planPayment(receivables: ReceivableRow[], input: PaymentInput): PaymentPlan {
  const error = paymentValidationError(input);
  const total = Math.max(0, input.amount) + Math.max(0, input.fee);
  if (error) return { allocations: [], unappliedAmount: 0, unappliedFee: 0, total, error };
  const selected = new Set(input.documentIds);
  let left = total;
  let feeLeft = input.fee;
  const allocations: PaymentAllocation[] = [];
  for (const r of receivables) {
    if (left <= 0) break;
    if (!selected.has(r.documentId) || r.customerId !== input.customerId || r.remaining <= 0) continue;
    const applied = Math.min(r.remaining, left);
    const fee = Math.min(feeLeft, applied);
    allocations.push({
      documentId: r.documentId,
      documentNo: r.documentNo,
      dueDate: r.dueDate,
      remainingBefore: r.remaining,
      applied,
      amount: applied - fee,
      fee,
      remainingAfter: r.remaining - applied,
    });
    left -= applied;
    feeLeft -= fee;
  }
  return { allocations, unappliedAmount: left - feeLeft, unappliedFee: feeLeft, total, error: '' };
}

/** 計画から保存する入金の明細行を作る (未消込が残るときは documentId 空の行を最後に足す) */
export function buildPaymentItems(plan: PaymentPlan, input: PaymentInput, receiptId: string, createdAt: string): PaymentItem[] {
  const base = {
    receiptId,
    customerId: input.customerId,
    paymentDate: input.paymentDate,
    method: input.method,
    note: input.note.trim(),
    createdAt,
  };
  const rows: PaymentItem[] = plan.allocations.map((a, idx) => ({
    ...base, id: `${receiptId}-${idx + 1}`, documentId: a.documentId, documentNo: a.documentNo, amount: a.amount, fee: a.fee,
  }));
  if (plan.unappliedAmount > 0 || plan.unappliedFee > 0) {
    rows.push({ ...base, id: `${receiptId}-${rows.length + 1}`, documentId: '', documentNo: '', amount: plan.unappliedAmount, fee: plan.unappliedFee });
  }
  return rows;
}

/** 1回の入金 (同じ receiptId の行をまとめたもの)。入金履歴の1行 */
export interface PaymentReceipt {
  receiptId: string;
  customerId: string;
  customerName: string;
  paymentDate: string;
  method: PaymentMethod;
  amount: number;
  fee: number;
  /** 充てた請求書と額 (amount + fee) */
  applied: { documentId: string; documentNo: string; amount: number }[];
  unapplied: number; // 未消込 (amount + fee)
  note: string;
  createdAt: string;
  items: PaymentItem[];
}

export interface PaymentFilter {
  keyword: string; // 得意先名・請求書番号・備考の部分一致
  customerId: string;
  from: string; // 入金日 YYYY-MM-DD (この日を含む)
  to: string;
}

export const EMPTY_PAYMENT_FILTER: PaymentFilter = { keyword: '', customerId: '', from: '', to: '' };

/** 入金履歴 (入金日の新しい順 → 登録の新しい順)。絞り込みは入金単位 */
export function paymentReceipts(
  payments: PaymentItem[],
  customers: Customer[],
  filter: PaymentFilter = EMPTY_PAYMENT_FILTER,
): PaymentReceipt[] {
  const nameById = new Map(customers.map(c => [c.id, c.name]));
  const byReceipt = new Map<string, PaymentItem[]>();
  for (const p of payments) {
    const list = byReceipt.get(p.receiptId);
    if (list) list.push(p); else byReceipt.set(p.receiptId, [p]);
  }
  const q = filter.keyword.trim().toLowerCase();
  const receipts: PaymentReceipt[] = [];
  for (const list of byReceipt.values()) {
    const items = [...list].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const h = items[0];
    const receipt: PaymentReceipt = {
      receiptId: h.receiptId,
      customerId: h.customerId,
      customerName: nameById.get(h.customerId) ?? '（削除された得意先）',
      paymentDate: h.paymentDate,
      method: h.method,
      amount: items.reduce((s, i) => s + i.amount, 0),
      fee: items.reduce((s, i) => s + i.fee, 0),
      applied: items.filter(i => i.documentId).map(i => ({ documentId: i.documentId, documentNo: i.documentNo, amount: i.amount + i.fee })),
      unapplied: items.filter(i => !i.documentId).reduce((s, i) => s + i.amount + i.fee, 0),
      note: h.note,
      createdAt: h.createdAt,
      items,
    };
    if (filter.customerId && receipt.customerId !== filter.customerId) continue;
    if (filter.from && receipt.paymentDate < filter.from) continue;
    if (filter.to && receipt.paymentDate > filter.to) continue;
    if (q && !(
      receipt.customerName.toLowerCase().includes(q)
      || receipt.note.toLowerCase().includes(q)
      || receipt.applied.some(a => a.documentNo.toLowerCase().includes(q))
    )) continue;
    receipts.push(receipt);
  }
  return receipts.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt));
}

/** 入金が1件でも充てられている請求書の id (取消できない請求書) */
export function paidDocumentIds(payments: PaymentItem[]): Set<string> {
  return new Set(payments.filter(p => p.documentId).map(p => p.documentId));
}

export function receivableCsv(rows: ReceivableRow[]): string {
  const header = '請求書番号,得意先,発行日,お支払期限,請求額（税込）,入金済額,残高,入金状況,期限超過日数,最終入金日';
  const body = rows.map(r => [
    r.documentNo,
    r.customerName,
    r.issueDate,
    r.dueDate,
    r.billed,
    r.paid,
    r.remaining,
    r.status,
    r.overdueDays,
    r.lastPaymentDate,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportReceivableCsv(rows: ReceivableRow[]) {
  downloadCsv(csvFileName('receivable'), receivableCsv(rows));
}

export function customerReceivableCsv(rows: CustomerReceivable[]): string {
  const header = '得意先,請求残高,うち期限超過,未回収の請求書,未請求売上（税込）,未消込入金,売掛金残高,最終入金日';
  const body = rows.map(r => [
    r.customerName,
    r.invoiceBalance,
    r.overdue,
    r.openInvoices,
    r.unbilled,
    r.unapplied,
    r.balance,
    r.lastPaymentDate,
  ].map(csvCell).join(','));
  return [header, ...body].join('\n');
}

export function exportCustomerReceivableCsv(rows: CustomerReceivable[]) {
  downloadCsv(csvFileName('customerReceivable'), customerReceivableCsv(rows));
}

export function paymentCsv(receipts: PaymentReceipt[]): string {
  const header = '入金日,得意先,入金方法,消込先請求書,入金額,振込手数料,消込額,備考';
  const body = receipts.flatMap(r => r.items.map(i => [
    r.paymentDate,
    r.customerName,
    r.method,
    i.documentNo || '未消込',
    i.amount,
    i.fee,
    i.amount + i.fee,
    r.note,
  ].map(csvCell).join(',')));
  return [header, ...body].join('\n');
}

export function exportPaymentCsv(receipts: PaymentReceipt[]) {
  downloadCsv(csvFileName('payment'), paymentCsv(receipts));
}

// ---------------------------------------------------------------------------
// 締め処理 (docs/billing-closing-feature.md)
// 得意先ごとの締め日・支払条件 (Customer.closingDay / paymentMonths / paymentDay) から、
// 締め日を1つ選ぶと、その日が締め日にあたる得意先の請求書 (対象期間・お支払期限・明細・繰越) を
// まとめて組み立てる。発行そのものは既存の請求書と同じ salesDocumentItems に追記するだけで、
// 締めの記録を別に持たない (前回の締め = その得意先の前月の締め日、と日付から決める)。
// 在庫は動かないので帳票には何も書かない。
// ---------------------------------------------------------------------------

export function isClosingDay(value: unknown): value is ClosingDay {
  return CLOSING_DAYS.includes(value as ClosingDay);
}

export function customerClosingDay(c: Pick<Customer, 'closingDay'>): ClosingDay {
  return isClosingDay(c.closingDay) ? c.closingDay : DEFAULT_CLOSING_DAY;
}

export function customerPaymentMonths(c: Pick<Customer, 'paymentMonths'>): PaymentMonths {
  return PAYMENT_MONTHS.includes(c.paymentMonths as PaymentMonths) ? c.paymentMonths as PaymentMonths : DEFAULT_PAYMENT_MONTHS;
}

export function customerPaymentDay(c: Pick<Customer, 'paymentDay'>): PaymentDay {
  return PAYMENT_DAYS.includes(c.paymentDay as PaymentDay) ? c.paymentDay as PaymentDay : DEFAULT_PAYMENT_DAY;
}

/** 例: 「20日締め」「末日締め」「都度請求」 */
export function closingDayLabel(day: ClosingDay): string {
  if (day === AS_NEEDED_CLOSING) return '都度請求';
  return day === END_OF_MONTH ? '末日締め' : `${day}日締め`;
}

/** 例: 「翌月末払い」「翌々月10日払い」 */
export function paymentTermsLabel(months: PaymentMonths, day: PaymentDay): string {
  return `${['当月', '翌月', '翌々月'][months]}${day === END_OF_MONTH ? '末' : `${day}日`}払い`;
}

/** 例: 「20日締め・翌月10日払い」 */
export function customerBillingTermsLabel(c: Pick<Customer, 'closingDay' | 'paymentMonths' | 'paymentDay'>): string {
  return `${closingDayLabel(customerClosingDay(c))}・${paymentTermsLabel(customerPaymentMonths(c), customerPaymentDay(c))}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** year 年 month0 月 (0始まり。範囲外は前後の年に繰り越す) の day 日。31 や月の日数を超える日は月末にする */
function dayInMonth(year: number, month0: number, day: number): string {
  const first = new Date(year, month0, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return `${first.getFullYear()}-${pad2(first.getMonth() + 1)}-${pad2(Math.min(day, last))}`;
}

function splitDate(date: string): { y: number; m0: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m0: m - 1, d };
}

/** 日付 (YYYY-MM-DD) の翌日 */
function nextDay(date: string): string {
  const { y, m0, d } = splitDate(date);
  const dt = new Date(y, m0, d + 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** その日付が、指定の締め日にあたるか (都度請求は常に false) */
export function isClosingDate(date: string, day: ClosingDay): boolean {
  if (!date || day === AS_NEEDED_CLOSING) return false;
  const { y, m0 } = splitDate(date);
  return dayInMonth(y, m0, day) === date;
}

/** today 以前でいちばん近い締め日 (都度請求は空文字) */
export function latestClosingDate(day: ClosingDay, today: string): string {
  if (day === AS_NEEDED_CLOSING) return '';
  const { y, m0 } = splitDate(today);
  const thisMonth = dayInMonth(y, m0, day);
  return thisMonth <= today ? thisMonth : dayInMonth(y, m0 - 1, day);
}

/**
 * 締め日 closingDate の請求の対象期間 = 前月の締め日の翌日 〜 closingDate。
 * 例: 20日締め・11/20 → 10/21〜11/20、末日締め・3/31 → 3/1〜3/31
 */
export function billingPeriod(day: ClosingDay, closingDate: string): { from: string; to: string } {
  const { y, m0 } = splitDate(closingDate);
  return { from: nextDay(dayInMonth(y, m0 - 1, day === AS_NEEDED_CLOSING ? END_OF_MONTH : day)), to: closingDate };
}

/** 支払条件から決まるお支払期限。baseDate (締め日。都度請求は対象期間の末日) の paymentMonths か月後の paymentDay 日 */
export function paymentDueDate(c: Pick<Customer, 'paymentMonths' | 'paymentDay'>, baseDate: string): string {
  const { y, m0 } = splitDate(baseDate);
  return dayInMonth(y, m0 + customerPaymentMonths(c), customerPaymentDay(c));
}

/** 得意先の締め日のうち、today 以前でいちばん近いもの (締め請求を開いたときの初期値)。締める得意先がなければ空文字 */
export function latestClosingDateAmong(customers: Customer[], today: string): string {
  let latest = '';
  for (const c of customers) {
    if (!c.active) continue;
    const date = latestClosingDate(customerClosingDay(c), today);
    if (date > latest) latest = date;
  }
  return latest;
}

/** 繰越型の請求書に載せる前回からの繰越 */
export interface BalanceForward {
  previousBilled: number; // 前回御請求額
  received: number; // 御入金額 (振込手数料を含む消込額)
  carryOver: number; // 繰越額 = 前回御請求額 - 御入金額 (前受があればマイナス)
}

/**
 * これから発行する請求書の繰越。
 * - 繰越額 = それまでに発行した請求書の残高の合計 − どの請求書にも充てていない入金 (入金管理と同じ数え方)
 * - 御入金額 = 前回の請求書の発行日の翌日 〜 issueDate の入金 (振込手数料を含む。前回がなければ issueDate までの全部)
 * - 前回御請求額 = 繰越額 + 御入金額 (逆算。前回の請求書の発行日より前の日付で入金をあとから登録した
 *   などのときは、前回の請求書に印字した額と一致しないことがある)
 */
export function balanceForward(
  customerId: string,
  items: SalesDocumentItem[],
  payments: PaymentItem[],
  issueDate: string,
): BalanceForward {
  const own = receivableRows(items.filter(i => i.customerId === customerId), payments);
  const invoiceBalance = own.reduce((s, r) => s + r.remaining, 0);
  const customerPayments = payments.filter(p => p.customerId === customerId);
  const unapplied = customerPayments.filter(p => !p.documentId).reduce((s, p) => s + p.amount + p.fee, 0);
  const lastIssueDate = own.reduce((max, r) => r.issueDate > max ? r.issueDate : max, '');
  const received = customerPayments
    .filter(p => p.paymentDate > lastIssueDate && p.paymentDate <= issueDate)
    .reduce((s, p) => s + p.amount + p.fee, 0);
  const carryOver = invoiceBalance - unapplied;
  return { previousBilled: carryOver + received, received, carryOver };
}

/** 請求書の「今回御請求額」(繰越型は 繰越額 + 今回御買上額、それ以外は今回の税込合計) */
export function invoiceGrandTotal(doc: Pick<SalesDocument, 'totals' | 'balanceForward'>): number {
  return (doc.balanceForward?.carryOver ?? 0) + doc.totals.amountWithTax;
}

/** 締め請求の1行 = 締め日にあたる得意先1件 */
export interface ClosingCandidate {
  customer: Customer;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  /** 載せる売上 (締め日までのまだ請求書に載っていない売上。対象期間より前の請求漏れも含む) */
  lines: SalesDocumentLine[];
  /** lines のうち対象期間より前の売上 (前回以前の請求漏れ) の行数 */
  earlierLines: number;
  totals: SalesDocumentTotals;
  balance: BalanceForward;
  /** 今回御請求額 = 繰越額 + 今回御買上額 */
  grandTotal: number;
  /** この締め日 (対象期間の末日) の請求書をすでに発行していれば、その書類番号 */
  issuedNo: string;
}

/**
 * 締め日 closingDate にあたる得意先 (都度請求を除く) ごとの請求内容。
 * 載せる売上は締め日までの未請求の売上すべて (対象期間より前の請求漏れも含め、earlierLines で数える)。
 * 返品も差し引く (請求書と同じ)。取引停止の得意先は、載せる売上か繰越があるときだけ出す。
 * 並びは得意先名順。
 */
export function closingCandidates(
  closingDate: string,
  customers: Customer[],
  sales: SalesRow[],
  items: SalesDocumentItem[],
  payments: PaymentItem[],
  issueDate: string,
): ClosingCandidate[] {
  const issued = issuedSalesDocumentNos(items, '請求書');
  const invoices = salesDocuments(items.filter(i => i.kind === '請求書'));
  const result: ClosingCandidate[] = [];
  for (const customer of customers) {
    const day = customerClosingDay(customer);
    if (!isClosingDate(closingDate, day)) continue;
    const { from, to } = billingPeriod(day, closingDate);
    const lines = salesDocumentLines(sales, customer.id, '', to, issued).filter(l => !l.issuedNo);
    const balance = balanceForward(customer.id, items, payments, issueDate);
    if (!customer.active && lines.length === 0 && balance.carryOver === 0) continue;
    const totals = salesDocumentTotals(lines);
    result.push({
      customer,
      periodFrom: from,
      periodTo: to,
      dueDate: paymentDueDate(customer, closingDate),
      lines,
      earlierLines: lines.filter(l => l.deliveryDate < from).length,
      totals,
      balance,
      grandTotal: balance.carryOver + totals.amountWithTax,
      issuedNo: invoices.find(d => d.customerId === customer.id && d.periodTo === closingDate)?.documentNo ?? '',
    });
  }
  return result.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
}

/** 締め請求の1行から発行する請求書の入力を作る */
export function closingInvoiceInput(
  candidate: ClosingCandidate,
  issueDate: string,
  issuer: SalesDocumentIssuer,
): IssueSalesDocumentInput {
  return {
    kind: '請求書',
    issueDate,
    customer: candidate.customer,
    periodFrom: candidate.periodFrom,
    periodTo: candidate.periodTo,
    dueDate: candidate.dueDate,
    issuer,
    lines: candidate.lines,
    balanceForward: candidate.balance,
  };
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
 * - 出庫数は売上出庫・資材使用・調整出庫・廃棄の合計から売上返品を引いたもの (移動は総在庫を動かさず、
 *   仕入返品は需要ではないので数えない)。
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
    // 売上返品は売れた数を取り消すので、期間内の出庫数・売上数から差し引く (最終出庫日は動かさない)
    if (t.type === '売上返品') {
      if (localDateKey(t.date) < from) continue;
      const entry = outbound.get(t.productId) ?? { total: 0, sales: 0, disposal: 0, lastAt: '' };
      entry.total -= t.quantity;
      entry.sales -= t.quantity;
      outbound.set(t.productId, entry);
      continue;
    }
    // 仕入返品は需要ではない (仕入先へ戻しただけ) ので、出庫の勢いにも滞留の判定にも数えない
    if (transactionDirection(t.type) !== 'out' || t.type === '仕入返品') continue;
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
    // 返品の方が多い期間でもマイナスの出庫にはしない
    const outboundQuantity = Math.max(0, entry?.total ?? 0);
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
      salesQuantity: Math.max(0, entry?.sales ?? 0),
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
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(SAMPLE_SALES_ORDERS);
  const [salesDocumentItems, setSalesDocumentItems] = useState<SalesDocumentItem[]>([]);
  const [paymentItems, setPaymentItems] = useState<PaymentItem[]>([]);

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
      // 締め日・支払条件の導入前の得意先は「末日締め・翌月末払い」として扱う (保存し直しは編集したときに行う)
      setCustomers((state.customers ?? []).map(c => ({ ...c, closingDay: customerClosingDay(c), paymentMonths: customerPaymentMonths(c), paymentDay: customerPaymentDay(c) })));
      setSalesOrders(state.salesOrders ?? []);
      setSalesDocumentItems(state.salesDocumentItems ?? []);
      setPaymentItems(state.paymentItems ?? []);
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
    // 受注も同じく出荷しようがないので一緒に消す (出荷済みの売上は帳票に残る)
    setSalesOrders(prev => {
      if (!prev.some(o => o.productId === id)) return prev;
      const next = prev.filter(o => o.productId !== id);
      saveSalesOrders(next); return next;
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

  // ---- 返品 ----
  // どちらも在庫が動くので帳票に1件ずつ記録する。計画は純粋関数 (planSalesReturn / planPurchaseReturn) に
  // 任せ、モーダルのプレビューと実際の処理が食い違わないようにする。

  /** 売上返品: 元の売上を1件選んで在庫へ戻す。戻せなかったときは null */
  const returnSale = useCallback((input: SalesReturnInput): SalesReturnPlan | null => {
    const plan = planSalesReturn(products, ledger, input);
    if (plan.error || !plan.sale || !plan.product) return null;
    const { sale, product } = plan;
    const mergedPrice = mergedLotUnitPrice(plan.existingLot, product, plan.quantity, plan.unitCost);

    setProducts(prev => {
      const now = new Date().toISOString();
      const next = prev.map(p => {
        if (p.id !== product.id) return p;
        const lots = plan.existingLot
          ? p.lots.map(l => l.id === plan.existingLot!.id
              ? { ...l, quantity: l.quantity + plan.quantity, ...(mergedPrice != null ? { unitPrice: mergedPrice } : {}) }
              : l)
          : [...p.lots, {
              id: crypto.randomUUID(),
              lotNo: plan.lotNo,
              ...(plan.expiryDate ? { expiryDate: plan.expiryDate } : {}),
              quantity: plan.quantity,
              warehouseId: plan.warehouseId,
              ...(mergedPrice != null ? { unitPrice: mergedPrice } : {}),
            }];
        return { ...p, lots, updatedAt: now };
      });
      save(next);
      return next;
    });

    const customer = sale.customerId ? customerName(customers, sale.customerId) : '';
    addTransaction({
      type: '売上返品',
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      lotNo: plan.lotNo,
      quantity: plan.quantity,
      note: input.note?.trim() || (customer ? `売上返品（${customer}）` : '売上返品'),
      toWarehouseId: plan.warehouseId,
      // 元の売上の単価・得意先・原価・税率をそのまま写す (売上管理で同じ条件のマイナスの売上になる)
      ...(sale.unitPrice != null ? { unitPrice: sale.unitPrice } : {}),
      ...(sale.customerId ? { customerId: sale.customerId } : {}),
      ...(sale.costUnitPrice != null ? { costUnitPrice: sale.costUnitPrice } : {}),
      ...(sale.taxRate != null ? { taxRate: sale.taxRate } : {}),
      returnOfTxnId: sale.id,
    });
    return plan;
  }, [addTransaction, customers, ledger, products]);

  /** 仕入返品: ロットを1つ選んで仕入先へ返す (在庫を減らす)。返せなかったときは null */
  const returnToSupplier = useCallback((input: PurchaseReturnInput): PurchaseReturnPlan | null => {
    const plan = planPurchaseReturn(products, suppliers, input);
    if (plan.error || !plan.product || !plan.lot) return null;
    const { product, lot } = plan;
    const { inboundTxnId } = purchaseReturnDefaults(product, lot, ledger);

    // 出庫と同じく、在庫0になったロットも残す (ロット行の出庫・FEFO出庫と同じ扱い)
    setProducts(prev => {
      const next = prev.map(p => p.id === product.id
        ? { ...p, lots: p.lots.map(l => l.id === lot.id ? { ...l, quantity: l.quantity - plan.quantity } : l), updatedAt: new Date().toISOString() }
        : p);
      save(next);
      return next;
    });

    const supplier = supplierName(suppliers, input.supplierId);
    const unitPrice = Math.max(0, Math.round(input.unitPrice));
    addTransaction({
      type: '仕入返品',
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      lotNo: lot.lotNo,
      quantity: plan.quantity,
      note: input.note?.trim() || `仕入返品（${supplier}）`,
      fromWarehouseId: lot.warehouseId,
      supplierId: input.supplierId,
      ...(unitPrice > 0 ? { unitPrice } : {}),
      ...(inboundTxnId ? { returnOfTxnId: inboundTxnId } : {}),
    });
    return plan;
  }, [addTransaction, ledger, products, suppliers]);

  // ---- 受注 (出荷予定) ----
  // 受注の作成・編集・キャンセルは在庫を動かさないので帳票には記録しない。
  // 在庫が動くのは shipSalesOrder (出荷) のときだけで、記録は売上登録と同じ「売上出庫」になる。
  // 画面と同じ salesOrderValidationError で弾くので、画面に出るエラーと実際の拒否条件がずれない。

  const addSalesOrder = useCallback((data: SalesOrderInput) => {
    if (salesOrderValidationError(data, products, customers)) return;
    setSalesOrders(prev => {
      const now = new Date().toISOString();
      const next = [...prev, { ...data, id: crypto.randomUUID(), shippedQuantity: 0, createdAt: now, updatedAt: now }];
      saveSalesOrders(next); return next;
    });
  }, [customers, products]);

  // 出荷実績 (shippedQuantity) は編集対象外。キャンセル済みの受注は編集しない
  const updateSalesOrder = useCallback((id: string, data: SalesOrderInput) => {
    if (salesOrderValidationError(data, products, customers)) return;
    setSalesOrders(prev => {
      if (!prev.some(o => o.id === id && !o.canceledAt)) return prev;
      const next = prev.map(o => o.id === id ? { ...o, ...data, updatedAt: new Date().toISOString() } : o);
      saveSalesOrders(next); return next;
    });
  }, [customers, products]);

  // キャンセルは受注を消さずに残す (出荷済みの分は売上として帳票にそのまま残るため)
  const cancelSalesOrder = useCallback((id: string) => {
    setSalesOrders(prev => {
      if (!prev.some(o => o.id === id && !o.canceledAt)) return prev;
      const now = new Date().toISOString();
      const next = prev.map(o => o.id === id ? { ...o, canceledAt: now, updatedAt: now } : o);
      saveSalesOrders(next); return next;
    });
  }, []);

  const deleteSalesOrder = useCallback((id: string) => {
    setSalesOrders(prev => {
      const next = prev.filter(o => o.id !== id);
      saveSalesOrders(next); return next;
    });
  }, []);

  /**
   * 受注にもとづく出荷。引当先の決定は planSalesOrderShipment (純粋関数) に任せ、在庫の反映と帳票への記録は
   * shipFefo に任せる (区分は 売上出庫、実売単価と得意先は受注のもの)。ここでは出荷済数量の更新だけを足す。
   * 在庫が足りなければ引けた分だけ出荷する。1つも引けない・受注残がない場合は何もしない (null を返す)。
   */
  const shipSalesOrder = useCallback((id: string, input: ShipOrderInput): ShipOrderResult | null => {
    const order = salesOrders.find(o => o.id === id);
    if (!order || order.canceledAt) return null;
    const product = products.find(p => p.id === order.productId);
    if (!product || isMaterial(product)) return null;

    const preview = planSalesOrderShipment(order, product, input);
    if (preview.allocated <= 0) return null;

    const plan = shipFefo(product.id, preview.allocated + preview.shortage, {
      warehouseId: order.warehouseId || undefined,
      includeExpired: input.includeExpired,
      type: '売上出庫',
      note: input.note?.trim() || salesOrderShipmentNote(customerName(customers, order.customerId)),
      unitPrice: order.unitPrice,
      customerId: order.customerId,
    });

    setSalesOrders(prev => {
      const next = prev.map(o => o.id === id
        ? { ...o, shippedQuantity: o.shippedQuantity + plan.allocated, updatedAt: new Date().toISOString() }
        : o);
      saveSalesOrders(next); return next;
    });

    return { plan, remaining: remainingShipment(order) - plan.allocated };
  }, [customers, products, salesOrders, shipFefo]);

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

  const exportExcel = useCallback(async (): Promise<void> => {
    // 押した時点の在庫を書き出すので、xlsx の読み込みを待つ前に行を組み立てておく
    const wsData: (string | number)[][] = [['SKU', 'ロットNo', '在庫数']];
    for (const p of products) {
      for (const l of p.lots) {
        wsData.push([p.sku, l.lotNo, l.quantity]);
      }
    }
    const XLSX = await loadXlsx();
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

  const importExcel = useCallback(async (file: File): Promise<{ updated: number; errors: string[] }> => {
    const XLSX = await loadXlsx();
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

  // ロットだけでなく、入荷先に指定されている入荷予定 (未入荷・一部入荷) や
  // 出荷元に指定されている受注 (未出荷・一部出荷) が残っていても削除しない
  const deleteWarehouse = useCallback((id: string) => {
    const inUse = products.some(p => p.lots.some(l => l.warehouseId === id))
      || inboundPlans.some(p => p.warehouseId === id && remainingInbound(p) > 0)
      || salesOrders.some(o => o.warehouseId === id && remainingShipment(o) > 0);
    if (inUse) return;
    setWarehouses(prev => {
      const next = prev.filter(w => w.id !== id);
      saveWarehouses(next); return next;
    });
  }, [inboundPlans, products, salesOrders]);

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

  // 売上の記録や受注から参照されている得意先は削除しない (過去の売上・受注の得意先が消えてしまうため)。
  // 取引が終わっただけなら削除ではなく active=false にしてもらう (仕入先と同じ)
  const deleteCustomer = useCallback((id: string) => {
    if (ledger.some(t => t.type === '売上出庫' && t.customerId === id)) return;
    if (salesOrders.some(o => o.customerId === id)) return;
    // 入金の記録 (未消込の前受を含む) がある得意先も、入金履歴の宛先が消えるので削除しない
    if (paymentItems.some(p => p.customerId === id)) return;
    setCustomers(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCustomers(next); return next;
    });
  }, [ledger, salesOrders, paymentItems]);

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
    // 受注は商品と得意先を参照するので、どちらも入れ替えたあとに戻す
    const freshOrders: SalesOrder[] = JSON.parse(JSON.stringify(SAMPLE_SALES_ORDERS));
    setSalesOrders(freshOrders);
    saveSalesOrders(freshOrders);
    // 納品書・請求書は帳票の売上を参照していて、帳票を空に戻すと宙に浮くので一緒に空にする
    setSalesDocumentItems([]);
    saveSalesDocumentItems([]);
    // 入金は請求書を参照しているので、請求書と一緒に空にする
    setPaymentItems([]);
    savePaymentItems([]);
  }, []);

  /**
   * 納品書・請求書を発行する (SalesDocumentModal の「発行して印刷」、締め請求の ClosingModal から)。
   * issueSalesDocuments は複数枚を1回の状態更新・1回の保存でまとめて発行し、発行できた書類を返す。
   * 発行内容のスナップショットを salesDocumentItems に追加するだけで、在庫も帳票も動かさない。
   * 一度載せた売上は同じ種類の書類にもう載せられない (salesDocumentValidationError)。
   * 発行できなかったときは null、発行したときは書類を返す。
   */
  const issueSalesDocuments = useCallback((inputs: IssueSalesDocumentInput[]): SalesDocument[] => {
    // 呼び出し側の候補が古くても二重発行しないよう、保存直前の発行状況で付け直してから検証する。
    // 繰越型の請求書の繰越も保存直前の請求書・入金で計算し直す
    const { created, docs } = prepareSalesDocuments(
      inputs, salesDocumentItems, paymentItems, () => crypto.randomUUID(), new Date().toISOString(),
    );
    if (created.length === 0) return [];
    const next = [...salesDocumentItems, ...created];
    setSalesDocumentItems(next);
    saveSalesDocumentItems(next);
    return docs;
  }, [salesDocumentItems, paymentItems]);

  const issueSalesDocument = useCallback(
    (input: IssueSalesDocumentInput): SalesDocument | null => issueSalesDocuments([input])[0] ?? null,
    [issueSalesDocuments],
  );

  /**
   * 発行した書類を取り消す。載っていた売上はふたたび同じ種類の書類に載せられるようになる。
   * 入金を充てた請求書は取り消せない (入金の消込先が消えるため)。先に入金を削除してもらう。
   * 取り消したら true。
   */
  const deleteSalesDocument = useCallback((documentId: string): boolean => {
    if (paymentItems.some(p => p.documentId === documentId)) return false;
    setSalesDocumentItems(prev => {
      const next = prev.filter(i => i.documentId !== documentId);
      saveSalesDocumentItems(next); return next;
    });
    return true;
  }, [paymentItems]);

  /**
   * 入金を登録する (入金管理タブの入金登録モーダルから)。選んだ請求書にお支払期限の早い順で充て、
   * 充てきれない分は未消込として残す。在庫も帳票も動かさない。
   * 計画は保存直前の請求書・入金で組み立て直すので、モーダルを開いたあとに別の入金を登録していても
   * 請求額を超えて消し込むことはない。登録できなかったときは null。
   */
  const recordPayment = useCallback((input: PaymentInput): PaymentPlan | null => {
    const plan = planPayment(receivableRows(salesDocumentItems, paymentItems), input);
    if (plan.error) return null;
    const created = buildPaymentItems(plan, input, crypto.randomUUID(), new Date().toISOString());
    const next = [...paymentItems, ...created];
    setPaymentItems(next);
    savePaymentItems(next);
    return plan;
  }, [salesDocumentItems, paymentItems]);

  /** 入金を削除する (1回の入金をまとめて)。充てていた請求書の残高は元に戻る */
  const deletePayment = useCallback((receiptId: string) => {
    setPaymentItems(prev => {
      const next = prev.filter(p => p.receiptId !== receiptId);
      savePaymentItems(next); return next;
    });
  }, []);

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, shipFefo, disposeLots, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, addWarehouse, updateWarehouse, deleteWarehouse, moveLot, categories, addCategory, updateCategory, deleteCategory, applyStocktake, applyMinQuantities, inboundPlans, addInboundPlan, addInboundPlans, updateInboundPlan, cancelInboundPlan, deleteInboundPlan, receiveInboundPlan, suppliers, addSupplier, updateSupplier, deleteSupplier, purchaseOrderPrints, printPurchaseOrder, customers, addCustomer, updateCustomer, deleteCustomer, recordSale, salesOrders, addSalesOrder, updateSalesOrder, cancelSalesOrder, deleteSalesOrder, shipSalesOrder, salesDocumentItems, issueSalesDocument, issueSalesDocuments, deleteSalesDocument, returnSale, returnToSupplier, paymentItems, recordPayment, deletePayment };
}
