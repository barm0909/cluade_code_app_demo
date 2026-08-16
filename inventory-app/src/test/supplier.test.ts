import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useInventory,
  supplierValidationError,
  normalizeSupplierInput,
  supplierName,
  selectableSuppliers,
  expectedDateFromLeadTime,
  supplierUsage,
  supplierRows,
  supplierCsv,
  EMPTY_SUPPLIER,
  DEFAULT_WAREHOUSE_ID,
} from '../useInventory';
import type { InboundPlan, InboundPlanInput, Supplier, SupplierInput } from '../useInventory';
import { stubApi } from './mockApi';

// fetch モックなし = API に到達できない環境として、メモリ内の DEFAULT_SUPPLIERS で動作する。
// 永続化・後方互換を検証するテストだけ stubApi() で /api/* を模倣する。
afterEach(() => { vi.unstubAllGlobals(); });

const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

const supplier = (over: Partial<Supplier> & { id: string; name: string }): Supplier => ({
  code: '', contact: '', phone: '', email: '', address: '', leadTimeDays: 0, note: '', active: true,
  ...over,
});

const plan = (over: Partial<InboundPlan> & { id: string }): InboundPlan => ({
  productId: 'p1',
  expectedDate: d(1),
  quantity: 10,
  receivedQuantity: 0,
  warehouseId: DEFAULT_WAREHOUSE_ID,
  lotNo: '20260101',
  supplierId: 'sup-a',
  unitPrice: 0,
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const INPUT: SupplierInput = {
  name: '新規商店', code: 'S-100', contact: '鈴木 一郎', phone: '03-0000-0000',
  email: 'order@example.jp', address: '東京都港区1-1-1', leadTimeDays: 3, note: 'テスト', active: true,
};

// ────────────────────────────────────────────────────────────
// 入力の正規化・検証 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('normalizeSupplierInput', () => {
  it('前後の空白を落とし、リードタイムを0以上の整数に丸める', () => {
    const normalized = normalizeSupplierInput({
      ...EMPTY_SUPPLIER, name: '  山田乳業  ', code: ' S-001 ', leadTimeDays: 2.7,
    });
    expect(normalized).toMatchObject({ name: '山田乳業', code: 'S-001', leadTimeDays: 2 });
  });

  it('負のリードタイム・NaN は0にする', () => {
    expect(normalizeSupplierInput({ ...EMPTY_SUPPLIER, name: 'a', leadTimeDays: -5 }).leadTimeDays).toBe(0);
    expect(normalizeSupplierInput({ ...EMPTY_SUPPLIER, name: 'a', leadTimeDays: NaN }).leadTimeDays).toBe(0);
  });
});

describe('supplierValidationError', () => {
  const existing = [supplier({ id: 'sup-a', name: '山田乳業', code: 'S-001' })];

  it('問題がなければ空文字を返す', () => {
    expect(supplierValidationError(INPUT, existing)).toBe('');
  });

  it('仕入先名が空 (空白のみを含む) なら必須エラー', () => {
    expect(supplierValidationError({ ...INPUT, name: '   ' }, existing)).toBe('仕入先名は必須です');
  });

  it('名前・コードの重複を弾く', () => {
    expect(supplierValidationError({ ...INPUT, name: '山田乳業' }, existing)).toBe('同じ名前の仕入先がすでにあります');
    expect(supplierValidationError({ ...INPUT, code: 'S-001' }, existing)).toBe('同じ仕入先コードがすでにあります');
  });

  it('編集中の自分自身は重複扱いしない', () => {
    expect(supplierValidationError({ ...INPUT, name: '山田乳業', code: 'S-001' }, existing, 'sup-a')).toBe('');
  });

  it('コードが空欄なら重複チェックしない', () => {
    const suppliers = [supplier({ id: 'sup-a', name: '山田乳業' })];
    expect(supplierValidationError({ ...INPUT, code: '' }, suppliers)).toBe('');
  });

  it('メールアドレスは入力があるときだけ形式を見る', () => {
    expect(supplierValidationError({ ...INPUT, email: '' }, existing)).toBe('');
    expect(supplierValidationError({ ...INPUT, email: 'not-an-email' }, existing))
      .toBe('メールアドレスの形式が正しくありません');
  });
});

