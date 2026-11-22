// ---------------------------------------------------------------------------
// 差分保存 (docs/persistence.md)
//
// 画面の状態はこれまでどおりスライス (商品+ロット / 帳票 / 請求書 …) 単位の配列で持ち、保存のたびに
// 配列全体を渡してもらう。ここで「サーバーにあるはずの内容 (baseline)」と比べて、変わったレコード
// だけを { upsert, delete } にして POST /api/changes へ送る。
//
// - 1つの操作 (同じイベントの中で呼ばれた保存すべて。例: 出庫 = 商品のロット + 帳票) は、setTimeout(0)
//   まで待ってから1回のリクエストにまとめる。Worker は1トランザクションで書くので、途中で失敗しても
//   在庫と帳票がずれない
// - 送信は1件ずつ順番に行う。送信中の変更は次の送信にまとめる
// - 通信エラー・サーバーエラー (5xx) は間隔をあけて自動で再送し、それでもだめなら error にして画面に知らせる。
//   失敗した変更は捨てずに持ち続け、retry() でまとめて送り直す
// - サーバーから読み込めていない間 (起動直後・オフライン) は何も送らない。読み込む前の画面は
//   仮のサンプルデータなので、それを元にした変更でサーバーを上書きしないため
// ---------------------------------------------------------------------------

export type SliceName =
  | 'products' | 'warehouses' | 'categories' | 'ledger' | 'inbound-plans' | 'suppliers'
  | 'purchase-order-prints' | 'customers' | 'sales-orders' | 'sales-documents' | 'payments';

export interface SliceChange {
  upsert: { id: string }[];
  delete: string[];
}

export type ChangeSet = Partial<Record<SliceName, SliceChange>>;

/** レコード id → 保存済みの内容。ref が同じなら中身も同じとみなして JSON 化を省く (状態は immutable に更新するので) */
export type Baseline = Map<string, { ref: unknown; json: string }>;

export function toBaseline(records: readonly { id: string }[]): Baseline {
  return new Map(records.map(r => [r.id, { ref: r, json: JSON.stringify(r) }]));
}

/**
 * baseline と next を比べて、追加・変更されたレコードと消えたレコードの id を返す (純粋関数)。
 * 戻り値の baseline は next を保存し終えた後の状態。
 */
export function diffRecords(baseline: Baseline, next: readonly { id: string }[]): SliceChange & { baseline: Baseline } {
  const upsert: { id: string }[] = [];
  const nextBaseline: Baseline = new Map();
  for (const record of next) {
    const prev = baseline.get(record.id);
    if (prev && prev.ref === record) {
      nextBaseline.set(record.id, prev);
      continue;
    }
    const json = JSON.stringify(record);
    nextBaseline.set(record.id, { ref: record, json });
    if (!prev || prev.json !== json) upsert.push(record);
  }
  const deleted = [...baseline.keys()].filter(id => !nextBaseline.has(id));
  return { upsert, delete: deleted, baseline: nextBaseline };
}

export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return Object.values(changes).every(c => !c || (c.upsert.length === 0 && c.delete.length === 0));
}

/** a のあとに b を行ったのと同じになるよう1つにまとめる (同じレコードは後の変更が勝つ) */
export function mergeChangeSets(a: ChangeSet, b: ChangeSet): ChangeSet {
  const result: ChangeSet = {};
  const slices = new Set([...Object.keys(a), ...Object.keys(b)] as SliceName[]);
  for (const slice of slices) {
    const upserts = new Map((a[slice]?.upsert ?? []).map(r => [r.id, r]));
    const deletes = new Set(a[slice]?.delete ?? []);
    for (const r of b[slice]?.upsert ?? []) { deletes.delete(r.id); upserts.set(r.id, r); }
    for (const id of b[slice]?.delete ?? []) { upserts.delete(id); deletes.add(id); }
    if (upserts.size > 0 || deletes.size > 0) result[slice] = { upsert: [...upserts.values()], delete: [...deletes] };
  }
  return result;
}

/**
 * 保存の状態。
 * - loading: サーバーから読み込み中 (まだ何も送らない)
 * - idle: 保存済み
 * - saving: 送信中 (retrying は自動再送の待ち)
 * - error: 自動再送しても保存できなかった。retry() で送り直せる
 * - offline: サーバーから読み込めなかった。変更は保存されない
 */
export type SaveState = 'loading' | 'idle' | 'saving' | 'retrying' | 'error' | 'offline';

export interface SaveStatus {
  state: SaveState;
  /** error のときの理由 */
  message: string;
}

/** 送信に失敗したときに投げる。retryable=false (400 など) は自動再送しない */
export class SaveError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export type SendChanges = (changes: ChangeSet) => Promise<void>;

