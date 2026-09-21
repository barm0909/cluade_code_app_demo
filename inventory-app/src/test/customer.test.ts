import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  customerValidationError,
  normalizeCustomerInput,
  customerName,
  selectableCustomers,
  customerUsage,
  customerRows,
  customerCsv,
  salesRows,
  EMPTY_CUSTOMER,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { Customer, CustomerInput, Product, StockTransaction } from '../useInventory';
import { stubApi } from './mockApi';

// fetch モックなし = API に到達できない環境として、メモリ内の DEFAULT_CUSTOMERS で動作する。
// 永続化を検証するテストだけ stubApi() で /api/* を模倣する。
afterEach(() => { vi.unstubAllGlobals(); });

const customer = (over: Partial<Customer> & { id: string; name: string }): Customer => ({
  code: '', contact: '', phone: '', email: '', address: '', note: '', active: true,
  ...over,
});

const PRODUCTS: Product[] = [{
  id: 'p1', name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0,
  price: 200, costPrice: 130, updatedAt: '2026-01-01T00:00:00.000Z', lots: [],
}];

const sale = (over: Partial<StockTransaction> & { id: string }): StockTransaction => ({
  date: '2026-06-10T01:00:00.000Z',
  type: '売上出庫',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: '20260610',
  quantity: 1,
  note: '売上登録',
  fromWarehouseId: DEFAULT_WAREHOUSE_ID,
  unitPrice: 200,
  costUnitPrice: 130,
  ...over,
});

const INPUT: CustomerInput = {
  name: '新規商店', code: 'C-100', contact: '鈴木 一郎', phone: '03-0000-0000',
  email: 'order@example.jp', address: '東京都港区1-1-1', note: 'テスト', active: true,
};

// ────────────────────────────────────────────────────────────
// 入力の正規化・検証 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('normalizeCustomerInput', () => {
  it('前後の空白を落とす', () => {
    const normalized = normalizeCustomerInput({ ...EMPTY_CUSTOMER, name: '  みどりストア  ', code: ' C-001 ', note: ' 毎朝配送 ' });
    expect(normalized.name).toBe('みどりストア');
    expect(normalized.code).toBe('C-001');
    expect(normalized.note).toBe('毎朝配送');
  });
});

describe('customerValidationError', () => {
  const existing = [customer({ id: 'c1', name: 'みどりストア', code: 'C-001' })];

  it('問題がなければ空文字を返す', () => {
    expect(customerValidationError(INPUT, existing)).toBe('');
  });

  it('得意先名は必須', () => {
    expect(customerValidationError({ ...INPUT, name: '  ' }, existing)).toBe('得意先名は必須です');
  });

  it('得意先名・コードの重複を弾く', () => {
    expect(customerValidationError({ ...INPUT, name: 'みどりストア' }, existing)).toBe('同じ名前の得意先がすでにあります');
    expect(customerValidationError({ ...INPUT, code: 'C-001' }, existing)).toBe('同じ得意先コードがすでにあります');
  });

  it('編集中の得意先自身は重複扱いしない', () => {
    expect(customerValidationError({ ...INPUT, name: 'みどりストア', code: 'C-001' }, existing, 'c1')).toBe('');
  });

  it('メールアドレスの形式を見る（空欄は許す）', () => {
    expect(customerValidationError({ ...INPUT, email: 'not-an-email' }, existing)).toBe('メールアドレスの形式が正しくありません');
    expect(customerValidationError({ ...INPUT, email: '' }, existing)).toBe('');
  });
});

describe('customerName / selectableCustomers', () => {
  const list = [customer({ id: 'c1', name: 'みどりストア' }), customer({ id: 'c2', name: '休止先', active: false })];

  it('マスタにない id は空文字になる', () => {
    expect(customerName(list, 'c1')).toBe('みどりストア');
    expect(customerName(list, 'gone')).toBe('');
  });

  it('取引停止は選択肢から外すが、選択中のものは残す', () => {
    expect(selectableCustomers(list).map(c => c.id)).toEqual(['c1']);
    expect(selectableCustomers(list, 'c2').map(c => c.id)).toEqual(['c1', 'c2']);
  });
});

// ────────────────────────────────────────────────────────────
// 売上実績の集計・一覧 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('customerUsage', () => {
  const CUSTOMERS = [customer({ id: 'c1', name: 'みどりストア' })];
  const rows = salesRows([
    sale({ id: 't1', customerId: 'c1', quantity: 2, date: '2026-06-10T01:00:00.000Z' }),
    sale({ id: 't2', customerId: 'c1', quantity: 3, date: '2026-06-12T01:00:00.000Z' }),
    sale({ id: 't3', quantity: 1 }), // 得意先なし
  ], PRODUCTS, CUSTOMERS);

  it('得意先ごとの件数・数量・売上金額・粗利・最終売上日を集計する', () => {
    const usage = customerUsage(rows).get('c1')!;
    expect(usage.saleCount).toBe(2);
    expect(usage.quantity).toBe(5);
    expect(usage.amount).toBe(1000);
    expect(usage.profit).toBe(1000 - 650);
    expect(usage.lastSaleAt).toBe('2026-06-12T01:00:00.000Z');
  });

  it('得意先なしの売上もキー「空文字」で集計する', () => {
    expect(customerUsage(rows).get('')!.saleCount).toBe(1);
  });
});

