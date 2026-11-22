# バーコード読み取り機能

JANコード (EAN-13 / EAN-8) を読み取って商品を呼び出す・数える機能。画面仕様 (非プログラマ向け) は [spec/barcode.md](spec/barcode.md)。

## 方針

- **スキャナーはキーボード**: USB/Bluetooth のハンディスキャナーは数字を一気に入力して Enter を送る (HID キーボード)。
  なので「Enter で確定する入力欄」(`ScanInput`) があれば対応でき、手入力でも同じ動きを再現できる。テストも `user.type('…{Enter}')` で書く
- **カメラ**: `CameraScanner` が ZXing (`@zxing/browser` + `@zxing/library`、どちらもバージョン固定) で EAN-13/EAN-8 だけを読む。
  ブラウザ標準の `BarcodeDetector` は PC の Chrome や iOS Safari で使えないことがあるので使わず、どの端末も同じ経路にする。
  ZXing は重いので `ScanInput` が `React.lazy` で `CameraScanner` を読み込み、`CameraScanner` も ZXing を動的 import する
  (メインのバンドルに入れない。xlsx と同じ理由)。カメラは https / localhost でしか使えない
- **JAN は商品しか表さない**: ロット・期限は分からない。出庫は FEFO のまま、棚卸はロットを選ばせる。GS1-128 は対象外

## 構成

| ファイル | 役割 |
|----------|------|
| `src/ScanInput.tsx` | 読み取り欄。`hint` (読み取るとその画面で何が起きるか) を欄の下に「スキャンすると：…」と小さく出し、`aria-describedby` / `title` にも入れる。読み取り結果を出している間は同じ1行を結果に譲る (高さを増やさない)。Enter (IME 変換中は除く) で `onScan(text)` を呼び、戻り値 `ScanFeedback` を下に表示して欄を空にする。Enter を `preventDefault` するのでフォーム内でも送信しない。「カメラで読む」で `CameraScanner` を開く |
| `src/CameraScanner.tsx` | カメラ読み取りのモーダル。`decodeFromConstraints({ facingMode: 'environment' })`。同じコードは 1.5 秒受け付けない。`continuous` なら読んでも閉じない (棚卸) |
| `src/BarcodeSvg.tsx` | JAN のバーコードを SVG で描く (`eanModules` + クワイエットゾーン)。数字は下に通しで1行 (簡略) |
| `src/BarcodeSheetModal.tsx` | 商品マスタの「バーコード表」。JAN のある商品を並べて表示・印刷 (`.po-overlay` / `.po-print-area` の印刷 CSS) |
| `src/useInventory.ts` | 純粋関数 (下) |

組み込み先: `App.tsx` (在庫一覧の `handleInventoryScan`)、`StocktakeView` (スキャン数え)、`SalesEntryModal`、`ShipFefoModal`、
`InboundPlanView`、`ProductMasterView` / `ProductModal` (JAN の検証、バーコード表)。

## 純粋関数

| 関数 | 役割 |
|------|------|
| `janCheckDigit(body)` | チェックデジット (右から奇数桁×3 + 偶数桁×1) |
| `janCodeError(value)` | JAN の入力チェック (空は可、8/13桁、チェックデジット)。`isValidJanCode` はこれのラッパーになった |
| `normalizeScanCode(text)` | 全角数字 → 半角、数字以外を除去 (`normalizeJanCode` と違い 13 桁で切らない) |
| `findProductByScan(products, text)` | JAN 完全一致 → SKU 完全一致 (大小無視) の順で探す。見つからなければ理由 (`未登録` / `JANとして不正` / `一致なし`) |
| `eanModules(code)` | EAN-13 (95) / EAN-8 (67) のモジュール列。不正な JAN は `null` |

## 画面ごとの決めごと

- **在庫一覧**: 検索欄に JAN (なければ SKU) を入れ、カテゴリ・倉庫の絞り込みを外し、その商品を展開する
- **棚卸**: 対象ロットは `stocktakeRows(products, { ...filter, keyword: '' })` (カテゴリ・倉庫の絞り込みは効かせ、キーワードは無視)。
  1ロットならそこに +1、複数なら `choosing` でロットを選ばせ `lotChoice[productId]` に覚える (以後は同じロットに +1)。
  カウントは既存の `counts` (lotId → 実数) に足すだけなので、確定・差異・CSV は今までと同じ
- **売上登録**: 別の商品 → 選び直して数量 1、同じ商品 → +1。資材は拒否
- **FEFO出庫**: 開いた商品だけを `findProductByScan([product], …)` で照合し、一致なら +1
- **入荷予定**: 未入荷・一部入荷の予定が1件なら `ReceiveInboundModal` を開く、複数なら `keyword = SKU` で絞り込む
- **JAN の検証**: 商品マスタのインライン編集と `ProductModal` が `janCodeError` で保存を止める。サンプルの JAN はすべて正しいチェックデジット

## 検証

スキャナーがなくても次で確かめられる。

- 自動テスト: キーボード入力 (`数字 + Enter`) でスキャンを再現 (`src/test/BarcodeScan.test.tsx`)
- バーの並び: `eanModules` の出力を ZXing の読み取り器 (`MultiFormatOneDReader`) に通して元の JAN に戻ることを確認 (`src/test/barcode.test.ts`)。
  独立した実装で読めるので、描いたバーコードは実際のカメラ・スキャナーでも読める
- 実機: 商品マスタの「バーコード表」を PC に出し、スマホで本番 (https) の画面を開いて「カメラで読む」。カメラ部分は jsdom で動かないので自動テストはない

## やっていないこと

- GS1-128 (ロット・期限入り)、QRコード、ITF (段ボール) の読み取り
- 読み取り音
- JAN の重複登録の防止 (同じ JAN の商品が複数あれば先に見つかった方)