// ────────────────────────────────────────────────────────────
// 表示・選択肢のヘルパー (純粋関数)
// ────────────────────────────────────────────────────────────
describe('supplierName / selectableSuppliers / expectedDateFromLeadTime', () => {
  const suppliers = [
    supplier({ id: 'sup-a', name: '山田乳業', leadTimeDays: 2 }),
    supplier({ id: 'sup-b', name: '旧取引先', active: false }),
  ];

  it('supplierName はマスタにない id には空文字を返す', () => {
    expect(supplierName(suppliers, 'sup-a')).toBe('山田乳業');
    expect(supplierName(suppliers, '')).toBe('');
    expect(supplierName(suppliers, 'sup-deleted')).toBe('');
  });

  it('取引停止の仕入先は選択肢から外れるが、選択中のものだけは残る', () => {
    expect(selectableSuppliers(suppliers).map(s => s.id)).toEqual(['sup-a']);
    expect(selectableSuppliers(suppliers, 'sup-b').map(s => s.id)).toEqual(['sup-a', 'sup-b']);
  });

  it('入荷予定日の既定値は今日 + 標準リードタイム', () => {
    expect(expectedDateFromLeadTime(suppliers[0], new Date('2026-03-01T09:00:00'))).toBe('2026-03-03');
    // 未選択 (undefined) はリードタイム0として今日
    expect(expectedDateFromLeadTime(undefined, new Date('2026-03-01T09:00:00'))).toBe('2026-03-01');
  });
});

// ────────────────────────────────────────────────────────────
// 入荷予定の集計と一覧 (純粋関数)
// ────────────────────────────────────────────────────────────
describe('supplierUsage', () => {
  it('仕入先ごとに件数・入荷待ち・遅延を数える', () => {
    const usage = supplierUsage([
      plan({ id: '1', supplierId: 'sup-a', quantity: 10, receivedQuantity: 4 }), // 残6
      plan({ id: '2', supplierId: 'sup-a', quantity: 5, expectedDate: d(-2) }), // 残5・遅延
      plan({ id: '3', supplierId: 'sup-a', quantity: 8, receivedQuantity: 8 }), // 入荷済
      plan({ id: '4', supplierId: 'sup-b', quantity: 3, canceledAt: 'x' }), // キャンセル
    ]);

    expect(usage.get('sup-a')).toEqual({ planCount: 3, pendingCount: 2, pendingQuantity: 11, overdueCount: 1 });
    expect(usage.get('sup-b')).toEqual({ planCount: 1, pendingCount: 0, pendingQuantity: 0, overdueCount: 0 });
  });

  it('仕入先未設定の予定はキー空文字に集計される', () => {
    expect(supplierUsage([plan({ id: '1', supplierId: '' })]).get('')?.planCount).toBe(1);
  });
});

describe('supplierRows', () => {
  const suppliers = [
    supplier({ id: 'sup-b', name: '朝日ベーカリー', code: 'S-002', contact: '朝日 花子' }),
    supplier({ id: 'sup-a', name: '山田乳業', code: 'S-001', phone: '03-1234-5678' }),
    supplier({ id: 'sup-x', name: '休止商店', code: 'S-003', active: false }),
  ];
  const plans = [plan({ id: '1', supplierId: 'sup-a', quantity: 10 })];

  it('取引中が先、その中は名前順に並び、入荷予定の状況が付く', () => {
    const rows = supplierRows(suppliers, plans);
    // 取引停止の休止商店は名前順では先頭に来るが、取引中の2件より後ろに置かれる
    expect(rows.map(r => r.supplier.id)).toEqual(['sup-a', 'sup-b', 'sup-x']);
    expect(rows[0].usage).toMatchObject({ planCount: 1, pendingCount: 1, pendingQuantity: 10 });
    // 予定のない仕入先も 0 の usage を持つ (undefined にはならない)
    expect(rows[1].usage.planCount).toBe(0);
  });

  it('キーワードは名前・コード・担当者・電話・メールに効く', () => {
    const ids = (keyword: string) => supplierRows(suppliers, plans, keyword).map(r => r.supplier.id);
    expect(ids('山田')).toEqual(['sup-a']);
    expect(ids('S-002')).toEqual(['sup-b']);
    expect(ids('花子')).toEqual(['sup-b']);
    expect(ids('03-1234')).toEqual(['sup-a']);
  });

  it('includeInactive=false で取引停止を除ける', () => {
    expect(supplierRows(suppliers, plans, '', false).map(r => r.supplier.id)).toEqual(['sup-a', 'sup-b']);
  });
});

