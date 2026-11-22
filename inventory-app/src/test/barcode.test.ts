import { describe, it, expect } from 'vitest';
import { BarcodeFormat, BitArray, DecodeHintType, MultiFormatOneDReader } from '@zxing/library';
import {
  eanModules,
  findProductByScan,
  isValidJanCode,
  janCheckDigit,
  janCodeError,
  normalizeScanCode,
} from '../useInventory';
import type { Product } from '../useInventory';

const PRODUCTS: Product[] = [
  { id: 'p1', name: '牛乳', sku: 'ML-001', janCode: '4901234567894', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, updatedAt: '', lots: [] },
  { id: 'p2', name: '値札ラベル', sku: 'LB-R01', categoryId: 'c', minQuantity: 0, price: 5, costPrice: 2, updatedAt: '', lots: [] },
  { id: 'p3', name: 'ガム', sku: 'GM-001', janCode: '49123456', categoryId: 'c', minQuantity: 0, price: 100, costPrice: 50, updatedAt: '', lots: [] },
];

describe('JANコードのチェックデジット', () => {
  it('EAN-13 / EAN-8 の最後の1桁を計算する', () => {
    expect(janCheckDigit('490123456789')).toBe(4);
    expect(janCheckDigit('491234567890')).toBe(4);
    expect(janCheckDigit('4912345')).toBe(6);
    expect(janCheckDigit('400638133393')).toBe(1); // 4006381333931 (よく使われる例)
  });

  it('桁数とチェックデジットを検証する (未入力は可)', () => {
    expect(janCodeError('')).toBe('');
    expect(janCodeError('4901234567894')).toBe('');
    expect(janCodeError('49123456')).toBe('');
    expect(janCodeError('490123456789')).toMatch(/8桁または13桁/);
    expect(janCodeError('4901234567890')).toMatch(/チェックデジット/);
    expect(isValidJanCode('4901234567890')).toBe(false);
    expect(isValidJanCode('4006381333931')).toBe(true);
  });
});

describe('findProductByScan', () => {
  it('JANコードで商品を探す (全角数字・区切り文字は取り除く)', () => {
    expect(normalizeScanCode('４９０１２３４-５６７８９４\n')).toBe('4901234567894');
    expect(findProductByScan(PRODUCTS, '4901234567894').product?.id).toBe('p1');
    expect(findProductByScan(PRODUCTS, ' ４９０１２３４５６７８９４ ').product?.id).toBe('p1');
    expect(findProductByScan(PRODUCTS, '49123456').product?.id).toBe('p3');
  });

  it('JAN のない商品は SKU (大文字小文字を区別しない) でも呼び出せる', () => {
    expect(findProductByScan(PRODUCTS, 'lb-r01').product?.id).toBe('p2');
  });

  it('見つからないときは理由を返す', () => {
    expect(findProductByScan(PRODUCTS, '4006381333931')).toMatchObject({ product: null, code: '4006381333931', error: expect.stringMatching(/未登録のJANコード/) });
    expect(findProductByScan(PRODUCTS, '4006381333930').error).toMatch(/JANコードとして読み取れませんでした/);
    expect(findProductByScan(PRODUCTS, 'XYZ').error).toMatch(/「XYZ」に一致する商品がありません/);
    expect(findProductByScan(PRODUCTS, '   ').error).toBe('');
  });
});

describe('eanModules', () => {
  // ZXing の読み取り器 (独立した実装) で、描いたバーの並びを読み戻せるかを確かめる
  const decode = (code: string) => {
    const modules = eanModules(code)!;
    const quiet = 12;
    const row = new BitArray(modules.length + quiet * 2);
    [...modules].forEach((m, i) => { if (m === '1') row.set(quiet + i); });
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]]]);
    const result = new MultiFormatOneDReader(hints).decodeRow(0, row, hints);
    expect(result.getBarcodeFormat()).toBe(code.length === 13 ? BarcodeFormat.EAN_13 : BarcodeFormat.EAN_8);
    return result.getText();
  };

  it('EAN-13 は 95 モジュール、EAN-8 は 67 モジュールで、両端と中央のガードを持つ', () => {
    const m13 = eanModules('4901234567894')!;
    expect(m13).toHaveLength(95);
    expect([m13.slice(0, 3), m13.slice(45, 50), m13.slice(-3)]).toEqual(['101', '01010', '101']);
    expect(eanModules('49123456')).toHaveLength(67);
  });

  it.each(['4901234567894', '4912345678904', '4901987654322', '4006381333931', '0123456789012', '49123456', '96385074'])(
    'バーの並びを ZXing で読み戻すと同じ JAN になる: %s',
    code => { expect(decode(code)).toBe(code); },
  );

  it('JAN として正しくない値は描かない', () => {
    expect(eanModules('')).toBeNull();
    expect(eanModules('4901234567890')).toBeNull();
    expect(eanModules('12345')).toBeNull();
  });
});
