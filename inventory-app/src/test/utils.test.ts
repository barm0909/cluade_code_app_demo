import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { daysUntilExpiry, totalQuantity, generateLotNo } from '../useInventory';
import type { Product } from '../useInventory';

const FIXED_NOW = new Date('2026-06-27T00:00:00.000Z');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('daysUntilExpiry', () => {
  it('今日の日付は0日を返す', () => {
    expect(daysUntilExpiry('2026-06-27')).toBe(0);
  });

  it('明日は1日を返す', () => {
    expect(daysUntilExpiry('2026-06-28')).toBe(1);
  });

  it('昨日は-1日を返す', () => {
    expect(daysUntilExpiry('2026-06-26')).toBe(-1);
  });

  it('7日後は7を返す', () => {
    expect(daysUntilExpiry('2026-07-04')).toBe(7);
  });
});

describe('totalQuantity', () => {
  const makeProduct = (quantities: number[]): Product => ({
    id: '1', name: 'test', sku: 'T-001', category: 'test',
    minQuantity: 5, price: 100, updatedAt: '',
    lots: quantities.map((q, i) => ({ id: String(i), lotNo: `2026000${i}`, quantity: q })),
  });

  it('ロットが0件のとき0を返す', () => {
    expect(totalQuantity(makeProduct([]))).toBe(0);
  });

  it('単一ロットの合計を返す', () => {
    expect(totalQuantity(makeProduct([10]))).toBe(10);
  });

  it('複数ロットの合計を返す', () => {
    expect(totalQuantity(makeProduct([10, 5, 3]))).toBe(18);
  });
});

describe('generateLotNo', () => {
  it('賞味期限を渡すとYYYYMMDD形式で返す', () => {
    expect(generateLotNo('2026-12-31')).toBe('20261231');
  });

  it('賞味期限なしのとき今日の日付をYYYYMMDD形式で返す', () => {
    expect(generateLotNo()).toBe('20260627');
  });

  it('LOT-プレフィックスを含まない', () => {
    expect(generateLotNo('2026-12-31')).not.toMatch(/^LOT-/);
  });
});
