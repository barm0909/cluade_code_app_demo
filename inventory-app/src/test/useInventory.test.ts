import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInventory } from '../useInventory';

// localStorage モック
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => { localStorageMock.clear(); });

describe('useInventory — 商品操作', () => {
  it('初回ロード時にサンプルデータが入る', () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.products.length).toBeGreaterThan(0);
  });

  it('addProduct で商品が追加される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.products.length;

    act(() => {
      result.current.addProduct({ name: 'テスト商品', sku: 'T-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });

    expect(result.current.products.length).toBe(before + 1);
    expect(result.current.products.at(-1)?.name).toBe('テスト商品');
  });

  it('updateProduct で商品名が更新される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '旧名前', sku: 'T-002', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const target = result.current.products.find(p => p.sku === 'T-002')!;

    act(() => {
      result.current.updateProduct(target.id, { ...target, name: '新名前' });
    });

    expect(result.current.products.find(p => p.id === target.id)?.name).toBe('新名前');
  });

  it('deleteProduct で商品が削除される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '削除対象', sku: 'T-DEL', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const target = result.current.products.find(p => p.sku === 'T-DEL')!;

    act(() => { result.current.deleteProduct(target.id); });

    expect(result.current.products.find(p => p.id === target.id)).toBeUndefined();
  });

  it('LocalStorage に保存され、再ロードしても残る', () => {
    const { result: r1 } = renderHook(() => useInventory());
    act(() => {
      r1.current.addProduct({ name: '永続テスト', sku: 'T-PER', category: '食品', minQuantity: 1, price: 50, lots: [] });
    });

    const { result: r2 } = renderHook(() => useInventory());
    expect(r2.current.products.some(p => p.sku === 'T-PER')).toBe(true);
  });
});

describe('useInventory — ロット操作', () => {
  it('addLot でロットが追加される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'ロットテスト', sku: 'L-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'L-001')!;

    act(() => {
      result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 });
    });

    const updated = result.current.products.find(p => p.id === product.id)!;
    expect(updated.lots).toHaveLength(1);
    expect(updated.lots[0].lotNo).toBe('20261231');
    expect(updated.lots[0].quantity).toBe(10);
  });

  it('adjustLotQuantity でロット在庫が増減する', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'qty test', sku: 'Q-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'Q-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    act(() => { result.current.adjustLotQuantity(product.id, lot.id, 3); });
    expect(result.current.products.find(p => p.id === product.id)!.lots[0].quantity).toBe(8);

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, -100); });
    expect(result.current.products.find(p => p.id === product.id)!.lots[0].quantity).toBe(0);
  });

  it('deleteLot でロットが削除される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'del lot', sku: 'D-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'D-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    act(() => { result.current.deleteLot(product.id, lot.id); });

    expect(result.current.products.find(p => p.id === product.id)!.lots).toHaveLength(0);
  });

  it('updateLot でロット情報が更新される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'update lot', sku: 'U-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'U-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20270101', quantity: 20 }); });

    const updated = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(updated.lotNo).toBe('20270101');
    expect(updated.quantity).toBe(20);
  });
});

describe('useInventory — ledger（入出庫記録）', () => {
  it('addLot でledgerに入庫トランザクションが追加される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'ledger test', sku: 'LED-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'LED-001')!;
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 }); });

    expect(result.current.ledger.length).toBe(beforeCount + 1);
    expect(result.current.ledger[0].type).toBe('入庫');
    expect(result.current.ledger[0].quantity).toBe(10);
    expect(result.current.ledger[0].lotNo).toBe('20261231');
  });

  it('adjustLotQuantity でdelta > 0のとき入庫、delta < 0のとき出庫が記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'adj ledger', sku: 'ADJ-001', category: '食品', minQuantity: 5, price: 100, lots: [] });
    });
    const product = result.current.products.find(p => p.sku === 'ADJ-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, 5); });
    expect(result.current.ledger[0].type).toBe('入庫');
    expect(result.current.ledger[0].quantity).toBe(5);

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, -3); });
    expect(result.current.ledger[0].type).toBe('出庫');
    expect(result.current.ledger[0].quantity).toBe(3);
  });
});

describe('useInventory — resetToSample', () => {
  it('resetToSample でサンプルデータに戻る', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '追加商品', sku: 'EXTRA-001', category: '食品', minQuantity: 1, price: 50, lots: [] });
    });
    expect(result.current.products.some(p => p.sku === 'EXTRA-001')).toBe(true);

    act(() => { result.current.resetToSample(); });

    expect(result.current.products.some(p => p.sku === 'EXTRA-001')).toBe(false);
    expect(result.current.products.length).toBeGreaterThan(0);
  });

  it('resetToSample でledgerが空になる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'l test', sku: 'LT-001', category: '食品', minQuantity: 1, price: 50, lots: [] });
    });
    const p = result.current.products.find(pr => pr.sku === 'LT-001')!;
    act(() => { result.current.addLot(p.id, { lotNo: '20261231', quantity: 1 }); });
    expect(result.current.ledger.length).toBeGreaterThan(0);

    act(() => { result.current.resetToSample(); });

    expect(result.current.ledger).toHaveLength(0);
  });
});
