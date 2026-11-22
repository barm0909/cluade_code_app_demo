import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SaveError, SaveQueue, diffRecords, mergeChangeSets, toBaseline } from '../saveQueue';
import type { ChangeSet } from '../saveQueue';
import { useInventory } from '../useInventory';
import { stubApi } from './mockApi';

// 名前つきのレコード (enqueue は { id } だけを型に持つので、直接のオブジェクトリテラルだと余分なプロパティで型エラーになる)
const rec = (id: string, name: string) => ({ id, name });
const a1 = rec('a', 'A');
const b1 = { id: 'b', name: 'B' };

describe('diffRecords', () => {
  it('追加・変更されたレコードと消えたレコードだけを返す', () => {
    const baseline = toBaseline([a1, b1]);
    const c = { id: 'c', name: 'C' };
    const changed = { id: 'b', name: 'B2' };
    const diff = diffRecords(baseline, [a1, changed, c]);
    expect(diff.upsert).toEqual([changed, c]);
    expect(diff.delete).toEqual([]);
    expect(diffRecords(diff.baseline, [c]).delete).toEqual(['a', 'b']);
  });

  it('作り直しても中身が同じレコードは送らない', () => {
    const diff = diffRecords(toBaseline([a1]), [{ ...a1 }]);
    expect(diff.upsert).toEqual([]);
  });
});

describe('mergeChangeSets', () => {
  it('後の変更が勝つ (追加のあとの削除は削除、削除のあとの追加は追加)', () => {
    const merged = mergeChangeSets(
      { ledger: { upsert: [a1], delete: ['x'] } },
      { ledger: { upsert: [rec('x', 'X')], delete: ['a'] }, products: { upsert: [b1], delete: [] } },
    );
    expect(merged).toEqual({
      ledger: { upsert: [{ id: 'x', name: 'X' }], delete: ['a'] },
      products: { upsert: [b1], delete: [] },
    });
  });
});

