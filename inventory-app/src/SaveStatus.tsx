import type { SaveState, SaveStatus } from './saveQueue';

/** ヘッダーのタイトル横に出す小さな保存状態。保存済み・読み込み中は何も出さない (画面を騒がせない) */
export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="save-indicator">保存中…</span>;
  if (state === 'retrying') return <span className="save-indicator">保存を再試行しています…</span>;
  return null;
}

/**
 * 保存できなかったとき・サーバーにつながらないときに、全タブの上に出す帯。
 * 失敗した変更は画面に残っていて、「再試行」でまとめて送り直せる (saveQueue.retry)。
 */
export function SaveBanner({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.state === 'error') {
    return (
      <div className="alert-banner danger save-banner" role="alert">
        <span>
          <strong>保存できませんでした：</strong>{status.message}。
          変更はこの画面に残っています。画面を閉じたり再読み込みしたりせず、「再試行」を押してください。
        </span>
        <button type="button" className="btn-danger" onClick={onRetry}>再試行</button>
      </div>
    );
  }
  if (status.state === 'offline') {
    return (
      <div className="alert-banner warning save-banner" role="status">
        <span>
          <strong>サーバーに接続できません。</strong>
          この状態での変更は保存されません（画面を閉じると消えます）。通信を確認して再読み込みしてください。
        </span>
        <button type="button" className="btn-outline" onClick={() => window.location.reload()}>再読み込み</button>
      </div>
    );
  }
  return null;
}
