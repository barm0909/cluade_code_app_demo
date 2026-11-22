import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScanFeedback } from './ScanInput';

interface Props {
  /** 読み取ったコードを渡す。戻り値のメッセージを画面に出す */
  onDetected: (code: string) => ScanFeedback | void;
  /** true なら読み取っても閉じずに次を待つ */
  continuous: boolean;
  /** 読み取ると何が起きるかの説明 (呼び出し元の読み取り欄と同じ文) */
  hint?: string;
  onClose: () => void;
}

// 同じバーコードがカメラに映り続けると何度も読めてしまうので、同じコードはこの間隔を空けないと受け付けない
const SAME_CODE_INTERVAL_MS = 1500;

/**
 * カメラでバーコード (JAN = EAN-13 / EAN-8) を読む。読み取りは ZXing (@zxing/browser) で行い、
 * 端末やブラウザ (PC の Chrome、iPhone の Safari など) で挙動を変えないよう、ブラウザ標準の
 * BarcodeDetector は使わない。ZXing はこの部品を開いたときに読み込む (ScanInput の lazy)。
 *
 * カメラは https (または localhost) でないと使えない。使えないときや許可されなかったときはメッセージを出す。
 */
export function CameraScanner({ onDetected, continuous, hint, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('カメラを起動しています…');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  // 親の関数が描画のたびに変わっても読み取りをやり直さないよう、最新の関数を ref で持つ
  const handlers = useRef({ onDetected, onClose, continuous });
  useEffect(() => { handlers.current = { onDetected, onClose, continuous }; });

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    let last = { code: '', at: 0 };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('このページではカメラを使えません。https のページで開いているか確認してください。');
        return;
      }
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (stopped || !videoRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          result => {
            if (!result || stopped) return;
            const code = result.getText();
            const now = Date.now();
            if (code === last.code && now - last.at < SAME_CODE_INTERVAL_MS) return;
            last = { code, at: now };
            const fb = handlers.current.onDetected(code);
            setFeedback(fb ?? { message: `読み取りました: ${code}`, tone: 'ok' });
            navigator.vibrate?.(80);
            if (!handlers.current.continuous) handlers.current.onClose();
          },
        );
        if (stopped) controls.stop();
        else setStatus('バーコードを枠の中に写してください');
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setStatus(name === 'NotAllowedError'
          ? 'カメラの使用が許可されていません。ブラウザの設定でこのサイトのカメラを許可してください。'
          : name === 'NotFoundError'
            ? 'カメラが見つかりません。'
            : 'カメラを起動できませんでした。');
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal camera-modal" onClick={e => e.stopPropagation()}>
        <h2>カメラで読み取り</h2>
        {hint && <p className="scan-hint">{hint}</p>}
        <div className="camera-frame">
          <video ref={videoRef} className="camera-video" muted playsInline />
          <div className="camera-guide" aria-hidden="true" />
        </div>
        <p className="fefo-note" role="status">{status}</p>
        {feedback && (
          <div className={`scan-feedback scan-${feedback.tone}`}>{feedback.message}</div>
        )}
        {continuous && <p className="fefo-note">続けて読み取れます。終わったら「閉じる」を押してください。</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
