import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DEFAULT_WAREHOUSE_ID, useInventory, type StockTransaction } from '../useInventory';
import { stubApi } from './mockApi';

// fetch モックなし = API に到達できない環境として、メモリ内のサンプルデータで動作する。
// 永続化を検証するテストだけ stubApi() で /api/* を模倣する。
afterEach(() => { vi.unstubAllGlobals(); });

describe('useInventory — 商品操作', () => {
  it('初回ロード時にサンプルデータが入る', () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.products.length).toBeGreaterThan(0);
  });

  it('addProduct で商品が追加される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.products.length;

    act(() => {
      result.current.addProduct({ name: 'テスト商品', sku: 'T-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });

    expect(result.current.products.length).toBe(before + 1);
    expect(result.current.products.at(-1)?.name).toBe('テスト商品');
  });

  it('updateProduct で商品名が更新される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '旧名前', sku: 'T-002', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const target = result.current.products.find(p => p.sku === 'T-002')!;

    act(() => {
      result.current.updateProduct(target.id, { ...target, name: '新名前' });
    });

    expect(result.current.products.find(p => p.id === target.id)?.name).toBe('新名前');
  });

  it('addProduct/updateProduct でJANコードが保存・更新される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'JANテスト', sku: 'T-JAN', janCode: '4901234567894', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const added = result.current.products.find(p => p.sku === 'T-JAN')!;
    expect(added.janCode).toBe('4901234567894');

    act(() => {
      result.current.updateProduct(added.id, { ...added, janCode: '49123456' });
    });
    expect(result.current.products.find(p => p.id === added.id)?.janCode).toBe('49123456');
  });

  it('deleteProduct で商品が削除される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '削除対象', sku: 'T-DEL', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const target = result.current.products.find(p => p.sku === 'T-DEL')!;

    act(() => { result.current.deleteProduct(target.id); });

    expect(result.current.products.find(p => p.id === target.id)).toBeUndefined();
  });

  it('API (D1) に保存され、再ロードしても残る', async () => {
    const server = stubApi();
    const { result: r1, unmount } = renderHook(() => useInventory());
    // サーバー状態 (空) でのハイドレーション完了を待ってから操作する
    await waitFor(() => expect(r1.current.products).toHaveLength(0));

    act(() => {
      r1.current.addProduct({ name: '永続テスト', sku: 'T-PER', categoryId: 'cat-food', minQuantity: 1, price: 50, costPrice: 50 });
    });
    await waitFor(() => expect(server.products.some(p => p.sku === 'T-PER')).toBe(true));
    unmount();

    const { result: r2 } = renderHook(() => useInventory());
    await waitFor(() => expect(r2.current.products.some(p => p.sku === 'T-PER')).toBe(true));
  });
});

