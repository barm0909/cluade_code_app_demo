import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductModal } from '../ProductModal';

const defaultProps = {
  product: null,
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
    const product = { id: '1', name: 'テスト', sku: 'T-001', category: '食品', minQuantity: 5, price: 100, costPrice: 60, lots: [], updatedAt: '' };
    render(<ProductModal {...defaultProps} product={product} />);
    expect(screen.getByText('商品を編集')).toBeInTheDocument();
  });

  it('既存商品の値がフォームに反映される', () => {
    const product = { id: '1', name: '牛乳', sku: 'ML-001', category: '乳製品', minQuantity: 5, price: 198, costPrice: 130, lots: [], updatedAt: '' };
    render(<ProductModal {...defaultProps} product={product} />);
    expect(screen.getByDisplayValue('牛乳')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ML-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('乳製品')).toBeInTheDocument();
    expect(screen.getByDisplayValue('198')).toBeInTheDocument();
    expect(screen.getByDisplayValue('130')).toBeInTheDocument();
  });
});

describe('ProductModal — 保存', () => {
  it('フォームを入力して保存するとonSaveとonCloseが呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ProductModal product={null} onSave={onSave} onClose={onClose} />);

    await user.type(screen.getByLabelText(/商品名/), 'テスト商品');
    await user.type(screen.getByLabelText(/SKU/), 'T-999');
    await user.type(screen.getByLabelText(/カテゴリ/), '食品');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'テスト商品', sku: 'T-999', category: '食品' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('保存時にonSaveへ渡すデータに価格と原価が含まれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProductModal product={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/商品名/), '商品');
    await user.type(screen.getByLabelText(/SKU/), 'A-001');
    await user.type(screen.getByLabelText(/カテゴリ/), '食品');
    const priceInput = screen.getByLabelText(/販売定価/);
    await user.clear(priceInput);
    await user.type(priceInput, '500');
    const costInput = screen.getByLabelText(/原価/);
    await user.clear(costInput);
    await user.type(costInput, '300');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ price: 500, costPrice: 300 }));
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