describe('customerRows', () => {
  const CUSTOMERS = [
    customer({ id: 'c2', name: 'さくらカフェ', code: 'C-002' }),
    customer({ id: 'c1', name: 'みどりストア', code: 'C-001', contact: '緑川' }),
    customer({ id: 'c3', name: '休止先', active: false }),
  ];
  const rows = salesRows([sale({ id: 't1', customerId: 'c1', quantity: 2 })], PRODUCTS, CUSTOMERS);

  it('取引中を先に、次に名前順で並べる', () => {
    expect(customerRows(CUSTOMERS, rows).map(r => r.customer.name)).toEqual(['さくらカフェ', 'みどりストア', '休止先']);
  });

  it('取引停止を隠せる', () => {
    expect(customerRows(CUSTOMERS, rows, '', false).map(r => r.customer.id)).toEqual(['c2', 'c1']);
  });

  it('キーワードは名前・コード・担当者・電話・メールにあたる', () => {
    expect(customerRows(CUSTOMERS, rows, '緑川').map(r => r.customer.id)).toEqual(['c1']);
    expect(customerRows(CUSTOMERS, rows, 'c-002').map(r => r.customer.id)).toEqual(['c2']);
  });

  it('売上実績のない得意先は0件として並ぶ', () => {
    const row = customerRows(CUSTOMERS, rows).find(r => r.customer.id === 'c2')!;
    expect(row.usage).toEqual({ saleCount: 0, quantity: 0, amount: 0, profit: 0, lastSaleAt: '' });
  });

  it('CSV は見出し + 得意先の数だけ行を出す', () => {
    const lines = customerCsv(customerRows(CUSTOMERS, rows)).split('\n');
    expect(lines[0]).toBe('得意先名,得意先コード,担当者,電話番号,メールアドレス,住所,取引状態,売上件数,売上数量,売上金額,粗利,最終売上日,備考');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('みどりストア');
  });
});

// ────────────────────────────────────────────────────────────
// マスタの編集 (フック)
// ────────────────────────────────────────────────────────────
describe('useInventory — 得意先マスタ', () => {
  it('追加すると一覧に並ぶ', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.addCustomer(INPUT); });

    expect(result.current.customers.map(c => c.name)).toContain('新規商店');
  });

  it('入力チェックに引っかかる追加・更新は何も起こさない', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.customers.length;

    act(() => { result.current.addCustomer({ ...INPUT, name: '' }); });
    act(() => { result.current.addCustomer({ ...INPUT, name: 'みどりストア' }); }); // 既存と同名

    expect(result.current.customers).toHaveLength(before);
  });

  it('改名しても売上の記録の紐づけは切れない（id 参照）', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 1, unitPrice: 198, customerId: 'cus-midori' }); });
    act(() => {
      const c = result.current.customers.find(x => x.id === 'cus-midori')!;
      result.current.updateCustomer('cus-midori', { ...c, name: 'みどりストア 本店' });
    });

    const rows = salesRows(result.current.ledger, result.current.products, result.current.customers);
    expect(rows[0].customerId).toBe('cus-midori');
    expect(rows[0].customerName).toBe('みどりストア 本店');
  });

  it('売上の記録がある得意先は削除できない（取引停止にする運用）', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.recordSale({ productId: '1', quantity: 1, unitPrice: 198, customerId: 'cus-midori' }); });
    act(() => { result.current.deleteCustomer('cus-midori'); });

    expect(result.current.customers.map(c => c.id)).toContain('cus-midori');
  });

  it('売上の記録がない得意先は削除できる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => { result.current.deleteCustomer('cus-midori'); });

    expect(result.current.customers.map(c => c.id)).not.toContain('cus-midori');
  });

  it('取引停止にしても一覧には残り、売上登録の選択肢からは外れる', () => {
    const { result } = renderHook(() => useInventory());

    act(() => {
      const c = result.current.customers.find(x => x.id === 'cus-midori')!;
      result.current.updateCustomer('cus-midori', { ...c, active: false });
    });

    expect(result.current.customers.find(c => c.id === 'cus-midori')!.active).toBe(false);
    expect(selectableCustomers(result.current.customers).map(c => c.id)).not.toContain('cus-midori');
  });
});

describe('useInventory — 得意先の永続化', () => {
  it('サーバーの得意先を読み込み、変更のたびに保存し直す', async () => {
    const server = stubApi({
      customers: [customer({ id: 'c1', name: 'サーバー得意先' })],
    });
    const { result } = renderHook(() => useInventory());

    await waitFor(() => expect(result.current.customers.map(c => c.name)).toEqual(['サーバー得意先']));

    act(() => { result.current.addCustomer(INPUT); });

    await waitFor(() => expect(server.customers.map(c => c.name)).toEqual(['サーバー得意先', '新規商店']));
  });

  it('売上を登録すると実売単価・得意先つきで帳票が保存される', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.products).toHaveLength(0));

    act(() => { result.current.addProduct({ name: '牛乳', sku: 'ML-001', categoryId: 'cat-dairy', minQuantity: 0, price: 200, costPrice: 130 }); });
    const productId = result.current.products[0].id;
    act(() => { result.current.addLot(productId, { lotNo: '20260610', quantity: 5, unitPrice: 118 }); });
    act(() => { result.current.recordSale({ productId, quantity: 2, unitPrice: 190, customerId: 'c1' }); });

    await waitFor(() => {
      const saved = server.ledger.find(t => t.type === '売上出庫')!;
      expect(saved.unitPrice).toBe(190);
      expect(saved.customerId).toBe('c1');
      expect(saved.costUnitPrice).toBe(118);
    });
  });
});
