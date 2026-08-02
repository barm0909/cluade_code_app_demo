import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { DialogState, Tone } from './ConfirmDialog';

// window.confirm / window.alert の置き換え。
// ネイティブダイアログは埋め込みブラウザや、ユーザーが「このページでこれ以上ダイアログを
// 表示しない」を選んだタブでは表示されないまま false が返るため、ボタンが無反応に見える。
// アプリ内のモーダルにすることでどの環境でも確実に確認を取れるようにする。

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  tone?: Tone;
}

// 開いている間だけ resolve を保持し、閉じたときに確定させる
function useDialogState() {
  const [state, setState] = useState<DialogState | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const open = useCallback((next: DialogState) => new Promise<boolean>(resolve => {
    resolveRef.current = resolve;
    setState(next);
  }), []);

  const close = useCallback((ok: boolean) => {
    setState(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(ok);
  }, []);

  return { state, open, close };
}

/**
 * window.confirm の代わり。
 *   const { confirm, confirmDialog } = useConfirm();
 *   onClick={async () => { if (await confirm({ message: '削除しますか？', tone: 'danger' })) onDelete(id); }}
 * 返り値の confirmDialog を JSX のどこかに置くこと。
 */
export function useConfirm() {
  const { state, open, close } = useDialogState();

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const o = typeof options === 'string' ? { message: options } : options;
    return open({
      title: o.title ?? '確認',
      message: o.message,
      confirmLabel: o.confirmLabel ?? 'OK',
      tone: o.tone ?? 'primary',
      cancelable: true,
    });
  }, [open]);

  const confirmDialog = state
    ? <ConfirmDialog {...state} onConfirm={() => close(true)} onCancel={() => close(false)} />
    : null;

  return { confirm, confirmDialog };
}

/** window.alert の代わり。閉じるまで待ちたい場合は返り値の Promise を await する */
export function useNotify() {
  const { state, open, close } = useDialogState();

  const notify = useCallback((message: string, title = 'お知らせ') => (
    open({ title, message, confirmLabel: 'OK', tone: 'primary', cancelable: false })
  ), [open]);

  const notifyDialog = state
    ? <ConfirmDialog {...state} onConfirm={() => close(true)} onCancel={() => close(true)} />
    : null;

  return { notify, notifyDialog };
}
