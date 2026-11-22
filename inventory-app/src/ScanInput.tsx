import { Suspense, lazy, useId, useRef, useState } from 'react';

// カメラ読み取りは ZXing (数百 kB) を使うので、ボタンを押したときに読み込む (xlsx と同じ理由)
const CameraScanner = lazy(() => import('./CameraScanner').then(m => ({ default: m.CameraScanner })));

/** 読み取ったあとに入力欄の下へ出すメッセージ */
export interface ScanFeedback {
  message: string;
  /** ok = 読み取れた、error = 見つからない等、info = 続けて操作してほしいことの案内 */
  tone: 'ok' | 'error' | 'info';
}

interface Props {
  /** 読み取った (Enter で確定した) 文字列を受け取り、結果のメッセージを返す */
  onScan: (text: string) => ScanFeedback | void;
  /** 入力欄のラベル (読み上げ・テスト用) */
  label?: string;
  placeholder?: string;
  /**
   * 読み取るとこの画面で何が起きるか (例:「読み取った商品だけを表示し、ロットを開きます」)。
   * 入力欄の下に小さく「スキャンすると：…」と出す。読み取った結果を出している間は結果に場所を譲る
   */
  hint?: string;
  /**
   * カメラで続けて読むか。true は読み取っても閉じずに次を待つ (棚卸のスキャン数え)。
   * false は1つ読んだら閉じる
   */
  continuous?: boolean;
  autoFocus?: boolean;
}

/**
 * バーコードの読み取り欄。USB・Bluetooth のバーコードスキャナーはキーボードとして数字を一気に入力し、
 * 最後に Enter を送るので、この入力欄で Enter を受けたら onScan に渡すだけで対応できる
 * (手で数字を打って Enter でも同じ)。「カメラで読む」はスマホ・PC のカメラで同じことをする。
 *
 * フォームの中に置いても Enter でフォームが送信されないよう、Enter は自分で止める。
 */
export function ScanInput({ onScan, label = 'バーコード', placeholder = 'JANをスキャン（または入力してEnter）', hint, continuous = false, autoFocus }: Props) {
  const hintId = useId();
  const hintText = hint ? `スキャンすると：${hint}` : '';
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (text: string) => {
    if (!text.trim()) return;
    const result = onScan(text);
    setFeedback(result ?? null);
    return result;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(value);
    // 次のスキャンにそのまま備える (スキャナーは続けて入力してくるので、入力欄は空にしてフォーカスを残す)
    setValue('');
  };

  return (
    <div className="scan-input">
      <div className="scan-input-row">
        <input
          ref={inputRef}
          aria-label={label}
          className="scan-input-field"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          title={hintText || undefined}
          value={value}
          autoFocus={autoFocus}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn-outline scan-camera-btn" onClick={() => setCameraOpen(true)}>
          カメラで読む
        </button>
      </div>
      {/* 説明と読み取り結果は同じ1行を使う (結果を出している間は結果を出し、画面の高さを増やさない) */}
      {feedback ? (
        <div role="status" className={`scan-feedback scan-${feedback.tone}`}>
          {feedback.message}
        </div>
      ) : hint && (
        <div id={hintId} className="scan-hint">{hintText}</div>
      )}
      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraScanner
            hint={hintText}
            continuous={continuous}
            onDetected={submit}
            onClose={() => { setCameraOpen(false); inputRef.current?.focus(); }}
          />
        </Suspense>
      )}
    </div>
  );
}
