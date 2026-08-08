import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberInput } from '../NumberInput';

function Harness({ initial = 1, onChange = vi.fn() }: { initial?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberInput aria-label="数量" min={0} value={value} onValueChange={v => { setValue(v); onChange(v); }} />
      <button onClick={() => setValue(9)}>外部から9にする</button>
      <span data-testid="value">{value}</span>
    </>
  );
}

describe('NumberInput', () => {
  it('backspaceで全消しすると空欄のままになる（0が復活しない）', async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} />);
    const input = screen.getByLabelText('数量');

    await user.type(input, '{backspace}');

    expect(input).toHaveValue(null); // 空欄
    expect(screen.getByTestId('value')).toHaveTextContent('0'); // 親には0が渡る
  });

  it('全消しした後に入力すると、先頭に0が残らない', async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} />);
    const input = screen.getByLabelText('数量');

    await user.type(input, '{backspace}5');

    expect(input).toHaveValue(5);
    expect(screen.getByTestId('value')).toHaveTextContent('5');
  });

  it('入力した値が数値として親に渡る', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={0} onChange={onChange} />);
    const input = screen.getByLabelText('数量');

    await user.clear(input);
    await user.type(input, '12');

    expect(onChange).toHaveBeenLastCalledWith(12);
    expect(input).toHaveValue(12);
  });

  it('親が値を差し替えると表示も追従する', async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} />);
    const input = screen.getByLabelText('数量');

    await user.clear(input);
    await user.click(screen.getByText('外部から9にする'));

    expect(input).toHaveValue(9);
  });
});
