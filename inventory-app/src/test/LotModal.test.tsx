import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LotModal } from '../LotModal';

const MOCK_WAREHOUSES = [
  { id: 'wh-sales', name: '販売倉庫', color: '#4caf50' },
  { id: 'wh-hold', name: '保留倉庫', color: '#ff9800' },
  { id: 'wh-defect', name: '不良倉庫', color: '#f44336' },
];

const defaultProps = {
  lot: null,
  warehouses: MOCK_WAREHOUSES,
  onSave: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe('LotModal — 表示', () => {
  it('新規追加モードで「ロットを追加」タイトルが表示される', () => {
    render(<LotModal {...defaultProps} />);
    expect(screen.getByText('ロットを追加')).toBeInTheDocument();
  });

  it('編集モードで「ロットを編集」タイトルが表示される', () => {
    const lot = { id: '1', lotNo: '20261231', quantity: 5, warehouseId: 'wh-sales' };
    render(<LotModal {...defaultProps} lot={lot} />);
    expect(screen.getByText('ロットを編集')).toBeInTheDocument();
  });

  it('既存ロットの値がフォームに反映される', () => {
    const lot = { id: '1', lotNo: '20261231', expiryDate: '2026-12-31', quantity: 10, warehouseId: 'wh-sales' };
    render(<LotModal {...defaultProps} lot={lot} />);
    expect(screen.getByDisplayValue('20261231')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
  });
});

describe('LotModal — ロットNo バリデーション', () => {
  it('8桁未満で保存するとエラーメッセージが表示される', async () => {
    const user = userEvent.setup();
    render(<LotModal {...defaultProps} />);
    await user.type(screen.getByPlaceholderText('例: 20261231'), '1234');
    await user.click(screen.getByText('保存'));
    expect(await screen.findByText('半角数字8桁で入力してください')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('8桁入力で保存ボタンが機能する', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<LotModal {...defaultProps} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText('例: 20261231'), '20261231');
    const qtyInput = screen.getByLabelText(/在庫数/);
    await user.clear(qtyInput);
    await user.type(qtyInput, '5');
    await user.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lotNo: '20261231', quantity: 5 }));
  });

  it('数字以外の文字は入力できない', async () => {
    const user = userEvent.setup();
    render(<LotModal {...defaultProps} />);
    const input = screen.getByPlaceholderText('例: 20261231');
    await user.type(input, 'ABC-2026');
    expect((input as HTMLInputElement).value).toBe('2026');
  });

  it('9桁以上は入力されない（8桁でカット）', async () => {
    const user = userEvent.setup();
    render(<LotModal {...defaultProps} />);
    const input = screen.getByPlaceholderText('例: 20261231');
    await user.type(input, '202612319999');
    expect((input as HTMLInputElement).value).toHaveLength(8);
  });
});

describe('LotModal — 賞味期限からの自動生成', () => {
  it('賞味期限を入力するとロットNoが自動生成される', () => {
    render(<LotModal {...defaultProps} />);
    const dateInput = screen.getByLabelText(/賞味期限/);
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } });
    expect(screen.getByDisplayValue('20261231')).toBeInTheDocument();
  });
});

describe('LotModal — キャンセル', () => {
  it('キャンセルボタンで onClose が呼ばれる', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LotModal {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByText('キャンセル'));
    expect(onClose).toHaveBeenCalled();
  });

  it('オーバーレイクリックで onClose が呼ばれる', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LotModal {...defaultProps} onClose={onClose} />);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });
});
