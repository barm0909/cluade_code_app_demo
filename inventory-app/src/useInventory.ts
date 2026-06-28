import { useState, useCallback } from 'react';

export interface Lot {
  id: string;
  lotNo: string;
  expiryDate?: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  lots: Lot[];
  minQuantity: number;
  price: number;
  costPrice: number;
  updatedAt: string;
}

export type TransactionType = '入庫' | '出庫';

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
}

export type SortField = 'name' | 'sku' | 'category' | 'price' | 'costPrice';
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

export function generateLotNo(expiryDate?: string): string {
  if (expiryDate) return expiryDate.replace(/-/g, '');
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

const STORAGE_KEY = 'inventory_products_v2';
const LEDGER_KEY = 'inventory_ledger_v1';

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const SAMPLE_DATA: Product[] = [
  {
    id: '1', name: '牛乳', sku: 'ML-001', category: '乳製品', minQuantity: 5, price: 198, costPrice: 130,
    lots: [
      { id: 'l1', lotNo: d(3).replace(/-/g, ''), expiryDate: d(3), quantity: 10 },
      { id: 'l2', lotNo: d(7).replace(/-/g, ''), expiryDate: d(7), quantity: 10 },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2', name: '食パン', sku: 'BR-001', category: 'パン', minQuantity: 5, price: 150, costPrice: 90,
    lots: [
      { id: 'l3', lotNo: d(1).replace(/-/g, ''), expiryDate: d(1), quantity: 3 },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3', name: '値札ラベル(赤)', sku: 'LB-R01', category: 'ラベル', minQuantity: 100, price: 5, costPrice: 2,
    lots: [
      { id: 'l4', lotNo: '20260101', quantity: 500 },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4', name: 'チーズ', sku: 'CS-001', category: '乳製品', minQuantity: 4, price: 350, costPrice: 220,
    lots: [
      { id: 'l5', lotNo: d(-2).replace(/-/g, ''), expiryDate: d(-2), quantity: 2 },
      { id: 'l6', lotNo: d(14).replace(/-/g, ''), expiryDate: d(14), quantity: 4 },
    ],
    updatedAt: new Date().toISOString(),
  },
];

function load(): Product[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE_DATA));
  return SAMPLE_DATA;
}

function save(products: Product[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function loadLedger(): StockTransaction[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveLedger(txns: StockTransaction[]) {
  localStorage.setItem(LEDGER_KEY, JSON.stringify(txns));
}

export function useInventory() {
  const [products, setProducts] = useState<Product[]>(load);
  const [ledger, setLedger] = useState<StockTransaction[]>(loadLedger);

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

  const addLot = useCallback((productId: string, lot: Omit<Lot, 'id'>) => {
    setProducts(prev => {
      const product = prev.find(p => p.id === productId);
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: [...p.lots, { ...lot, id: crypto.randomUUID() }], updatedAt: new Date().toISOString() }
        : p);
      save(next);
      if (product && lot.quantity > 0) {
        addTransaction({ type: '入庫', productId, productName: product.name, productSku: product.sku, lotNo: lot.lotNo, quantity: lot.quantity, note: 'ロット追加' });
      }
      return next;
    });
  }, [addTransaction]);

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

  const adjustLotQuantity = useCallback((productId: string, lotId: string, delta: number) => {
    setProducts(prev => {
      const product = prev.find(p => p.id === productId);
      const lot = product?.lots.find(l => l.id === lotId);
      const actualDelta = lot ? (delta > 0 ? delta : -Math.min(-delta, lot.quantity)) : 0;
      const next = prev.map(p => p.id === productId
        ? { ...p, lots: p.lots.map(l => l.id === lotId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l), updatedAt: new Date().toISOString() }
        : p);
      save(next);
      if (product && lot && actualDelta !== 0) {
        addTransaction({
          type: actualDelta > 0 ? '入庫' : '出庫',
          productId,
          productName: product.name,
          productSku: product.sku,
          lotNo: lot.lotNo,
          quantity: Math.abs(actualDelta),
          note: '',
        });
      }
      return next;
    });
  }, [addTransaction]);

  const exportCsv = useCallback(() => {
    const header = '商品名,SKU,カテゴリ,販売定価,原価,ロットNo,賞味期限,在庫数';
    const rows = products.flatMap(p =>
      p.lots.length > 0
        ? p.lots.map(l => [p.name, p.sku, p.category, p.price, p.costPrice, l.lotNo, l.expiryDate ?? '', l.quantity].join(','))
        : [[p.name, p.sku, p.category, p.price, p.costPrice, '', '', 0].join(',')]
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [products]);

  const resetToSample = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEDGER_KEY);
    const fresh = JSON.parse(JSON.stringify(SAMPLE_DATA));
    update(fresh);
    setLedger([]);
    saveLedger([]);
  }, []);

  return { products, addProduct, updateProduct, deleteProduct, addLot, updateLot, deleteLot, adjustLotQuantity, exportCsv, resetToSample, ledger };
}