describe('SaveQueue', () => {
  let sent: ChangeSet[];
  let send: ReturnType<typeof vi.fn<(changes: ChangeSet) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    send = vi.fn(async (changes: ChangeSet) => { sent.push(changes); });
  });
  afterEach(() => { vi.useRealTimers(); });

  const loaded = () => {
    const q = new SaveQueue(send, [100, 200]);
    q.load({ products: [a1], ledger: [b1] });
    return q;
  };

  it('サーバーから読み込むまでは何も送らない', async () => {
    const q = new SaveQueue(send);
    q.enqueue('products', [a1, b1]);
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
    expect(q.getStatus().state).toBe('loading');
    q.markOffline();
    q.enqueue('products', [b1]);
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
    expect(q.getStatus().state).toBe('offline');
  });

  it('同じ操作の中の保存 (同じタイミングの enqueue) は1回の送信にまとめ、差分だけを送る', async () => {
    const q = loaded();
    const newTxn = { id: 't2', name: 'T2' };
    q.enqueue('products', [rec('a', 'A2')]);
    q.enqueue('ledger', [newTxn, b1]);
    expect(q.getStatus().state).toBe('idle');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{
      products: { upsert: [{ id: 'a', name: 'A2' }], delete: [] },
      ledger: { upsert: [newTxn], delete: [] },
    }]);
    expect(q.getStatus().state).toBe('idle');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('変わっていなければ送らない', async () => {
    const q = loaded();
    q.enqueue('products', [a1]);
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
  });

  it('送信中の変更は、終わってから次の送信にまとめる (順番を守る)', async () => {
    let release!: () => void;
    send.mockImplementationOnce(changes => { sent.push(changes); return new Promise<void>(r => { release = r; }); });
    const q = loaded();
    q.enqueue('products', [rec('a', 'A2')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getStatus().state).toBe('saving');
    q.enqueue('products', [rec('a', 'A3')]);
    q.enqueue('ledger', []);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(q.hasUnsaved()).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[1]).toEqual({ products: { upsert: [{ id: 'a', name: 'A3' }], delete: [] }, ledger: { upsert: [], delete: ['b'] } });
    expect(q.getStatus().state).toBe('idle');
  });

  it('通信エラーは間隔をあけて自動で再送し、成功すれば保存済みに戻る', async () => {
    send.mockRejectedValueOnce(new SaveError('サーバーと通信できませんでした', true));
    const q = loaded();
    q.enqueue('products', [rec('a', 'A2')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getStatus()).toEqual({ state: 'retrying', message: 'サーバーと通信できませんでした' });
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.getStatus().state).toBe('idle');
  });

  it('再送しても失敗すれば error にし、その後の変更も持ったまま retry() でまとめて送る', async () => {
    send.mockRejectedValue(new SaveError('サーバーでエラーが起きました（500）', true));
    const q = loaded();
    q.enqueue('products', [rec('a', 'A2')]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.getStatus()).toEqual({ state: 'error', message: 'サーバーでエラーが起きました（500）' });

    // error の間の変更は送らずにためておく
    q.enqueue('ledger', [b1, rec('t9', 'T9')]);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.hasUnsaved()).toBe(true);

    send.mockReset();
    send.mockImplementation(async changes => { sent.push(changes); });
    q.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toEqual({
      products: { upsert: [{ id: 'a', name: 'A2' }], delete: [] },
      ledger: { upsert: [{ id: 't9', name: 'T9' }], delete: [] },
    });
    expect(q.getStatus().state).toBe('idle');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('受け付けられない内容 (400 など) は自動で再送せず、すぐに error にする', async () => {
    send.mockRejectedValueOnce(new SaveError('保存の内容が受け付けられませんでした（400）', false));
    const q = loaded();
    q.enqueue('products', [rec('a', 'A2')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getStatus().state).toBe('error');
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('状態が変わったら購読者に知らせる', async () => {
    const q = loaded();
    const listener = vi.fn();
    const unsubscribe = q.subscribe(listener);
    q.enqueue('products', [rec('a', 'A2')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(2); // saving → idle
    unsubscribe();
  });
});

describe('useInventory — 差分保存', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('出庫は「そのロットの商品」と「新しい帳票の行」だけを1回のリクエストで送る', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
    act(() => { result.current.resetToSample(); });
    await waitFor(() => expect(server.products.length).toBeGreaterThan(0));
    // 帳票を何件か積んでおく
    act(() => { result.current.shipFefo('1', 1); });
    act(() => { result.current.shipFefo('2', 1); });
    await waitFor(() => expect(server.ledger).toHaveLength(2));

    const before = server.requests.length;
    act(() => { result.current.shipFefo('4', 1); });
    await waitFor(() => expect(server.requests.length).toBe(before + 1));
    const request = server.requests.at(-1)!;
    expect(Object.keys(request).sort()).toEqual(['ledger', 'products']);
    expect(request.products!.upsert.map(p => p.id)).toEqual(['4']);
    expect(request.ledger!.upsert).toHaveLength(1); // 過去の帳票は送り直さない
    expect(request.ledger!.delete).toEqual([]);
    expect(server.ledger).toHaveLength(3);
    expect(result.current.saveStatus.state).toBe('idle');
  });

  it('サーバーから読み込めないときは offline になり、何も送らない', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network'); });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.saveStatus.state).toBe('offline'));
    act(() => { result.current.shipFefo('1', 1); });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1); // GET /api/state だけ
    expect(result.current.ledger).toHaveLength(1); // 画面の中では動く
  });

  it('サーバーが一時的に失敗しても、自動で再送して保存する', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
    server.failNext = 1;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => { result.current.addCategory('冷凍食品'); });
      await vi.advanceTimersByTimeAsync(0);
      expect(result.current.saveStatus).toEqual({ state: 'retrying', message: 'サーバーでエラーが起きました（500）' });
      await vi.advanceTimersByTimeAsync(1000);
      await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
      expect(server.categories.map(c => c.name)).toContain('冷凍食品');
    } finally {
      vi.useRealTimers();
    }
  });
});
