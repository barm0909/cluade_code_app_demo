import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInventory, totalQuantityByWarehouse, DEFAULT_WAREHOUSE_ID } from '../useInventory';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => { localStorageMock.clear(); });

// ────────────────────────────────────────────────────────────
// 倉庫 CRUD
// ────────────────────────────────────────────────────────────
describe('useInventory — 倉庫管理', () => {
  it('初回ロード時にデフォルト倉庫3つが存在する', () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.warehouses.length).toBe(3);
    const names = result.current.warehouses.map(w => w.name);
    expect(names).toContain('販売倉庫');
    expect(names).toContain('保留倉庫');
    expect(names).toContain('不良倉庫');
  });

  it('addWarehouse で新しい倉庫が追加される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.warehouses.length;

    act(() => { result.current.addWarehouse('テスト倉庫', '#aabbcc'); });

    expect(result.current.warehouses.length).toBe(before + 1);
    const added = result.current.warehouses.find(w => w.name === 'テスト倉庫');
    expect(added).toBeDefined();
    expect(added?.color).toBe('#aabbcc');
  });

  it('updateWarehouse で倉庫名とカラーが更新される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addWarehouse('旧倉庫', '#111111'); });
    const target = result.current.warehouses.find(w => w.name === '旧倉庫')!;

    act(() => { result.current.updateWarehouse(target.id, '新倉庫', '#222222'); });

    const updated = result.current.warehouses.find(w => w.id === target.id);
    expect(updated?.name).toBe('新倉庫');
    expect(updated?.color).toBe('#222222');
  });

  it('deleteWarehouse でロットが参照していない倉庫を削除できる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addWarehouse('削除倉庫', '#ff0000'); });
    const target = result.current.warehouses.find(w => w.name === '削除倉庫')!;

    act(() => { result.current.deleteWarehouse(target.id); });

    expect(result.current.warehouses.find(w => w.id === target.id)).toBeUndefined();
  });

  it('ロットが参照する倉庫は deleteWarehouse できない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addWarehouse('使用中倉庫', '#00ff00'); });
    const wh = result.current.warehouses.find(w => w.name === '使用中倉庫')!;

    act(() => {
      result.current.addProduct({ name: '参照テスト品', sku: 'WH-REF', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'WH-REF')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5, warehouseId: wh.id }); });

    act(() => { result.current.deleteWarehouse(wh.id); });

    // 削除されていないことを確認
    expect(result.current.warehouses.find(w => w.id === wh.id)).toBeDefined();
  });

  it('倉庫はlocalStorageに永続化され再ロード後も残る', () => {
    const { result: r1 } = renderHook(() => useInventory());
    act(() => { r1.current.addWarehouse('永続倉庫', '#123456'); });

    const { result: r2 } = renderHook(() => useInventory());
    expect(r2.current.warehouses.some(w => w.name === '永続倉庫')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// ロットへの倉庫割り当て
// ────────────────────────────────────────────────────────────
describe('useInventory — ロット倉庫割り当て', () => {
  it('addLot に warehouseId を指定するとロットに設定される', () => {
    const { result } = renderHook(() => useInventory());

    const holdWh = result.current.warehouses.find(w => w.name === '保留倉庫')!;
    act(() => {
      result.current.addProduct({ name: 'wh test', sku: 'WT-001', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'WT-001')!;

    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10, warehouseId: holdWh.id }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(lot.warehouseId).toBe(holdWh.id);
  });

  it('addLot で warehouseId を省略するとデフォルト倉庫（販売倉庫）になる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'default wh', sku: 'DW-001', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'DW-001')!;

    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(lot.warehouseId).toBe(DEFAULT_WAREHOUSE_ID);
  });
});

// ────────────────────────────────────────────────────────────
// moveLot
// ────────────────────────────────────────────────────────────
describe('useInventory — moveLot', () => {
  function setupProduct() {
    const { result } = renderHook(() => useInventory());
    const salesWh = result.current.warehouses.find(w => w.name === '販売倉庫')!;
    const holdWh = result.current.warehouses.find(w => w.name === '保留倉庫')!;

    act(() => {
      result.current.addProduct({ name: 'move test', sku: 'MV-001', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'MV-001')!;
    act(() => {
      result.current.addLot(product.id, { lotNo: '20261231', quantity: 10, warehouseId: salesWh.id });
    });

    return { result, salesWh, holdWh };
  }

  it('全量移動するとロットの warehouseId が更新される', () => {
    const { result, holdWh } = setupProduct();
    const product = result.current.products.find(p => p.sku === 'MV-001')!;
    const lot = product.lots[0];

    act(() => { result.current.moveLot(product.id, lot.id, holdWh.id, 10); });

    const updatedLot = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(updatedLot.warehouseId).toBe(holdWh.id);
    expect(updatedLot.quantity).toBe(10);
  });

  it('部分移動すると元ロットが減り新ロットが別倉庫に作られる', () => {
    const { result, holdWh } = setupProduct();
    const product = result.current.products.find(p => p.sku === 'MV-001')!;
    const lot = product.lots[0];

    act(() => { result.current.moveLot(product.id, lot.id, holdWh.id, 4); });

    const updatedProduct = result.current.products.find(p => p.id === product.id)!;
    expect(updatedProduct.lots).toHaveLength(2);

    const srcLot = updatedProduct.lots.find(l => l.id === lot.id)!;
    expect(srcLot.quantity).toBe(6);

    const newLot = updatedProduct.lots.find(l => l.id !== lot.id)!;
    expect(newLot.quantity).toBe(4);
    expect(newLot.warehouseId).toBe(holdWh.id);
    expect(newLot.lotNo).toBe(lot.lotNo);
  });

  it('moveLot で移動トランザクションが2件（出庫・入庫）記録される', () => {
    const { result, holdWh } = setupProduct();
    const product = result.current.products.find(p => p.sku === 'MV-001')!;
    const lot = product.lots[0];
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.moveLot(product.id, lot.id, holdWh.id, 3); });

    // 出庫（元倉庫）+ 入庫（先倉庫）= 2件
    expect(result.current.ledger.length).toBe(beforeCount + 2);
    const txns = result.current.ledger.slice(0, 2);
    const types = txns.map(t => t.type);
    expect(types).toContain('出庫');
    expect(types).toContain('入庫');
  });

  it('元ロット在庫より多い数量を移動しようとすると全量が移動される', () => {
    const { result, holdWh } = setupProduct();
    const product = result.current.products.find(p => p.sku === 'MV-001')!;
    const lot = product.lots[0];

    act(() => { result.current.moveLot(product.id, lot.id, holdWh.id, 999); });

    const updatedLot = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(updatedLot.quantity).toBe(10);
    expect(updatedLot.warehouseId).toBe(holdWh.id);
  });
});

// ────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────
describe('totalQuantityByWarehouse', () => {
  it('指定倉庫のロットの合計在庫数を返す', () => {
    const { result } = renderHook(() => useInventory());
    const salesWh = result.current.warehouses.find(w => w.name === '販売倉庫')!;
    const holdWh = result.current.warehouses.find(w => w.name === '保留倉庫')!;

    act(() => {
      result.current.addProduct({ name: 'qty wh test', sku: 'QW-001', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'QW-001')!;

    act(() => {
      result.current.addLot(product.id, { lotNo: '20261201', quantity: 8, warehouseId: salesWh.id });
      result.current.addLot(product.id, { lotNo: '20261202', quantity: 3, warehouseId: holdWh.id });
      result.current.addLot(product.id, { lotNo: '20261203', quantity: 5, warehouseId: salesWh.id });
    });

    const updated = result.current.products.find(p => p.id === product.id)!;
    expect(totalQuantityByWarehouse(updated, salesWh.id)).toBe(13);
    expect(totalQuantityByWarehouse(updated, holdWh.id)).toBe(3);
  });

  it('ロットが存在しない倉庫は0を返す', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'empty wh', sku: 'EW-001', category: '食品', minQuantity: 1, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'EW-001')!;

    expect(totalQuantityByWarehouse(product, 'nonexistent-id')).toBe(0);
  });
});