/** 本番の送信: POST /api/changes */
export const postChanges: SendChanges = async changes => {
  let res: Response;
  try {
    res = await fetch('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
  } catch {
    throw new SaveError('サーバーと通信できませんでした', true);
  }
  if (res.ok) return;
  let detail = '';
  try { detail = (await res.json() as { error?: string }).error ?? ''; } catch { /* 本文なし */ }
  throw new SaveError(
    res.status >= 500 ? `サーバーでエラーが起きました（${res.status}）` : `保存の内容が受け付けられませんでした（${res.status}${detail ? `: ${detail}` : ''}）`,
    res.status >= 500,
  );
};

export const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 10000];

export class SaveQueue {
  private baselines = new Map<SliceName, Baseline>();
  private connected = false;
  private pending: ChangeSet = {};
  private inflight: ChangeSet | null = null;
  private attempts = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SaveStatus = { state: 'loading', message: '' };
  private listeners = new Set<() => void>();
  private readonly send: SendChanges;
  private readonly retryDelays: number[];

  constructor(send: SendChanges, retryDelays = DEFAULT_RETRY_DELAYS_MS) {
    this.send = send;
    this.retryDelays = retryDelays;
  }

  /** 読み込みをやり直す前に呼ぶ。サーバーの内容が分かるまで何も送らない */
  reset(): void {
    this.clearTimers();
    this.baselines.clear();
    this.connected = false;
    this.pending = {};
    this.inflight = null;
    this.attempts = 0;
    this.setStatus({ state: 'loading', message: '' });
  }

  /** サーバーから読み込んだ内容を「保存済み」とする。ここから先の変更だけを送る */
  load(state: Partial<Record<SliceName, readonly { id: string }[]>>): void {
    this.reset();
    for (const [slice, records] of Object.entries(state) as [SliceName, readonly { id: string }[]][]) {
      this.baselines.set(slice, toBaseline(records ?? []));
    }
    this.connected = true;
    this.setStatus({ state: 'idle', message: '' });
  }

  /** サーバーから読み込めなかった。変更は画面の中だけになる */
  markOffline(): void {
    this.reset();
    this.setStatus({ state: 'offline', message: '' });
  }

  /** スライスの最新の内容を渡す。前回からの差分を次の送信に積む */
  enqueue(slice: SliceName, records: readonly { id: string }[]): void {
    if (!this.connected) return;
    const { upsert, delete: deleted, baseline } = diffRecords(this.baselines.get(slice) ?? new Map(), records);
    this.baselines.set(slice, baseline);
    if (upsert.length === 0 && deleted.length === 0) return;
    this.pending = mergeChangeSets(this.pending, { [slice]: { upsert, delete: deleted } });
    this.scheduleFlush();
  }

  /** 自動再送をあきらめたあと (error) に、手動で送り直す */
  retry(): void {
    if (this.status.state !== 'error') return;
    this.attempts = 0;
    void this.flush();
  }

  /** まだサーバーに届いていない変更があるか (画面を閉じる前の確認用) */
  hasUnsaved(): boolean {
    return this.inflight !== null || !isEmptyChangeSet(this.pending);
  }

  getStatus = (): SaveStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private scheduleFlush(): void {
    // 同じ操作の中の保存 (setState の更新関数の中で呼ばれるものも含む) をまとめてから送る
    if (this.flushTimer || this.inflight || this.retryTimer || this.status.state === 'error') return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 0);
  }

  private async flush(): Promise<void> {
    // 失敗して残っている変更があれば、その後の変更と1つにまとめて送る (後の変更が勝つので結果は同じ)
    const changes = mergeChangeSets(this.inflight ?? {}, this.pending);
    this.pending = {};
    if (isEmptyChangeSet(changes)) {
      this.inflight = null;
      this.setStatus({ state: 'idle', message: '' });
      return;
    }
    this.inflight = changes;
    this.setStatus({ state: this.attempts > 0 ? 'retrying' : 'saving', message: '' });
    try {
      await this.send(changes);
      if (this.inflight !== changes) return; // reset() された
      this.inflight = null;
      this.attempts = 0;
      if (isEmptyChangeSet(this.pending)) this.setStatus({ state: 'idle', message: '' });
      else void this.flush();
    } catch (e) {
      if (this.inflight !== changes) return;
      const retryable = !(e instanceof SaveError) || e.retryable;
      const message = e instanceof Error ? e.message : String(e);
      if (retryable && this.attempts < this.retryDelays.length) {
        const delay = this.retryDelays[this.attempts];
        this.attempts++;
        this.setStatus({ state: 'retrying', message });
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, delay);
      } else {
        this.setStatus({ state: 'error', message });
      }
    }
  }

  private clearTimers(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.flushTimer = null;
    this.retryTimer = null;
  }

  private setStatus(status: SaveStatus): void {
    if (status.state === this.status.state && status.message === this.status.message) return;
    this.status = status;
    for (const listener of this.listeners) listener();
  }
}
