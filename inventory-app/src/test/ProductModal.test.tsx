import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductModal } from '../ProductModal';

const TEST_CATEGORIES = [
  { id: 'cat-food', name: '食品' },
  { id: 'cat-dairy', name: '乳製品' },
];

const defaultProps = {
  product: null,
  categories: TEST_CATEGORIES,
  onSave: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ProductModal — 表示', () => {
  it('新規追加モードで「商品を追加」タイトルが表示される', () => {
    render(<ProductModal {...defaultProps} />);
    expect(screen.getByText('商品を追加')).toBeInTheDocument();
  });

  it('編集モードで「商品を編集」タイトルが表示される', () => {
    const product = { id: '1', name: 'テスト', sku: 'T-001', categoryId: 'cat-food', minQuantity: 5, price: 100, costPrice: 60, lots: [], updatedAt: '' };
    render(<ProductModal {...defaultProps} product={product} />);
    expect(screen.getByText('商品を編集')).toBeInTheDocument();
  });

  it('既存商品の値がフォームに反映される', () => {
    const product = { id: '1', name: '牛乳', sku: 'ML-001', janCode: '4901234567894', categoryId: 'cat-dairy', minQuantity: 5, price: 198, costPrice: 130, lots: [], updatedAt: '' };
    render(<ProductModal {...defaultProps} product={product} />);
    expect(screen.getByDisplayValue('牛乳')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ML-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4901234567894')).toBeInTheDocument();
    expect(screen.getByLabelText(/カテゴリ/)).toHaveValue('cat-dairy');
    expect(screen.getByDisplayValue('198')).toBeInTheDocument();
    expect(screen.getByDisplayValue('130')).toBeInTheDocument();
  });

  it('JANコードのない既存商品はJANコード欄が空になる', () => {
    const product = { id: '1', name: 'ラベル', sku: 'LB-001', categoryId: 'cat-food', minQuantity: 5, price: 5, costPrice: 2, lots: [], updatedAt: '' };
    render(<ProductModal {...defaultProps} product={product} />);
    expect(screen.getByLabelText(/JANコード/)).toHaveValue('');
  });
});

describe('ProductModal — 保存', () => {
  it('フォームを入力して保存するとonSaveとonCloseが呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ProductModal product={null} categories={TEST_CATEGORIES} onSave={onSave} onClose={onClose} />);

    await user.type(screen.getByLabelText(/商品名/), 'テスト商品');
    await user.type(screen.getByLabelText(/SKU/), 'T-999');
    await user.selectOptions(screen.getByLabelText(/カテゴリ/), 'cat-food');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'テスト商品', sku: 'T-999', categoryId: 'cat-food' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('保存時にonSaveへ渡すデータに価格と原価が含まれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProductModal product={null} categories={TEST_CATEGORIES} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/商品名/), '商品');
    await user.type(screen.getByLabelText(/SKU/), 'A-001');
    await user.selectOptions(screen.getByLabelText(/カテゴリ/), 'cat-food');
    const priceInput = screen.getByLabelText(/販売定価/);
    await user.clear(priceInput);
    await user.type(priceInput, '500');
    const costInput = screen.getByLabelText(/原価/);
    await user.clear(costInput);
    await user.type(costInput, '300');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ price: 500, costPrice: 300 }));
  });

  it('JANコードを入力して保存するとonSaveへ渡される', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProductModal product={null} categories={TEST_CATEGORIES} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/商品名/), 'JAN商品');
    await user.type(screen.getByLabelText(/SKU/), 'J-001');
    await user.selectOptions(screen.getByLabelText(/カテゴリ/), 'cat-food');
    await user.type(screen.getByLabelText(/JANコード/), '4901234567894');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ janCode: '4901234567894' }));
  });

  it('JANコード未入力で保存するとjanCodeはundefinedになる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProductModal product={null} categories={TEST_CATEGORIES} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/商品名/), 'JANなし商品');
    await user.type(screen.getByLabelText(/SKU/), 'J-002');
    await user.selectOptions(screen.getByLabelText(/カテゴリ/), 'cat-food');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ janCode: undefined }));
  });
});

describe('ProductModal — キャンセル', () => {
  it('キャンセルボタンでonCloseが呼ばれる', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProductModal {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByText('キャンセル'));
    expect(onClose).toHaveBeenCalled();
  });

  it('オーバーレイクリックでonCloseが呼ばれる', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProductModal {...defaultProps} onClose={onClose} />);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });
});
