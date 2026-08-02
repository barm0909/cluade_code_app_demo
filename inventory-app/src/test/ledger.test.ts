import { describe, it, expect } from 'vitest';
import {
  EMPTY_LEDGER_FILTER,
  filterLedger,
  ledgerCsv,
  ledgerTotals,
  localDateKey,
  signedQuantity,
} from '../useInventory';
import type { LedgerFilter, StockTransaction, Warehouse } from '../useInventory';

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
];

// ローカル時刻で日付を作る (帳票の絞り込みは表示と同じローカル日付で行われるため)
const at = (local: string) => new Date(local).toISOString();

const txn = (over: Partial<StockTransaction> & Pick<StockTransaction, 'id'>): StockTransaction => ({
  date: at('2026-06-28T10:00:00'),
  type: '入荷',
  productId: 'p1',
  productName: '牛乳',
  productSku: 'ML-001',
  lotNo: '20260701',
  quantity: 10,
  note: '',
  ...over,
});

const LEDGER: StockTransaction[] = [
  txn({ id: 't1', date: at('2026-06-28T10:00:00'), type: '入荷', quantity: 10, toWarehouseId: 'wh-sales', note: 'ロット追加' }),
  txn({ id: 't2', date: at('2026-06-27T09:00:00'), type: '売上出庫', quantity: 3, fromWarehouseId: 'wh-sales' }),
  txn({ id: 't3', date: at('2026-06-26T23:30:00'), type: '移動', quantity: 5, fromWarehouseId: 'wh-sales', toWarehouseId: 'wh-hold', note: '倉庫移動' }),
  txn({ id: 't4', date: at('2026-06-25T08:00:00'), type: '廃棄', quantity: 2, productName: '食パン', productSku: 'BR-001', lotNo: '20260625', fromWarehouseId: 'wh-hold' }),
];

const withFilter = (over: Partial<LedgerFilter>): LedgerFilter => ({ ...EMPTY_LEDGER_FILTER, ...over });
const ids = (txns: StockTransaction[]) => txns.map(t => t.id);

describe('localDateKey', () => {
  it('ISO文字列をローカルのYYYY-MM-DDに変換する', () => {
    expect(localDateKey(at('2026-06-28T23:30:00'))).toBe('2026-06-28');
    expect(localDateKey(at('2026-06-28T00:15:00'))).toBe('2026-06-28');
  });
});

describe('filterLedger', () => {
  it('空の条件では全件を返す', () => {
    expect(filterLedger(LEDGER, EMPTY_LEDGER_FILTER)).toHaveLength(4);
  });

  it('キーワードで商品名・SKU・ロットNoを部分一致で絞る', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ keyword: '食パン' })))).toEqual(['t4']);
    expect(ids(filterLedger(LEDGER, withFilter({ keyword: 'ml-001' })))).toEqual(['t1', 't2', 't3']);
    expect(ids(filterLedger(LEDGER, withFilter({ keyword: '20260625' })))).toEqual(['t4']);
  });

  it('キーワードの前後の空白は無視される', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ keyword: '  BR-001  ' })))).toEqual(['t4']);
  });

  it('該当なしのキーワードでは空配列になる', () => {
    expect(filterLedger(LEDGER, withFilter({ keyword: 'チーズ' }))).toEqual([]);
  });

  it('開始日・終了日はその日を含めて絞る', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ from: '2026-06-27' })))).toEqual(['t1', 't2']);
    expect(ids(filterLedger(LEDGER, withFilter({ to: '2026-06-26' })))).toEqual(['t3', 't4']);
    expect(ids(filterLedger(LEDGER, withFilter({ from: '2026-06-26', to: '2026-06-27' })))).toEqual(['t2', 't3']);
  });

  it('同日の記録は時刻に関わらず範囲に含まれる (23:30も当日扱い)', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ from: '2026-06-26', to: '2026-06-26' })))).toEqual(['t3']);
  });

  it('区分で絞れる', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ type: '廃棄' })))).toEqual(['t4']);
    expect(ids(filterLedger(LEDGER, withFilter({ type: '移動' })))).toEqual(['t3']);
  });

  it('倉庫は移動元・移動先のどちらかに一致すればヒットする', () => {
    expect(ids(filterLedger(LEDGER, withFilter({ warehouseId: 'wh-sales' })))).toEqual(['t1', 't2', 't3']);
    expect(ids(filterLedger(LEDGER, withFilter({ warehouseId: 'wh-hold' })))).toEqual(['t3', 't4']);
  });

  it('複数条件はAND条件で絞られる', () => {
    const filtered = filterLedger(LEDGER, withFilter({ warehouseId: 'wh-sales', type: '売上出庫', from: '2026-06-27' }));
    expect(ids(filtered)).toEqual(['t2']);
  });

  it('元の配列を変更しない', () => {
    const before = [...LEDGER];
    filterLedger(LEDGER, withFilter({ type: '入荷' }));
    expect(LEDGER).toEqual(before);
  });
});

