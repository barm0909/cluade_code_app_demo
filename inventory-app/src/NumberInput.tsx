import { useState } from 'react';

type Props = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
  /** 空欄のときに親へ渡す値（既定 0） */
  emptyValue?: number;
};

/**
 * 数値入力欄。
 *
 * `value={数値}` / `onChange={e => set(+e.target.value)}` と書くと、全消ししたときに
 * `+'' === 0` が親へ戻り、その 0 が即座に描画し直されるため backspace が効かなく見える。
 * ここでは表示用の文字列を内部に持ち、空欄を空欄のまま表示できるようにしている。
 */
export function NumberInput({ value, onValueChange, emptyValue = 0, ...rest }: Props) {
  const [text, setText] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  const parse = (t: string) => (t === '' ? emptyValue : Number(t));

  // 親が値を差し替えたとき（フォームのリセットなど）は表示も追従させる。
  // 入力中の "007" のような表記は、数値として一致している限りそのまま残す。
  if (value !== lastValue) {
    setLastValue(value);
    if (parse(text) !== value) setText(String(value));
  }

  return (
    <input
      {...rest}
      type="number"
      value={text}
      onChange={e => {
        setText(e.target.value);
        onValueChange(parse(e.target.value));
      }}
    />
  );
}
