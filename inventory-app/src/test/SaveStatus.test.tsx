import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveBanner, SaveIndicator } from '../SaveStatus';

describe('SaveStatus', () => {
  it('保存できなかったときは理由と「再試行」を出す', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<SaveBanner status={{ state: 'error', message: 'サーバーでエラーが起きました（500）' }} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした：サーバーでエラーが起きました（500）');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('同時編集で断られたときは、保存されていないことと「最新の内容を読み込む」を出す (再試行は出さない)', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onRetry = vi.fn();
    render(<SaveBanner status={{ state: 'conflict', message: '別の端末で先に変更されたデータがあります（商品・ロット 1件）' }} onRetry={onRetry} onReload={onReload} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした：別の端末で先に変更されたデータがあります（商品・ロット 1件）');
    expect(screen.getByRole('alert')).toHaveTextContent('保存されていません');
    expect(screen.queryByRole('button', { name: '再試行' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '最新の内容を読み込む' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('サーバーにつながらないときは、変更が保存されないことを知らせる', () => {
    render(<SaveBanner status={{ state: 'offline', message: '' }} onRetry={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('この状態での変更は保存されません');
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
  });

  it('保存済み・保存中は帯を出さず、保存中はヘッダーに小さく出すだけ', () => {
    const { container } = render(<SaveBanner status={{ state: 'saving', message: '' }} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    render(<SaveIndicator state="saving" />);
    expect(screen.getByText('保存中…')).toBeInTheDocument();
    const idle = render(<SaveIndicator state="idle" />);
    expect(idle.container).toBeEmptyDOMElement();
  });
});
