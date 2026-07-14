import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductMasterView } from '../ProductMasterView';
import App from '../App';
import type { Product } from '../useInventory';

// localStorage モック（既存テストと同じパターン）
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: '1',
  name: '牛乳',
  sku: 'ML-001',
  categoryId: 'cat-dairy',
  minQuantity: 5,
  price: 198,
  costPrice: 130,
  lots: [],
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const TEST_CATEGORIES = [
  { id: 'cat-dairy', name: '乳製品' },
  { id: 'cat-bread', name: 'パン' },
];

const defaultProps = {
  products: [makeProduct()],
  categories: TEST_CATEGORIES,
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onAddClick: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ProductMasterView — 表示', () => {
  it('全商品の商品名とSKUが表示される', () => {
    const products = [
      makeProduct(),
      makeProduct({ id: '2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread' }),
    ];
    render(<ProductMasterView {...defaultProps} products={products} />);
    expect(screen.getByText('牛乳')).toBeInTheDocument();
    expect(screen.getByText('ML-001')).toBeInTheDocument();
    expect(screen.getByText('食パン')).toBeInTheDocument();
    expect(screen.getByText('BR-001')).toBeInTheDocument();
  });

  it('マスタ項目（カテゴリ・最低在庫数・販売定価・原価）が行に表示される', () => {
    render(<ProductMasterView {...defaultProps} />);
    const row = screen.getByText('牛乳').closest('tr')!;
    expect(within(row).getByText('乳製品')).toBeInTheDocument();
    expect(within(row).getByText('5')).toBeInTheDocument();
    expect(within(row).getByText('¥198')).toBeInTheDocument();
    expect(within(row).getByText('¥130')).toBeInTheDocument();
  });

  it('商品が0件のとき空メッセージが表示される', () => {
    render(<ProductMasterView {...defaultProps} products={[]} />);
    expect(screen.getByText('商品がありません')).toBeInTheDocument();
  });
});

describe('ProductMasterView — インライン編集', () => {
  it('編集ボタンをクリックすると入力欄が表示され既存値が入っている', async () => {
    const user = userEvent.setup();
    render(<ProductMasterView {...defaultProps} />);

    await user.click(screen.getByText('編集'));

    expect(screen.getByLabelText('商品名')).toHaveValue('牛乳');
    expect(screen.getByLabelText('SKU')).toHaveValue('ML-001');
    expect(screen.getByLabelText('カテゴリ')).toHaveValue('cat-dairy');
    expect(screen.getByLabelText('最低在庫数')).toHaveValue(5);
    expect(screen.getByLabelText('販売定価')).toHaveValue(198);
    expect(screen.getByLabelText('原価')).toHaveValue(130);
  });

  it('値を変更して保存するとonUpdateが商品IDと変更後の値で呼ばれる', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductMasterView {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByText('編集'));
    const nameInput = screen.getByLabelText('商品名');
    await user.clear(nameInput);
    await user.type(nameInput, '低脂肪牛乳');
    await user.click(screen.getByText('保存'));

    expect(onUpdate).toHaveBeenCalledWith('1', expect.objectContaining({
      name: '低脂肪牛乳',
      sku: 'ML-001',
      categoryId: 'cat-dairy',
    }));
  });

  it('数値項目（最低在庫数・販売定価・原価）は数値としてonUpdateに渡される', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductMasterView {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByText('編集'));
    const minQtyInput = screen.getByLabelText('最低在庫数');
    await user.clear(minQtyInput);
    await user.type(minQtyInput, '10');
    const priceInput = screen.getByLabelText('販売定価');
    await user.clear(priceInput);
    await user.type(priceInput, '250');
    const costInput = screen.getByLabelText('原価');
    await user.clear(costInput);
    await user.type(costInput, '150');
    await user.click(screen.getByText('保存'));

    expect(onUpdate).toHaveBeenCalledWith('1', expect.objectContaining({
      minQuantity: 10,
      price: 250,
      costPrice: 150,
    }));
  });

  it('保存すると編集モードが終了し入力欄が消える', async () => {
    const user = userEvent.setup();
    render(<ProductMasterView {...defaultProps} />);

    await user.click(screen.getByText('編集'));
    await user.click(screen.getByText('保存'));

    expect(screen.queryByLabelText('商品名')).not.toBeInTheDocument();
  });

  it('キャンセルするとonUpdateが呼ばれず元の表示に戻る', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductMasterView {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByText('編集'));
    const nameInput = screen.getByLabelText('商品名');
    await user.clear(nameInput);
    await user.type(nameInput, '変更した名前');
    await user.click(screen.getByText('キャンセル'));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('商品名')).not.toBeInTheDocument();
    expect(screen.getByText('牛乳')).toBeInTheDocument();
  });

  it('複数商品のうち2件目を編集するとonUpdateに2件目のIDが渡される', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const products = [
      makeProduct(),
      makeProduct({ id: '2', name: '食パン', sku: 'BR-001', categoryId: 'cat-bread' }),
    ];
    render(<ProductMasterView {...defaultProps} products={products} onUpdate={onUpdate} />);

    await user.click(screen.getAllByText('編集')[1]);
    const nameInput = screen.getByLabelText('商品名');
    await user.clear(nameInput);
    await user.type(nameInput, '全粒粉パン');
    await user.click(screen.getByText('保存'));

    expect(onUpdate).toHaveBeenCalledWith('2', expect.objectContaining({ name: '全粒粉パン' }));
  });
});

