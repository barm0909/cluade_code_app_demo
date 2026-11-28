import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SaveError, SaveQueue, conflictSummary, diffRecords, mergeChangeSets, postChanges, toBaseline } from '../saveQueue';
import type { ChangeSet, SendResult } from '../saveQueue';
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
  let send: ReturnType<typeof vi.fn<(changes: ChangeSet) => Promise<SendResult | void>>>;

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

  describe('同時編集の衝突検知', () => {
    const withRevs = () => {
      const q = new SaveQueue(send, [100, 200]);
      q.load({ products: [a1], ledger: [b1] }, { products: { a: 3 }, ledger: { b: 0 } });
      return q;
    };

    it('既存レコードの更新・削除には最後に見た rev を base として付け、新しいレコードには付けない', async () => {
      const q = withRevs();
      q.enqueue('products', [rec('a', 'A2')]);
      q.enqueue('ledger', [rec('t2', 'T2')]); // b を消して t2 を足す
      await vi.advanceTimersByTimeAsync(0);
      expect(sent[0]).toEqual({
        products: { upsert: [{ id: 'a', name: 'A2' }], delete: [], base: { a: 3 } },
        ledger: { upsert: [{ id: 't2', name: 'T2' }], delete: ['b'], base: { b: 0 } },
      });
    });

    it('応答の rev を覚えて次の送信の base にし、消したレコードは忘れる', async () => {
      send.mockImplementationOnce(async changes => { sent.push(changes); return { revs: { products: { a: 4 }, ledger: { t2: 0 } } }; });
      const q = withRevs();
      q.enqueue('products', [rec('a', 'A2')]);
      q.enqueue('ledger', [rec('t2', 'T2')]);
      await vi.advanceTimersByTimeAsync(0);
      q.enqueue('products', [rec('a', 'A3')]);
      q.enqueue('ledger', [rec('t2', 'T2b'), rec('b', 'B again')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent[1]).toEqual({
        products: { upsert: [{ id: 'a', name: 'A3' }], delete: [], base: { a: 4 } },
        // b は前の送信で消したので、作り直しは新しいレコードとして送る (base なし)
        ledger: { upsert: [{ id: 't2', name: 'T2b' }, { id: 'b', name: 'B again' }], delete: [], base: { t2: 0 } },
      });
    });

    it('rev を返さない旧サーバーなら base を付けない (従来どおり)', async () => {
      const q = loaded();
      q.enqueue('products', [rec('a', 'A2')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent[0].products).not.toHaveProperty('base');
    });

    it('衝突 (409) は自動で再送せず conflict にし、その後の変更も送らない。discardAndReload で捨てて読み込み直す', async () => {
      send.mockRejectedValueOnce(new SaveError('別の端末で先に変更されたデータがあります（商品・ロット 1件）', false, true));
      const q = withRevs();
      q.enqueue('products', [rec('a', 'A2')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(q.getStatus()).toEqual({ state: 'conflict', message: '別の端末で先に変更されたデータがあります（商品・ロット 1件）' });
      q.enqueue('ledger', [b1, rec('t9', 'T9')]);
      await vi.runAllTimersAsync();
      expect(send).toHaveBeenCalledTimes(1);
      q.retry(); // conflict では再試行しない
      await vi.runAllTimersAsync();
      expect(send).toHaveBeenCalledTimes(1);
      expect(q.hasUnsaved()).toBe(true);

      const reload = vi.fn();
      q.discardAndReload(reload);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(q.hasUnsaved()).toBe(false); // 画面を閉じる前の確認を出さない
      expect(q.getStatus().state).toBe('loading');
    });
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

describe('postChanges / conflictSummary', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('409 は自動再送しない衝突のエラーにし、何がぶつかったかを件数で知らせる', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 409,
      json: async () => ({ error: 'conflict', conflicts: { products: ['1', '2'], 'sales-orders': ['so-1'] } }),
    })));
    const error = await postChanges({}).catch(e => e as SaveError);
    expect(error).toBeInstanceOf(SaveError);
    expect(error).toMatchObject({ conflict: true, retryable: false, message: '別の端末で先に変更されたデータがあります（商品・ロット 2件、受注 1件）' });
  });

  it('成功したら応答の rev を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, revs: { products: { a: 1 } } }) })));
    await expect(postChanges({})).resolves.toEqual({ revs: { products: { a: 1 } } });
  });

  it('conflictSummary は空のスライスを飛ばす', () => {
    expect(conflictSummary({ ledger: [], customers: ['c1'] })).toBe('得意先 1件');
    expect(conflictSummary({})).toBe('');
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

  it('別の端末が先に同じ商品を変えていたら、出庫を保存せず conflict にする (在庫も帳票も書かない)', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
    act(() => { result.current.resetToSample(); });
    await waitFor(() => expect(server.products.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));

    // この端末で一度出庫して保存できることを確かめる (応答の rev を覚えて次の base にしている)
    act(() => { result.current.shipFefo('1', 1); });
    await waitFor(() => expect(server.ledger).toHaveLength(1));
    act(() => { result.current.shipFefo('1', 1); });
    await waitFor(() => expect(server.ledger).toHaveLength(2));
    expect(result.current.saveStatus.state).toBe('idle');

    // 別の端末が商品1の在庫を変えた
    const elsewhere = { ...server.products.find(p => p.id === '1')!, name: '別の端末で変更' };
    server.editElsewhere('products', elsewhere);

    act(() => { result.current.shipFefo('1', 1); });
    await waitFor(() => expect(result.current.saveStatus.state).toBe('conflict'));
    expect(result.current.saveStatus.message).toBe('別の端末で先に変更されたデータがあります（商品・ロット 1件）');
    expect(server.products.find(p => p.id === '1')).toBe(elsewhere); // 上書きしていない
    expect(server.ledger).toHaveLength(2); // 同じ操作の帳票も書いていない

    // 衝突のあとの操作も送らない (古い内容が元なので)
    const before = server.requests.length;
    act(() => { result.current.addCategory('冷凍食品'); });
    await new Promise(r => setTimeout(r, 10));
    expect(server.requests.length).toBe(before);
  });

  it('別の端末が変えたのが別の商品なら、そのまま保存できる', async () => {
    const server = stubApi();
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
    act(() => { result.current.resetToSample(); });
    await waitFor(() => expect(server.products.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.saveStatus.state).toBe('idle'));
    const other = { ...server.products.find(p => p.id === '2')!, name: '別の端末で変更' };
    server.editElsewhere('products', other);
    act(() => { result.current.shipFefo('1', 1); });
    await waitFor(() => expect(server.ledger).toHaveLength(1));
    expect(result.current.saveStatus.state).toBe('idle');
    expect(server.products.find(p => p.id === '2')!.name).toBe('別の端末で変更');
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
