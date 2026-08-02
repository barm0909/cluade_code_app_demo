import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm, useNotify } from '../useConfirm';

// confirm() の解決値を画面に出すだけのハーネス
function ConfirmHarness({ onResult, options }: { onResult: (ok: boolean) => void; options?: Parameters<ReturnType<typeof useConfirm>['confirm']>[0] }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button onClick={async () => onResult(await confirm(options ?? '削除しますか？'))}>実行</button>
      {confirmDialog}
    </div>
  );
}

function NotifyHarness() {
  const { notify, notifyDialog } = useNotify();
  return (
    <div>
      <button onClick={() => notify('3件の在庫数を更新しました。\n\n警告:\nSKUが見つかりません: XX-001', 'Excelインポート')}>通知</button>
      {notifyDialog}
    </div>
  );
}

describe('useConfirm', () => {
  it('呼ぶまでモーダルは出ない', () => {
    render(<ConfirmHarness onResult={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('OKを押すと true で解決する', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);

    await user.click(screen.getByText('実行'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('削除しますか？');

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('キャンセルを押すと false で解決する', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);

    await user.click(screen.getByText('実行'));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Escapeキーで閉じると false で解決する', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);

    await user.click(screen.getByText('実行'));
    await user.keyboard('{Escape}');

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('タイトル・ボタン名・危険操作の色を指定できる', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onResult={vi.fn()} options={{ message: '戻します', title: 'リセット確認', confirmLabel: 'リセット', tone: 'danger' }} />);

    await user.click(screen.getByText('実行'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('リセット確認');
    expect(within(dialog).getByRole('button', { name: 'リセット' })).toHaveClass('btn-danger');
  });

  it('確定ボタンに初期フォーカスが当たる', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onResult={vi.fn()} />);

    await user.click(screen.getByText('実行'));

    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
  });

  it('連続して開いてもそれぞれの呼び出しが解決する', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);

    await user.click(screen.getByText('実行'));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByText('実行'));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onResult.mock.calls).toEqual([[true], [false]]);
  });
});

describe('useNotify', () => {
  it('キャンセルボタンのない通知モーダルを出し、OKで閉じる', async () => {
    const user = userEvent.setup();
    render(<NotifyHarness />);

    await user.click(screen.getByText('通知'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Excelインポート');
    expect(within(dialog).queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('改行を含むメッセージがそのまま表示される', async () => {
    const user = userEvent.setup();
    render(<NotifyHarness />);

    await user.click(screen.getByText('通知'));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('SKUが見つかりません: XX-001');
  });
});
