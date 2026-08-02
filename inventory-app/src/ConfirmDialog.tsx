import { useEffect } from 'react';

export type Tone = 'danger' | 'primary';

export interface DialogState {
  title: string;
  message: string;
  confirmLabel: string;
  tone: Tone;
  cancelable: boolean; // false のときは通知 (alert 相当) としてキャンセルを出さない
}

interface Props extends DialogState {
  onConfirm: () => void;
  onCancel: () => void;
}

// 表示専用。開閉と呼び出し側への結果の受け渡しは useConfirm / useNotify が持つ
export function ConfirmDialog({ title, message, confirmLabel, tone, cancelable, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={cancelable ? onCancel : undefined}>
      <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          {cancelable && <button type="button" className="btn-secondary" onClick={onCancel}>キャンセル</button>}
          <button type="button" autoFocus className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