describe('ProductMasterView — バリデーション', () => {
  it('商品名を空にして保存するとonUpdateが呼ばれない', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductMasterView {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByText('編集'));
    await user.clear(screen.getByLabelText('商品名'));
    await user.click(screen.getByText('保存'));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('SKUを空にして保存するとonUpdateが呼ばれない', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductMasterView {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByText('編集'));
    await user.clear(screen.getByLabelText('SKU'));
    await user.click(screen.getByText('保存'));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('ProductMasterView — 商品追加', () => {
  it('「+ 商品追加」ボタンが表示され、クリックするとonAddClickが呼ばれる', async () => {
    const user = userEvent.setup();
    const onAddClick = vi.fn();
    render(<ProductMasterView {...defaultProps} onAddClick={onAddClick} />);

    await user.click(screen.getByText('+ 商品追加'));

    expect(onAddClick).toHaveBeenCalled();
  });
});

describe('ProductMasterView — 削除', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('削除ボタンで確認してOKするとonDeleteが商品IDで呼ばれる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ProductMasterView {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByText('削除'));

    expect(onDelete).toHaveBeenCalledWith('1');
  });

  it('確認ダイアログでキャンセルするとonDeleteが呼ばれない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ProductMasterView {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByText('削除'));

    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('App — 商品マスタタブ', () => {
  beforeEach(() => { localStorageMock.clear(); });

  it('「商品マスタ」タブが表示される', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '商品マスタ' })).toBeInTheDocument();
  });

  it('タブをクリックすると商品マスタ画面が表示される', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '商品マスタ' }));

    // 商品マスタ画面にだけ「最低在庫数」列がある（在庫一覧には無い）
    expect(screen.getByText('最低在庫数')).toBeInTheDocument();
    // サンプルデータの商品が表示される
    expect(screen.getByText('牛乳')).toBeInTheDocument();
  });

  it('在庫一覧タブでは商品追加ボタンが表示されない', () => {
    render(<App />);
    expect(screen.queryByText('+ 商品追加')).not.toBeInTheDocument();
  });

  it('商品マスタタブの商品追加ボタンから商品追加モーダルが開く', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '商品マスタ' }));
    await user.click(screen.getByText('+ 商品追加'));

    expect(screen.getByText('商品を追加')).toBeInTheDocument();
  });
});
