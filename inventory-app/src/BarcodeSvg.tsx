import { eanModules } from './useInventory';

interface Props {
  code: string;
  /** 1モジュール (一番細いバー) の幅。印刷・カメラで読み取れるよう既定は 2 */
  moduleWidth?: number;
  height?: number;
}

// 両端の余白 (クワイエットゾーン)。これがないとスキャナーやカメラがバーの始まりを見つけられない
const QUIET_LEFT = 11;
const QUIET_RIGHT = 7;
const TEXT_HEIGHT = 16;

/**
 * JANコード (EAN-13 / EAN-8) のバーコードを SVG で描く。バーの並びは純粋関数 eanModules が作る。
 * 読み取りのテスト用と値札の印刷用で、数字は下に通しで1行に出す (正式な配置の簡略版)。
 * JANコードとして正しくない値は何も描かない。
 */
export function BarcodeSvg({ code, moduleWidth = 2, height = 60 }: Props) {
  const modules = eanModules(code);
  if (!modules) return null;
  const width = (QUIET_LEFT + modules.length + QUIET_RIGHT) * moduleWidth;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== '1') continue;
    let j = i;
    while (j + 1 < modules.length && modules[j + 1] === '1') j++;
    bars.push({ x: (QUIET_LEFT + i) * moduleWidth, w: (j - i + 1) * moduleWidth });
    i = j;
  }
  return (
    <svg
      className="barcode-svg"
      role="img"
      aria-label={`JAN ${code} のバーコード`}
      width={width}
      height={height + TEXT_HEIGHT}
      viewBox={`0 0 ${width} ${height + TEXT_HEIGHT}`}
    >
      <rect x={0} y={0} width={width} height={height + TEXT_HEIGHT} fill="#fff" />
      {bars.map(b => <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
      <text x={width / 2} y={height + TEXT_HEIGHT - 3} textAnchor="middle" fontSize={13} fontFamily="monospace" fill="#000">
        {code}
      </text>
    </svg>
  );
}
