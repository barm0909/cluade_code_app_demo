import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInventory, type Product } from '../useInventory';
import { stubApi } from './mockApi';

// fetch モックなし = API に到達できない環境として、メモリ内のデフォルトカテゴリで動作する。
// 永続化・後方互換を検証するテストだけ stubApi() で /api/* を模倣する。
afterEach(() => { vi.unstubAllGlobals(); });

// ────────────────────────────────────────────────────────────
// カテゴリ CRUD
// ────────────────────────────────────────────────────────────
describe('useInventory — カテゴリ管理', () => {
  it('初回ロード時にデフォルトカテゴリ3つが存在する', () => {
    const { result } = renderHook(() => useInventory());
    expect(result.current.categories.length).toBe(3);
    const names = result.current.categories.map(c => c.name);
    expect(names).toContain('乳製品');
    expect(names).toContain('パン');
    expect(names).toContain('ラベル');
  });

  it('サンプル商品はすべてカテゴリマスタのidを参照している', () => {
    const { result } = renderHook(() => useInventory());
    const ids = new Set(result.current.categories.map(c => c.id));
    for (const p of result.current.products) {
      expect(ids.has(p.categoryId)).toBe(true);
    }
  });

  it('addCategory で新しいカテゴリが追加される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.categories.length;

    act(() => { result.current.addCategory('調味料'); });

    expect(result.current.categories.length).toBe(before + 1);
    expect(result.current.categories.some(c => c.name === '調味料')).toBe(true);
  });

  it('addCategory は空白のみの名前を無視する', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.categories.length;

    act(() => { result.current.addCategory('   '); });

    expect(result.current.categories.length).toBe(before);
  });

  it('addCategory は重複する名前を無視する', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.categories.length;

    act(() => { result.current.addCategory('乳製品'); });

    expect(result.current.categories.length).toBe(before);
  });

  it('updateCategory でカテゴリ名が変更され、商品はid参照なので追従する', () => {
    const { result } = renderHook(() => useInventory());
    const dairy = result.current.categories.find(c => c.name === '乳製品')!;
    const milk = result.current.products.find(p => p.sku === 'ML-001')!;
    expect(milk.categoryId).toBe(dairy.id);

    act(() => { result.current.updateCategory(dairy.id, '乳製品・チルド'); });

    expect(result.current.categories.find(c => c.id === dairy.id)?.name).toBe('乳製品・チルド');
    // 商品側は書き換え不要 (id参照のまま新しい名前に解決される)
    expect(result.current.products.find(p => p.sku === 'ML-001')?.categoryId).toBe(dairy.id);
  });

  it('updateCategory は他カテゴリと重複する名前への変更を無視する', () => {
    const { result } = renderHook(() => useInventory());
    const dairy = result.current.categories.find(c => c.name === '乳製品')!;

    act(() => { result.current.updateCategory(dairy.id, 'パン'); });

    expect(result.current.categories.find(c => c.id === dairy.id)?.name).toBe('乳製品');
  });

  it('deleteCategory で未使用カテゴリを削除できる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addCategory('削除カテゴリ'); });
    const target = result.current.categories.find(c => c.name === '削除カテゴリ')!;

    act(() => { result.current.deleteCategory(target.id); });

    expect(result.current.categories.find(c => c.id === target.id)).toBeUndefined();
  });

  it('商品が使用中のカテゴリは deleteCategory できない', () => {
    const { result } = renderHook(() => useInventory());
    // サンプルデータの牛乳が乳製品カテゴリを使用している
    const dairy = result.current.categories.find(c => c.name === '乳製品')!;

    act(() => { result.current.deleteCategory(dairy.id); });

    expect(result.current.categories.find(c => c.id === dairy.id)).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// 永続化・後方互換
// ────────────────────────────────────────────────────────────
describe('useInventory — カテゴリの永続化と後方互換', () => {
  it('カテゴリはAPI (D1) に永続化され再ロード後も残る', async () => {
    const server = stubApi();
    const { result: r1, unmount } = renderHook(() => useInventory());
    await waitFor(() => expect(r1.current.products).toHaveLength(0));

    act(() => { r1.current.addCategory('永続カテゴリ'); });
    await waitFor(() => expect(server.categories.some(c => c.name === '永続カテゴリ')).toBe(true));
    unmount();

    const { result: r2 } = renderHook(() => useInventory());
    await waitFor(() => expect(r2.current.categories.some(c => c.name === '永続カテゴリ')).toBe(true));
  });

  it('旧形式 (category 文字列) の商品はロード時にカテゴリマスタへ対応付けられる', async () => {
    const legacy = {
      id: 'p1', name: '旧商品', sku: 'OLD-001', category: '調味料',
      minQuantity: 1, price: 100, costPrice: 50, lots: [], updatedAt: '',
    } as unknown as Product;
    stubApi({ products: [legacy] });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    const p = result.current.products[0];
    expect(p.categoryId).toBeTruthy();
    expect(result.current.categories.find(c => c.id === p.categoryId)?.name).toBe('調味料');
  });

  it('旧形式の商品のカテゴリ名が既存カテゴリと一致する場合はそのidに対応付けられる', async () => {
    const legacy = {
      id: 'p1', name: '旧牛乳', sku: 'OLD-ML', category: '乳製品',
      minQuantity: 1, price: 100, costPrice: 50, lots: [], updatedAt: '',
    } as unknown as Product;
    stubApi({ products: [legacy] });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    // デフォルトカテゴリの乳製品 (cat-dairy) が再利用され、重複カテゴリは作られない
    expect(result.current.products[0].categoryId).toBe('cat-dairy');
    expect(result.current.categories.filter(c => c.name === '乳製品')).toHaveLength(1);
  });
});
