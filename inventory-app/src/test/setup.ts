import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// waitFor / findBy* の待ち時間（既定 1 秒）も、全件並列実行の負荷で足りなくなることがあるので延ばす。
// vite.config.ts の testTimeout（20 秒）より短くして、失敗時は「要素が見つからない」の方を出す。
configure({ asyncUtilTimeout: 5_000 });

// Node 25 以降は Web Storage (localStorage / sessionStorage) をグローバルに組み込みで持つが、
// --localstorage-file を渡さないと getter が undefined を返す。Vitest の jsdom 環境は
// 既存のグローバルを上書きしないため、この undefined が jsdom の Storage を隠してしまう。
// jsdom 本体の Storage を差し戻して、Node のバージョンに関係なく同じ挙動にする。
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (jsdomWindow && globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, {
      value: jsdomWindow[key],
      configurable: true,
      writable: true,
    });
  }
}
