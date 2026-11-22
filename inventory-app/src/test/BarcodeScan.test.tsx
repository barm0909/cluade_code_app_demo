import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanInput } from '../ScanInput';
import { StocktakeView } from '../StocktakeView';
import { SalesEntryModal } from '../SalesEntryModal';
import { ShipFefoModal } from '../ShipFefoModal';
import { InboundPlanView } from '../InboundPlanView';
import { ProductModal } from '../ProductModal';
import { BarcodeSheetModal } from '../BarcodeSheetModal';
import type { Category, InboundPlan, Product, Warehouse } from '../useInventory';

// スキャナーはキーボードとして「数字を一気に入力 → Enter」を送るので、テストでも同じ操作で再現する
const scan = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, code: string) => {
  await user.type(field, `${code}{Enter}`);
};

const WAREHOUSES: Warehouse[] = [
  { id: 'wh-a', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-b', name: '保留倉庫', color: '#ff9800' },
];
const CATEGORIES: Category[] = [{ id: 'c', name: '乳製品' }];

const PRODUCTS: Product[] = [
  {
    id: 'p1', name: '牛乳', sku: 'ML-001', janCode: '4901234567894', categoryId: 'c', minQuantity: 0, price: 200, costPrice: 130, taxRate: 8, updatedAt: '',
    lots: [
      { id: 'l1', lotNo: '20990101', expiryDate: '2099-01-01', quantity: 10, warehouseId: 'wh-a' },
      { id: 'l2', lotNo: '20990201', expiryDate: '2099-02-01', quantity: 5, warehouseId: 'wh-b' },
    ],
  },
  {
    id: 'p2', name: 'チーズ', sku: 'CS-001', janCode: '4901987654322', categoryId: 'c', minQuantity: 0, price: 350, costPrice: 220, taxRate: 8, updatedAt: '',
    lots: [{ id: 'l3', lotNo: '20990301', expiryDate: '2099-03-01', quantity: 4, warehouseId: 'wh-a' }],
  },
  {
    id: 'p3', name: '値札ラベル', sku: 'LB-R01', janCode: '49123456', categoryId: 'c', minQuantity: 0, price: 5, costPrice: 2, kind: '資材', updatedAt: '',
    lots: [{ id: 'l4', lotNo: '20260101', quantity: 100, warehouseId: 'wh-a' }],
  },
];

beforeEach(() => { vi.restoreAllMocks(); });

describe('ScanInput', () => {
  it('Enter で読み取った文字列を渡し、結果を表示して入力欄を空にする', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn(() => ({ message: '牛乳 を表示しました', tone: 'ok' as const }));
    render(<ScanInput onScan={onScan} />);
    const field = screen.getByLabelText('バーコード');
    await scan(user, field, '4901234567894');
    expect(onScan).toHaveBeenCalledWith('4901234567894');
    expect(screen.getByRole('status')).toHaveTextContent('牛乳 を表示しました');
    expect(field).toHaveValue('');
  });

  it('フォームの中でも Enter でフォームを送信しない', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><ScanInput onScan={() => undefined} /><button type="submit">送信</button></form>);
    await scan(user, screen.getByLabelText('バーコード'), '4901234567894');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('読み取ると何が起きるかを入力欄の下に出し、読み取った結果を出している間は結果に場所を譲る', async () => {
    const user = userEvent.setup();
    render(<ScanInput hint="その商品を選びます" onScan={() => ({ message: '牛乳 を選びました', tone: 'ok' })} />);
    const field = screen.getByLabelText('バーコード');
    expect(screen.getByText('スキャンすると：その商品を選びます')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('スキャンすると：その商品を選びます');
    await scan(user, field, '4901234567894');
    expect(screen.queryByText('スキャンすると：その商品を選びます')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('牛乳 を選びました');
    // マウスを乗せれば説明は引き続き見られる
    expect(field).toHaveAttribute('title', 'スキャンすると：その商品を選びます');
  });

  it('各画面の読み取り欄には、その画面で何が起きるかの説明がある', () => {
    render(<StocktakeView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} onApply={() => 0} />);
    expect(screen.getByLabelText('棚卸のバーコード')).toHaveAccessibleDescription(/実数が 1 増えます/);
  });

  it('空のまま Enter しても何もしない', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<ScanInput onScan={onScan} />);
    await user.type(screen.getByLabelText('バーコード'), '{Enter}');
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe('棚卸のスキャン数え', () => {
  const renderStocktake = () => render(
    <StocktakeView products={PRODUCTS} categories={CATEGORIES} warehouses={WAREHOUSES} onApply={() => 0} />,
  );
  const countOf = (name: string, lotNo: string) => screen.getByLabelText(`${name} ロット${lotNo} の実数`);

  it('ロットが1つの商品は、読むたびに実数が 1 ずつ増える', async () => {
    const user = userEvent.setup();
    renderStocktake();
    const field = screen.getByLabelText('棚卸のバーコード');
    await scan(user, field, '4901987654322');
    await scan(user, field, '4901987654322');
    expect(countOf('チーズ', '20990301')).toHaveValue(2);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('チーズ ロット20990301：2個目');
  });

  it('ロットが複数ある商品は、最初に選んだロットに数え続ける', async () => {
    const user = userEvent.setup();
    renderStocktake();
    const field = screen.getByLabelText('棚卸のバーコード');
    await scan(user, field, '4901234567894');
    const choice = screen.getByRole('group', { name: '数えるロット' });
    await user.click(within(choice).getByRole('button', { name: /ロット20990201/ }));
    expect(countOf('牛乳', '20990201')).toHaveValue(1);
    await scan(user, field, '4901234567894');
    expect(countOf('牛乳', '20990201')).toHaveValue(2);
    expect(countOf('牛乳', '20990101')).toHaveValue(null); // もう一方は未カウントのまま

    // 選び直すと、次に読んだときにまた選べる
    await user.click(screen.getByRole('button', { name: '数えるロットを選び直す' }));
    await scan(user, field, '4901234567894');
    expect(screen.getByRole('group', { name: '数えるロット' })).toBeInTheDocument();
  });

  it('倉庫で絞り込んでいれば、その倉庫のロットだけを数える', async () => {
    const user = userEvent.setup();
    renderStocktake();
    await user.selectOptions(screen.getByLabelText('倉庫'), 'wh-a');
    await scan(user, screen.getByLabelText('棚卸のバーコード'), '4901234567894');
    expect(screen.queryByRole('group', { name: '数えるロット' })).not.toBeInTheDocument();
    expect(countOf('牛乳', '20990101')).toHaveValue(1);
  });

  it('未登録の JAN は知らせるだけで数えない', async () => {
    const user = userEvent.setup();
    renderStocktake();
    await scan(user, screen.getByLabelText('棚卸のバーコード'), '4006381333931');
    expect(screen.getByRole('status')).toHaveTextContent('未登録のJANコードです（4006381333931）');
  });
});

describe('売上登録・FEFO出庫のスキャン', () => {
  it('売上登録: 読んだ商品を選び、同じ商品を続けて読むと数量が増える。資材は選べない', async () => {
    const user = userEvent.setup();
    render(<SalesEntryModal products={PRODUCTS} customers={[]} warehouses={WAREHOUSES} onSubmit={() => {}} onClose={() => {}} />);
    const field = screen.getByLabelText('売上のバーコード');
    // 初期選択 (名前順の先頭) と別の商品を読む → その商品に切り替わり数量 1
    const other = (screen.getByLabelText('商品') as HTMLSelectElement).value === 'p1' ? ['p2', '4901987654322'] : ['p1', '4901234567894'];
    await scan(user, field, other[1]);
    expect(screen.getByLabelText('商品')).toHaveValue(other[0]);
    expect(screen.getByLabelText('数量')).toHaveValue(1);
    await scan(user, field, other[1]);
    await scan(user, field, other[1]);
    expect(screen.getByLabelText('数量')).toHaveValue(3);
    await scan(user, field, '49123456');
    expect(screen.getByRole('status')).toHaveTextContent('値札ラベル は資材なので売上にできません');
    expect(screen.getByLabelText('商品')).toHaveValue(other[0]);
  });

  it('FEFO出庫: 開いた商品を読むたびに数量 +1、別の商品なら知らせるだけ', async () => {
    const user = userEvent.setup();
    render(<ShipFefoModal product={PRODUCTS[0]} warehouses={WAREHOUSES} customers={[]} onShip={() => {}} onClose={() => {}} />);
    const field = screen.getByLabelText('出庫のバーコード');
    await scan(user, field, '4901234567894');
    expect(screen.getByRole('status')).toHaveTextContent('牛乳 数量 2');
    await scan(user, field, '4901987654322');
    expect(screen.getByRole('status')).toHaveTextContent('この画面は 牛乳 の出庫です');
  });
});

describe('入荷のスキャン', () => {
  const plan = (over: Partial<InboundPlan> & { id: string; productId: string }): InboundPlan => ({
    expectedDate: '2099-01-01', quantity: 10, receivedQuantity: 0, warehouseId: 'wh-a', lotNo: '20990501', expiryDate: '2099-05-01',
    supplierId: '', unitPrice: 0, note: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
  });
  const renderInbound = (plans: InboundPlan[]) => render(
    <InboundPlanView
      inboundPlans={plans} products={PRODUCTS} warehouses={WAREHOUSES} suppliers={[]}
      onAdd={() => {}} onUpdate={() => {}} onCancel={() => {}} onDelete={() => {}} onReceive={() => null}
    />,
  );

  it('未入荷の予定が1件なら入荷画面を開く', async () => {
    const user = userEvent.setup();
    renderInbound([plan({ id: 'a', productId: 'p1' }), plan({ id: 'done', productId: 'p2', receivedQuantity: 10 })]);
    await scan(user, screen.getByLabelText('入荷のバーコード'), '4901234567894');
    expect(screen.getByRole('heading', { name: '入荷' })).toBeInTheDocument();
  });

  it('予定が複数なら一覧をその商品に絞り込み、予定がなければ知らせる', async () => {
    const user = userEvent.setup();
    renderInbound([plan({ id: 'a', productId: 'p1' }), plan({ id: 'b', productId: 'p1', receivedQuantity: 3 }), plan({ id: 'done', productId: 'p2', receivedQuantity: 10 })]);
    const field = screen.getByLabelText('入荷のバーコード');
    await scan(user, field, '4901234567894');
    expect(screen.getByRole('status')).toHaveTextContent('牛乳 の未入荷の予定が2件あります');
    expect(screen.getByPlaceholderText(/商品名・SKU・ロットNo・仕入先で検索/)).toHaveValue('ML-001');
    await scan(user, field, '4901987654322');
    expect(screen.getByRole('status')).toHaveTextContent('チーズ の未入荷の予定はありません');
  });
});

describe('商品マスタ: JAN のチェックデジットとバーコード表', () => {
  it('チェックデジットが合わない JAN は保存できない', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProductModal product={PRODUCTS[1]} categories={CATEGORIES} onSave={onSave} onClose={() => {}} />);
    const jan = screen.getByDisplayValue('4901987654322');
    await user.clear(jan);
    await user.type(jan, '4901987654320');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('チェックデジット');
  });

  it('バーコード表は JAN のある商品のバーコードを並べる', () => {
    render(<BarcodeSheetModal products={[...PRODUCTS, { ...PRODUCTS[1], id: 'p9', name: 'JANなし', janCode: undefined }]} onClose={() => {}} />);
    expect(screen.getAllByRole('img', { name: /のバーコード$/ })).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'JAN 4901234567894 のバーコード' })).toBeInTheDocument();
    expect(screen.getByText(/JANコード未登録の商品 1件は載りません/)).toBeInTheDocument();
  });
});
