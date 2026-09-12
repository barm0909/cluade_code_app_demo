import { describe, it, expect } from 'vitest';
import {
  purchaseOrderPrintGroups,
  purchaseOrderHistoryCsv,
  EMPTY_PURCHASE_ORDER_HISTORY_FILTER,
} from '../useInventory';
import type { PurchaseOrderPrintItem } from '../useInventory';

const item = (over: Partial<PurchaseOrderPrintItem> & { id: string; printGroupId: string }): PurchaseOrderPrintItem => ({
  printedAt: '2026-03-01T09:00:00.000Z',
  supplierId: 'sup-yamada',
  supplierName: '山田商店',
  supplierAddress: '東京都',
  supplierContact: '担当太郎',
  supplierPhone: '03-0000-0000',
  orderDate: '2026-03-01',
  senderName: '自社商店',
  senderAddress: '大阪府',
  senderPhone: '06-0000-0000',
  senderContact: '発注担当',
  inboundPlanId: 'ip1',
  productName: '牛乳',
  productSku: 'ML-001',
  expectedDate: '2026-03-05',
  quantity: 10,
  unitPrice: 100,
  amount: 1000,
  ...over,
});

describe('purchaseOrderPrintGroups', () => {
  it('printGroupId が同じ行を1つの発注書にまとめ、印刷日時の新しい順に返す', () => {
    const groups = purchaseOrderPrintGroups([
      item({ id: '1', printGroupId: 'g1', printedAt: '2026-03-01T00:00:00.000Z', productName: '牛乳', quantity: 10, amount: 1000 }),
      item({ id: '2', printGroupId: 'g1', printedAt: '2026-03-01T00:00:00.000Z', productName: '食パン', quantity: 5, amount: 500 }),
      item({ id: '3', printGroupId: 'g2', printedAt: '2026-03-02T00:00:00.000Z', productName: 'チーズ', quantity: 3, amount: 900 }),
    ]);

    expect(groups.map(g => g.printGroupId)).toEqual(['g2', 'g1']); // 新しい順
    const g1 = groups.find(g => g.printGroupId === 'g1')!;
    expect(g1.items).toHaveLength(2);
    expect(g1.totalQuantity).toBe(15);
    expect(g1.totalAmount).toBe(1500);
  });

  it('仕入先・期間・キーワード (仕入先名または明細の商品名/SKU) で絞り込める', () => {
    const prints = [
      item({ id: '1', printGroupId: 'g1', supplierId: 'sup-yamada', supplierName: '山田商店', printedAt: '2026-03-01T00:00:00.000Z', productName: '牛乳', productSku: 'ML-001' }),
      item({ id: '2', printGroupId: 'g2', supplierId: 'sup-asahi', supplierName: '朝日ベーカリー', printedAt: '2026-03-10T00:00:00.000Z', productName: '食パン', productSku: 'BR-001' }),
    ];
    const ids = (filter: Partial<typeof EMPTY_PURCHASE_ORDER_HISTORY_FILTER>) =>
      purchaseOrderPrintGroups(prints, { ...EMPTY_PURCHASE_ORDER_HISTORY_FILTER, ...filter }).map(g => g.printGroupId);

    expect(ids({ supplierId: 'sup-asahi' })).toEqual(['g2']);
    expect(ids({ keyword: '朝日' })).toEqual(['g2']);
    expect(ids({ keyword: 'ML-001' })).toEqual(['g1']);
    expect(ids({ from: '2026-03-05' })).toEqual(['g2']);
    expect(ids({ to: '2026-03-05' })).toEqual(['g1']);
  });

  it('印刷履歴が0件なら空配列を返す', () => {
    expect(purchaseOrderPrintGroups([])).toEqual([]);
  });
});

describe('purchaseOrderHistoryCsv', () => {
  it('ヘッダーと明細1行ごとに1行を出力する', () => {
    const groups = purchaseOrderPrintGroups([
      item({ id: '1', printGroupId: 'g1', printedAt: '2026-03-01T09:00:00.000Z' }),
    ]);
    const lines = purchaseOrderHistoryCsv(groups).split('\n');

    expect(lines[0]).toBe('印刷日時,発注日,仕入先,商品名,SKU,入荷予定日,数量,単価,金額');
    expect(lines[1]).toContain(',2026-03-01,山田商店,牛乳,ML-001,2026-03-05,10,100,1000');
  });

  it('履歴が0件でもヘッダーだけ返す', () => {
    expect(purchaseOrderHistoryCsv([])).toBe('印刷日時,発注日,仕入先,商品名,SKU,入荷予定日,数量,単価,金額');
  });
});
