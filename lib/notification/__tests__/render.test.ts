import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../render';

describe('renderTemplate', () => {
  it('replaces a single placeholder', () => {
    expect(renderTemplate('工单 {orderNo} 提交', { orderNo: 'O-1' })).toBe(
      '工单 O-1 提交',
    );
  });

  it('replaces multiple placeholders', () => {
    expect(
      renderTemplate('{customer} 下单 {orderNo}', {
        customer: '苹果福',
        orderNo: 'O-2',
      }),
    ).toBe('苹果福 下单 O-2');
  });

  it('replaces same placeholder appearing multiple times', () => {
    expect(
      renderTemplate('{name} 你好，{name} 欢迎', { name: '张三' }),
    ).toBe('张三 你好，张三 欢迎');
  });

  it('preserves placeholder when key is missing in payload', () => {
    expect(renderTemplate('工单 {orderNo} 由 {who}', { orderNo: 'O-1' })).toBe(
      '工单 O-1 由 {who}',
    );
  });

  it('preserves placeholder when value is null / undefined', () => {
    expect(
      renderTemplate('{a} / {b} / {c}', {
        a: 'x',
        b: null,
        c: undefined,
      }),
    ).toBe('x / {b} / {c}');
  });

  it('coerces non-string values via String()', () => {
    expect(renderTemplate('count={n} flag={f}', { n: 42, f: true })).toBe(
      'count=42 flag=true',
    );
  });

  it('Decimal-string passes through unchanged', () => {
    expect(renderTemplate('金额 {amount}', { amount: '1234.56' })).toBe(
      '金额 1234.56',
    );
  });

  it('empty template returns empty', () => {
    expect(renderTemplate('', { orderNo: 'O-1' })).toBe('');
  });

  it('empty payload preserves all placeholders', () => {
    expect(renderTemplate('{a} {b}', {})).toBe('{a} {b}');
  });

  it('template without placeholders is returned verbatim', () => {
    expect(renderTemplate('普通文本，无占位符', { x: 'y' })).toBe(
      '普通文本，无占位符',
    );
  });

  it('rejects placeholders with unsupported chars (kept literal)', () => {
    // foo.bar / foo-bar 不匹配占位符正则，按原样保留
    expect(
      renderTemplate('{foo.bar} {foo-bar} {foo_bar}', { foo_bar: 'ok' }),
    ).toBe('{foo.bar} {foo-bar} ok');
  });

  it('placeholder must start with letter (not digit)', () => {
    expect(renderTemplate('{1foo} {foo1}', { '1foo': 'a', foo1: 'b' })).toBe(
      '{1foo} b',
    );
  });

  it('does NOT execute payload values as templates (no recursion)', () => {
    // 防注入：用户输入了 {orderNo}，渲染后又含 {key} 也不要再轮一遍。
    expect(
      renderTemplate('用户说: {msg}', { msg: '{evil}', evil: 'BAD' }),
    ).toBe('用户说: {evil}');
  });
});