describe('supplierCsv', () => {
  it('ヘッダーと1仕入先1行を出力する', () => {
    const rows = supplierRows(
      [supplier({ id: 'sup-a', name: '山田乳業', code: 'S-001', contact: '山田 太郎', phone: '03-1234-5678', email: 'a@example.jp', address: '東京都', leadTimeDays: 2, note: '定期便, 火曜' })],
      [plan({ id: '1', supplierId: 'sup-a', quantity: 10, receivedQuantity: 4 })],
    );
    const lines = supplierCsv(rows).split('\n');

    expect(lines[0]).toBe('仕入先名,仕入先コード,担当者,電話番号,メールアドレス,住所,リードタイム（日）,取引状態,入荷予定件数,入荷待ち件数,入荷待ち数量,遅延件数,備考');
    // 備考にカンマを含むので引用符でくくられる
    expect(lines[1]).toBe('山田乳業,S-001,山田 太郎,03-1234-5678,a@example.jp,東京都,2,取引中,1,1,6,0,"定期便, 火曜"');
  });
});

// ────────────────────────────────────────────────────────────
// フックのミューテーション
// ────────────────────────────────────────────────────────────
describe('useInventory — 仕入先マスタ', () => {
  it('初期状態でサンプルの仕入先が読み込まれ、サンプルの入荷予定がそれを参照している', () => {
    const { result } = renderHook(() => useInventory());
    const ids = new Set(result.current.suppliers.map(s => s.id));

    expect(result.current.suppliers.length).toBeGreaterThan(0);
    for (const p of result.current.inboundPlans) {
      expect(ids.has(p.supplierId)).toBe(true);
    }
  });

  it('addSupplier で仕入先が追加され、入力は正規化される', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.suppliers.length;

    act(() => { result.current.addSupplier({ ...INPUT, name: '  新規商店  ', leadTimeDays: 3.9 }); });

    expect(result.current.suppliers.length).toBe(before + 1);
    expect(result.current.suppliers.at(-1)).toMatchObject({ name: '新規商店', leadTimeDays: 3, active: true });
  });

  it('addSupplier は名前が空・重複する入力を無視する', () => {
    const { result } = renderHook(() => useInventory());
    const before = result.current.suppliers.length;

    act(() => { result.current.addSupplier({ ...INPUT, name: '  ' }); });
    act(() => { result.current.addSupplier({ ...INPUT, name: '山田乳業' }); });

    expect(result.current.suppliers.length).toBe(before);
  });

  it('updateSupplier で内容を変更でき、入荷予定は id 参照なので追従する', () => {
    const { result } = renderHook(() => useInventory());
    const target = result.current.suppliers.find(s => s.name === '山田乳業')!;
    const planned = result.current.inboundPlans.filter(p => p.supplierId === target.id);
    expect(planned.length).toBeGreaterThan(0);

    act(() => { result.current.updateSupplier(target.id, { ...target, name: '山田乳業（新）' }); });

    expect(result.current.suppliers.find(s => s.id === target.id)!.name).toBe('山田乳業（新）');
    // 予定側は書き換え不要 (id 参照のまま新しい名前に解決される)
    expect(result.current.inboundPlans.filter(p => p.supplierId === target.id)).toHaveLength(planned.length);
  });

  it('updateSupplier は他の仕入先と重複する名前への変更を無視する', () => {
    const { result } = renderHook(() => useInventory());
    const target = result.current.suppliers.find(s => s.name === '山田乳業')!;

    act(() => { result.current.updateSupplier(target.id, { ...target, name: '朝日ベーカリー' }); });

    expect(result.current.suppliers.find(s => s.id === target.id)!.name).toBe('山田乳業');
  });

  it('取引停止にしても仕入先は残り、入荷予定の選択肢からだけ外れる', () => {
    const { result } = renderHook(() => useInventory());
    const target = result.current.suppliers.find(s => s.name === '山田乳業')!;

    act(() => { result.current.updateSupplier(target.id, { ...target, active: false }); });

    expect(result.current.suppliers.find(s => s.id === target.id)!.active).toBe(false);
    expect(selectableSuppliers(result.current.suppliers).map(s => s.id)).not.toContain(target.id);
  });

  it('入荷予定で使用中の仕入先は deleteSupplier できない', () => {
    const { result } = renderHook(() => useInventory());
    const inUse = result.current.suppliers.find(s => s.name === '山田乳業')!;

    act(() => { result.current.deleteSupplier(inUse.id); });

    expect(result.current.suppliers.find(s => s.id === inUse.id)).toBeDefined();
  });

  it('未使用の仕入先は deleteSupplier できる', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addSupplier({ ...INPUT, name: '未使用商店', code: '' }); });
    const target = result.current.suppliers.find(s => s.name === '未使用商店')!;

    act(() => { result.current.deleteSupplier(target.id); });

    expect(result.current.suppliers.find(s => s.id === target.id)).toBeUndefined();
  });

  it('入荷予定の仕入先はキャンセル済みでも参照とみなし、削除を止める', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addSupplier({ ...INPUT, name: '一度きり商店', code: '' }); });
    const target = result.current.suppliers.find(s => s.name === '一度きり商店')!;
    const input: InboundPlanInput = {
      productId: result.current.products[0].id,
      expectedDate: d(1), quantity: 5, warehouseId: DEFAULT_WAREHOUSE_ID,
      lotNo: '20260101', supplierId: target.id, unitPrice: 0, note: '',
    };
    act(() => { result.current.addInboundPlan(input); });
    const created = result.current.inboundPlans.at(-1)!;
    act(() => { result.current.cancelInboundPlan(created.id); });

    act(() => { result.current.deleteSupplier(target.id); });

    expect(result.current.suppliers.find(s => s.id === target.id)).toBeDefined();
  });

  it('入荷の帳票にはその時点の仕入先名が残る', () => {
    const { result } = renderHook(() => useInventory());
    const target = result.current.inboundPlans.find(p => p.supplierId)!;

    act(() => { result.current.receiveInboundPlan(target.id, { quantity: 1 }); });

    const name = supplierName(result.current.suppliers, target.supplierId);
    expect(result.current.ledger[0]).toMatchObject({ type: '入荷', note: `入荷予定（${name}）` });
  });

  it('resetToSample で仕入先もサンプルに戻る', () => {
    const { result } = renderHook(() => useInventory());
    act(() => { result.current.addSupplier({ ...INPUT, name: '消える商店', code: '' }); });

    act(() => { result.current.resetToSample(); });

    expect(result.current.suppliers.some(s => s.name === '消える商店')).toBe(false);
    expect(result.current.suppliers.some(s => s.name === '山田乳業')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 永続化・後方互換
// ────────────────────────────────────────────────────────────
describe('useInventory — 仕入先の永続化と後方互換', () => {
  it('仕入先は API (D1) に永続化され再ロード後も残る', async () => {
    const server = stubApi();
    const { result: r1, unmount } = renderHook(() => useInventory());
    await waitFor(() => expect(r1.current.products).toHaveLength(0));

    act(() => { r1.current.addSupplier({ ...INPUT, name: '永続商店' }); });
    await waitFor(() => expect(server.suppliers.some(s => s.name === '永続商店')).toBe(true));
    unmount();

    const { result: r2 } = renderHook(() => useInventory());
    await waitFor(() => expect(r2.current.suppliers.some(s => s.name === '永続商店')).toBe(true));
  });

  it('旧形式 (supplier 文字列) の入荷予定はロード時に仕入先マスタへ対応付けられる', async () => {
    const legacy = { ...plan({ id: 'ip1' }), supplierId: undefined, supplier: '旧仕入先' } as unknown as InboundPlan;
    const server = stubApi({ inboundPlans: [legacy] });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.inboundPlans).toHaveLength(1));

    const migrated = result.current.inboundPlans[0];
    expect(migrated.supplierId).toBeTruthy();
    expect(supplierName(result.current.suppliers, migrated.supplierId)).toBe('旧仕入先');
    // 移行結果はそのまま保存され、次回以降は名前ではなく id で読める
    await waitFor(() => expect(server.suppliers.some(s => s.name === '旧仕入先')).toBe(true));
  });

  it('同じ仕入先名の旧予定は1つの仕入先にまとまる', async () => {
    const legacy = (id: string) =>
      ({ ...plan({ id }), supplierId: undefined, supplier: '同じ仕入先' } as unknown as InboundPlan);
    stubApi({ inboundPlans: [legacy('ip1'), legacy('ip2')] });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.inboundPlans).toHaveLength(2));

    expect(result.current.suppliers.filter(s => s.name === '同じ仕入先')).toHaveLength(1);
    expect(result.current.inboundPlans[0].supplierId).toBe(result.current.inboundPlans[1].supplierId);
  });

  it('仕入先が空欄の旧予定は未設定のまま残り、仕入先は作られない', async () => {
    const legacy = { ...plan({ id: 'ip1' }), supplierId: undefined, supplier: '' } as unknown as InboundPlan;
    stubApi({ inboundPlans: [legacy] });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.inboundPlans).toHaveLength(1));

    expect(result.current.inboundPlans[0].supplierId).toBe('');
    expect(result.current.suppliers).toHaveLength(0);
  });

  it('supplierId を持つ予定は既存のマスタをそのまま使う', async () => {
    stubApi({
      inboundPlans: [plan({ id: 'ip1', supplierId: 'sup-a' })],
      suppliers: [supplier({ id: 'sup-a', name: '既存仕入先' })],
    });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.inboundPlans).toHaveLength(1));

    expect(result.current.inboundPlans[0].supplierId).toBe('sup-a');
    expect(result.current.suppliers).toHaveLength(1);
  });
});
