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

export const INBOUND_TYPES: TransactionType[] = ['入荷', '調整入庫'];
export const OUTBOUND_TYPES: TransactionType[] = ['売上出庫', '調整出庫', '廃棄'];

export function transactionDirection(type: TransactionType): 'in' | 'out' | 'move' {
  if (INBOUND_TYPES.includes(type)) return 'in';
  if (OUTBOUND_TYPES.includes(type)) return 'out';
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

  const addTransaction = useCallback((txn: Omit<StockTransaction, 'id' | 'date'>) => {
    setLedger(prev => {
      const next = [{ ...txn, id: crypto.randomUUID(), date: new Date().toISOString() }, ...prev];
      saveLedger(next);
      return next;
    });
  }, []);

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
    setProducts(prev => { const next = prev.filter(p => p.id !== id); save(next); return next; });
  }, []);

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

  const updateLot = useCallback((productId: string, lotId: string, lot: Omit<Lot, 'id'>) => {
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.map(l => l.id === lotId ? { ...lot, id: lotId } : l), updatedAt: new Date().toISOString() }
        : p);
      save(next); return next;
    });
  }, []);

  const deleteLot = useCallback((productId: string, lotId: string) => {
    setProducts(prev => {
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.filter(l => l.id !== lotId), updatedAt: new Date().toISOString() }
        : p);
      save(next); return next;
    });
  }, []);

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
      addTransaction({
        type: type ?? (actualDelta > 0 ? '調整入庫' : '調整出庫'),
        productId,
        productName: product.name,
        productSku: product.sku,
        lotNo: lot.lotNo,
        quantity: Math.abs(actualDelta),
        note: '',
      });
    }
  }, [addTransaction, products]);

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
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, exportCsv, exportExcel, importExcel, resetToSample, ledger, warehouses, addWarehouse, updateWarehouse, deleteWarehouse, moveLot, categories, addCategory, updateCategory, deleteCategory };
}