describe('useInventory — ロット操作', () => {
  it('addLot でロットが追加される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'ロットテスト', sku: 'L-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
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
      result.current.addProduct({ name: 'qty test', sku: 'Q-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
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
      result.current.addProduct({ name: 'del lot', sku: 'D-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
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
      result.current.addProduct({ name: 'update lot', sku: 'U-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'U-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });

    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20270101', quantity: 20, warehouseId: lot.warehouseId }); });

    const updated = result.current.products.find(p => p.id === product.id)!.lots[0];
    expect(updated.lotNo).toBe('20270101');
    expect(updated.quantity).toBe(20);
  });
});

describe('useInventory — ledger（入出庫記録）', () => {
  it('addLot でledgerに入荷トランザクションが追加される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'ledger test', sku: 'LED-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'LED-001')!;
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 }); });

    expect(result.current.ledger.length).toBe(beforeCount + 1);
    expect(result.current.ledger[0].type).toBe('入荷');
    expect(result.current.ledger[0].quantity).toBe(10);
    expect(result.current.ledger[0].lotNo).toBe('20261231');
  });

  it('adjustLotQuantity でdelta > 0のとき調整入庫、delta < 0のとき調整出庫が記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'adj ledger', sku: 'ADJ-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'ADJ-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, 5); });
    expect(result.current.ledger[0].type).toBe('調整入庫');
    expect(result.current.ledger[0].quantity).toBe(5);

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, -3); });
    expect(result.current.ledger[0].type).toBe('調整出庫');
    expect(result.current.ledger[0].quantity).toBe(3);
  });

  it('adjustLotQuantity で区分を指定すると売上出庫・廃棄として記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'type ledger', sku: 'TYP-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'TYP-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 10 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, -2, '売上出庫'); });
    expect(result.current.ledger[0].type).toBe('売上出庫');
    expect(result.current.ledger[0].quantity).toBe(2);

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, -1, '廃棄'); });
    expect(result.current.ledger[0].type).toBe('廃棄');
    expect(result.current.ledger[0].quantity).toBe(1);

    act(() => { result.current.adjustLotQuantity(product.id, lot.id, 4, '入荷'); });
    expect(result.current.ledger[0].type).toBe('入荷');
    expect(result.current.ledger[0].quantity).toBe(4);
  });

  it('deleteLot で残っていた在庫が調整出庫として記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'del ledger', sku: 'DL-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'DL-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 7, warehouseId: 'wh-hold' }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.deleteLot(product.id, lot.id); });

    expect(result.current.ledger.length).toBe(beforeCount + 1);
    expect(result.current.ledger[0].type).toBe('調整出庫');
    expect(result.current.ledger[0].quantity).toBe(7);
    expect(result.current.ledger[0].lotNo).toBe('20261231');
    expect(result.current.ledger[0].note).toBe('ロット削除');
    expect(result.current.ledger[0].fromWarehouseId).toBe('wh-hold');
  });

  it('在庫0のロットを削除しても帳票には何も記録されない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'zero lot', sku: 'DL-002', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'DL-002')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 0 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.deleteLot(product.id, lot.id); });

    expect(result.current.ledger.length).toBe(beforeCount);
  });

  it('deleteProduct で在庫の残る全ロットが調整出庫として記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'del product ledger', sku: 'DP-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'DP-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 4 }); });
    act(() => { result.current.addLot(product.id, { lotNo: '20270101', quantity: 6, warehouseId: 'wh-hold' }); });
    act(() => { result.current.addLot(product.id, { lotNo: '20270202', quantity: 0 }); });
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.deleteProduct(product.id); });

    // 在庫0のロットは記録しないので2件
    expect(result.current.ledger.length).toBe(beforeCount + 2);
    const recorded = result.current.ledger.slice(0, 2);
    expect(recorded.every(t => t.type === '調整出庫' && t.note === '商品削除')).toBe(true);
    expect(recorded.map(t => [t.lotNo, t.quantity, t.fromWarehouseId])).toEqual([
      ['20261231', 4, 'wh-sales'],
      ['20270101', 6, 'wh-hold'],
    ]);
  });

  it('updateLot で数量を変えると差分が調整入庫・調整出庫として記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'upd ledger', sku: 'UL-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'UL-001')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];

    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20261231', quantity: 12, warehouseId: lot.warehouseId }); });
    expect(result.current.ledger[0].type).toBe('調整入庫');
    expect(result.current.ledger[0].quantity).toBe(7);
    expect(result.current.ledger[0].note).toBe('ロット編集');
    expect(result.current.ledger[0].toWarehouseId).toBe('wh-sales');

    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20261231', quantity: 2, warehouseId: lot.warehouseId }); });
    expect(result.current.ledger[0].type).toBe('調整出庫');
    expect(result.current.ledger[0].quantity).toBe(10);
    expect(result.current.ledger[0].fromWarehouseId).toBe('wh-sales');
  });

  it('updateLot で倉庫だけ変えると移動として記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'upd wh', sku: 'UL-002', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'UL-002')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20261231', quantity: 5, warehouseId: 'wh-defect' }); });

    expect(result.current.ledger.length).toBe(beforeCount + 1);
    expect(result.current.ledger[0].type).toBe('移動');
    expect(result.current.ledger[0].quantity).toBe(5);
    expect(result.current.ledger[0].fromWarehouseId).toBe('wh-sales');
    expect(result.current.ledger[0].toWarehouseId).toBe('wh-defect');
  });

  it('updateLot で数量と倉庫を同時に変えると移動と数量調整の2件が記録される', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'upd both', sku: 'UL-003', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'UL-003')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    const beforeCount = result.current.ledger.length;

    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20261231', quantity: 8, warehouseId: 'wh-hold' }); });

    expect(result.current.ledger.length).toBe(beforeCount + 2);
    // 移動は編集前の数量、数量調整は移動後の倉庫に付く
    const [move, adjust] = result.current.ledger;
    expect([move.type, move.quantity, move.fromWarehouseId, move.toWarehouseId]).toEqual(['移動', 5, 'wh-sales', 'wh-hold']);
    expect([adjust.type, adjust.quantity, adjust.toWarehouseId]).toEqual(['調整入庫', 3, 'wh-hold']);
  });

  it('updateLot で数量も倉庫も変わらなければ帳票には記録されない', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'upd noop', sku: 'UL-004', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 50 });
    });
    const product = result.current.products.find(p => p.sku === 'UL-004')!;
    act(() => { result.current.addLot(product.id, { lotNo: '20261231', quantity: 5 }); });
    const lot = result.current.products.find(p => p.id === product.id)!.lots[0];
    const beforeCount = result.current.ledger.length;

    // 賞味期限とロットNo だけの変更は在庫を動かさない
    act(() => { result.current.updateLot(product.id, lot.id, { lotNo: '20270303', expiryDate: '2027-03-03', quantity: 5, warehouseId: lot.warehouseId }); });

    expect(result.current.ledger.length).toBe(beforeCount);
    expect(result.current.products.find(p => p.id === product.id)!.lots[0].lotNo).toBe('20270303');
  });

  it('旧区分（入庫/出庫）の帳票データはロード時に新区分へ移行される', async () => {
    const legacy = [
      { id: 't1', date: '2026-01-01T00:00:00Z', type: '入庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'L1', quantity: 5, note: 'ロット追加' },
      { id: 't2', date: '2026-01-02T00:00:00Z', type: '入庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'L1', quantity: 2, note: '' },
      { id: 't3', date: '2026-01-03T00:00:00Z', type: '出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'L1', quantity: 1, note: '' },
      { id: 't4', date: '2026-01-04T00:00:00Z', type: '出庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'L1', quantity: 3, note: '倉庫移動', fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold' },
      { id: 't5', date: '2026-01-04T00:00:00Z', type: '入庫', productId: 'p1', productName: '牛乳', productSku: 'ML-001', lotNo: 'L1', quantity: 3, note: '倉庫移動', fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold' },
    ] as unknown as StockTransaction[];
    stubApi({ ledger: legacy });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.ledger.length).toBeGreaterThan(0));

    const types = result.current.ledger.map(t => [t.id, t.type]);
    expect(types).toContainEqual(['t1', '入荷']);
    expect(types).toContainEqual(['t2', '調整入庫']);
    expect(types).toContainEqual(['t3', '調整出庫']);
    // 倉庫移動の旧2件記録は「移動」1件に統合される
    expect(result.current.ledger.find(t => t.id === 't4')).toBeUndefined();
    expect(types).toContainEqual(['t5', '移動']);
    expect(result.current.ledger).toHaveLength(4);
  });
});

