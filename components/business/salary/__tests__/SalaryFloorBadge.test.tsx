import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalaryFloorBadge } from '../SalaryFloorBadge';

describe('SalaryFloorBadge', () => {
  it('renders the three floor states with the SPEC wording', () => {
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="120" base="100" />),
    ).toContain('计件高于保底');
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="100" base="100" />),
    ).toContain('计件等于保底');
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="80" base="100" />),
    ).toContain('按保底补足');
  });

  it('never renders the floor top-up as danger', () => {
    // 保底补足是保护师傅的兜底机制，不是失败终态（§6：danger 只给失败 / 取消）。
    const toppedUp = renderToStaticMarkup(
      <SalaryFloorBadge piecework="80" base="100" />,
    );

    expect(toppedUp).toContain('data-tone="info"');
    expect(toppedUp).not.toContain('data-tone="danger"');
  });

  it('renders above-floor as success and at-floor as neutral', () => {
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="120" base="100" />),
    ).toContain('data-tone="success"');
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="100" base="100" />),
    ).toContain('data-tone="neutral"');
  });

  it('compares by decimal value, not by string or float', () => {
    // 归并前两处本地实现用 gt/eq 两次比较，现在是一次 cmp。这两条锁住
    // 「'100.00' 与 '100' 判等」「字符串 '9' 不会按字典序判成大于 '100'」。
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="100.00" base="100" />),
    ).toContain('计件等于保底');
    expect(
      renderToStaticMarkup(<SalaryFloorBadge piecework="9" base="100" />),
    ).toContain('按保底补足');
  });
});