describe('signedQuantity / ledgerTotals', () => {
  it('出庫系はマイナス、入庫・移動はプラスの数量になる', () => {
    expect(signedQuantity(LEDGER[0])).toBe(10); // 入荷
    expect(signedQuantity(LEDGER[1])).toBe(-3); // 売上出庫
    expect(signedQuantity(LEDGER[2])).toBe(5); // 移動
    expect(signedQuantity(LEDGER[3])).toBe(-2); // 廃棄
  });

  it('区分ごとに数量を合計する', () => {
    expect(ledgerTotals(LEDGER)).toEqual({ inbound: 10, outbound: 5, move: 5 });
  });

  it('空の帳票では全て0になる', () => {
    expect(ledgerTotals([])).toEqual({ inbound: 0, outbound: 0, move: 0 });
  });
});

describe('ledgerCsv', () => {
  it('1行目がヘッダー行になっている', () => {
    const lines = ledgerCsv(LEDGER, WAREHOUSES).split('\n');
    expect(lines[0]).toBe('日時,区分,商品名,SKU,ロットNo,数量,移動元倉庫,移動先倉庫,備考');
    expect(lines).toHaveLength(5);
  });

  it('倉庫idが倉庫名に解決される', () => {
    const line = ledgerCsv(LEDGER, WAREHOUSES).split('\n')[3]; // t3 (移動)
    expect(line.split(',').slice(6, 8)).toEqual(['販売倉庫', '保留倉庫']);
  });

  it('マスタにない倉庫idはidのまま出力される', () => {
    const line = ledgerCsv([txn({ id: 'x', toWarehouseId: 'wh-unknown' })], WAREHOUSES).split('\n')[1];
    expect(line.split(',')[7]).toBe('wh-unknown');
  });

  it('出庫はマイナスの数量で出力される', () => {
    const lines = ledgerCsv(LEDGER, WAREHOUSES).split('\n');
    expect(lines[1].split(',')[5]).toBe('10');
    expect(lines[2].split(',')[5]).toBe('-3');
  });

  it('日時がローカル時刻で整形される', () => {
    const line = ledgerCsv([LEDGER[0]], WAREHOUSES).split('\n')[1];
    expect(line.split(',')[0]).toBe('2026/06/28 10:00');
  });

  it('カンマや引用符を含む値は引用符でエスケープされる', () => {
    const line = ledgerCsv([txn({ id: 'x', productName: '牛乳,低脂肪', note: '棚卸"差異"' })], WAREHOUSES).split('\n')[1];
    expect(line).toContain('"牛乳,低脂肪"');
    expect(line).toContain('"棚卸""差異"""');
  });

  it('記録が0件でもヘッダー行だけは出力される', () => {
    expect(ledgerCsv([], WAREHOUSES).split('\n')).toHaveLength(1);
  });
});
