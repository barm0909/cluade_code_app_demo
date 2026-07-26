import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { daysUntilExpiry, totalQuantity, generateLotNo, normalizeJanCode, isValidJanCode, DEFAULT_WAREHOUSE_ID } from '../useInventory';
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
    id: '1', name: 'test', sku: 'T-001', categoryId: 'cat-test',
    minQuantity: 5, price: 100, costPrice: 50, updatedAt: '',
    lots: quantities.map((q, i) => ({ id: String(i), lotNo: `2026000${i}`, quantity: q, warehouseId: DEFAULT_WAREHOUSE_ID })),
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

describe('normalizeJanCode', () => {
  it('半角数字はそのまま返す', () => {
    expect(normalizeJanCode('4901234567894')).toBe('4901234567894');
  });

  it('全角数字を半角に変換する', () => {
    expect(normalizeJanCode('４９０１２３４５６７８９４')).toBe('4901234567894');
  });

  it('ハイフン・空白などの区切り文字を除去する', () => {
    expect(normalizeJanCode('49-0123456 7894')).toBe('4901234567894');
  });

  it('13桁を超える入力は13桁に切り詰める', () => {
    expect(normalizeJanCode('49012345678941234')).toBe('4901234567894');
  });

  it('空文字はそのまま空文字を返す', () => {
    expect(normalizeJanCode('')).toBe('');
  });
});

describe('isValidJanCode', () => {
  it('未入力 (空文字) は有効とみなす', () => {
    expect(isValidJanCode('')).toBe(true);
  });

  it('8桁は有効', () => {
    expect(isValidJanCode('49123456')).toBe(true);
  });

  it('13桁は有効', () => {
    expect(isValidJanCode('4901234567894')).toBe(true);
  });

  it('12桁は無効', () => {
    expect(isValidJanCode('490123456789')).toBe(false);
  });

  it('数字以外を含む場合は無効', () => {
    expect(isValidJanCode('49012345678a')).toBe(false);
  });
});