describe('useInventory — disposeLots（一括廃棄）', () => {
  // 廃棄用に商品1件とロット2件 (10個 / 5個) を用意する
  const setup = () => {
    const hook = renderHook(() => useInventory());
    act(() => {
      hook.result.current.addProduct({ name: '廃棄テスト', sku: 'DSP-001', categoryId: 'cat-food', minQuantity: 1, price: 300, costPrice: 200 });
    });
    const productId = hook.result.current.products.find(p => p.sku === 'DSP-001')!.id;
    act(() => { hook.result.current.addLot(productId, { lotNo: '20260101', quantity: 10 }); });
    act(() => { hook.result.current.addLot(productId, { lotNo: '20260102', quantity: 5 }); });
    const lots = hook.result.current.products.find(p => p.id === productId)!.lots;
    return { result: hook.result, productId, lots };
  };

  it('選んだロットを取り除き、廃棄として帳票に記録する', () => {
    const { result, productId, lots } = setup();

    let plan!: ReturnType<typeof result.current.disposeLots>;
    act(() => { plan = result.current.disposeLots([lots[0].id]); });

    // ロットは在庫0で残さず取り除く (画面上部の期限切れバナーが消えないため)
    const after = result.current.products.find(p => p.id === productId)!;
    expect(after.lots.map(l => l.id)).toEqual([lots[1].id]);

    expect(plan.targets).toHaveLength(1);
    expect(plan.quantity).toBe(10);
    expect(plan.costValue).toBe(10 * 200);

    expect(result.current.ledger[0]).toMatchObject({
      type: '廃棄', productId, lotNo: '20260101', quantity: 10, note: '一括廃棄',
      fromWarehouseId: DEFAULT_WAREHOUSE_ID, unitPrice: 200,
    });
  });

  it('複数ロットをまとめて廃棄すると、ロットの数だけ記録される', () => {
    const { result, productId, lots } = setup();
    const before = result.current.ledger.length;

    act(() => { result.current.disposeLots(lots.map(l => l.id)); });

    expect(result.current.products.find(p => p.id === productId)!.lots).toHaveLength(0);
    expect(result.current.ledger.length).toBe(before + 2);
    expect(result.current.ledger.slice(0, 2).every(t => t.type === '廃棄')).toBe(true);
  });

  it('備考を指定するとその内容で記録される', () => {
    const { result, lots } = setup();

    act(() => { result.current.disposeLots([lots[0].id], '期限切れ廃棄'); });

    expect(result.current.ledger[0].note).toBe('期限切れ廃棄');
  });

  it('対象がなければ在庫も帳票も変えない', () => {
    const { result, productId } = setup();
    const before = result.current.ledger.length;

    act(() => { result.current.disposeLots(['存在しないID']); });

    expect(result.current.products.find(p => p.id === productId)!.lots).toHaveLength(2);
    expect(result.current.ledger.length).toBe(before);
  });
});

describe('useInventory — resetToSample', () => {
  it('resetToSample でサンプルデータに戻る', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: '追加商品', sku: 'EXTRA-001', categoryId: 'cat-food', minQuantity: 1, price: 50, costPrice: 50 });
    });
    expect(result.current.products.some(p => p.sku === 'EXTRA-001')).toBe(true);

    act(() => { result.current.resetToSample(); });

    expect(result.current.products.some(p => p.sku === 'EXTRA-001')).toBe(false);
    expect(result.current.products.length).toBeGreaterThan(0);
  });

  it('resetToSample でledgerが空になる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      result.current.addProduct({ name: 'l test', sku: 'LT-001', categoryId: 'cat-food', minQuantity: 1, price: 50, costPrice: 50 });
    });
    const p = result.current.products.find(pr => pr.sku === 'LT-001')!;
    act(() => { result.current.addLot(p.id, { lotNo: '20261231', quantity: 1 }); });
    expect(result.current.ledger.length).toBeGreaterThan(0);

    act(() => { result.current.resetToSample(); });

    expect(result.current.ledger).toHaveLength(0);
  });
});
