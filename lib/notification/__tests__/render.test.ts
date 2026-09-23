import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderTemplate } from '../render';

beforeEach(() => vi.stubEnv('APP_PUBLIC_URL', ''));
afterEach(() => vi.unstubAllEnvs());

describe('renderTemplate', () => {
  it('resolves a work-order deep link against the configured public origin', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://erp.example.com/');

    expect(
      renderTemplate('工单 {orderNo}\n{deepLink}', {
        orderNo: 'GD 001/02',
        deepLink: '/orders#wo=GD%20001%2F02',
      }),
    ).toBe('工单 GD 001/02\nhttps://erp.example.com/orders#wo=GD%20001%2F02');
  });

  it('keeps a custom Markdown link clickable without nesting another link', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://erp.example.com');

    expect(
      renderTemplate('[查看工单]({deepLink})', {
        deepLink: '/orders#wo=GD-001',
      }),
    ).toBe('[查看工单](https://erp.example.com/orders#wo=GD-001)');
  });

  it('escapes order-number parentheses in Markdown link destinations', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://erp.example.com');

    expect(
      renderTemplate('[查看工单]({deepLink})', {
        deepLink: '/orders#wo=GD-(001)',
      }),
    ).toBe('[查看工单](https://erp.example.com/orders#wo=GD-%28001%29)');
  });

  it.each([
    '',
    'not-a-url',
    'javascript:alert(1)',
    'https://user:password@erp.example.com',
    'https://erp.example.com/internal',
    'https://erp.example.com?token=private',
    'https://erp.example.com#fragment',
  ])('retains the relative path for an absent or invalid public origin %s', (origin) => {
    vi.stubEnv('APP_PUBLIC_URL', origin);

    expect(renderTemplate('{deepLink}', { deepLink: '/orders#wo=GD-001' })).toBe(
      '/orders#wo=GD-001',
    );
  });

  it('supports an explicitly configured local development origin', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3127');

    expect(renderTemplate('{deepLink}', { deepLink: '/orders#wo=GD-001' })).toBe(
      'http://localhost:3127/orders#wo=GD-001',
    );
  });

  it('does not rewrite unrelated fields or noncanonical deep links', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://erp.example.com');

    // summary is plain text: never promoted to an absolute link, and its
    // markdown `#` is neutralised like any other non-deepLink value.
    expect(
      renderTemplate('{summary}\n{deepLink}', {
        summary: '/orders#wo=GD-001',
        deepLink: '//other.example.com/orders#wo=GD-001',
      }),
    ).toBe('/orders＃wo=GD-001\n//other.example.com/orders#wo=GD-001');
  });

  // Payload values such as customerRef are typed by external sales agents and
  // land in a WeCom markdown message: they must stay one line of inert text.
  it('neutralises markdown links and forged lines in placeholder values', () => {
    const rendered = renderTemplate(
      '🚚 **交期逾期**\n客户：{customerRef}\n当前状态：{status}',
      {
        customerRef: '[x](https://evil.example)\n当前状态：已发货',
        status: '生产中',
      },
    );

    expect(rendered).toBe(
      '🚚 **交期逾期**\n客户：［x］（https://evil.example） 当前状态：已发货\n当前状态：生产中',
    );
    expect(rendered.split('\n')).toHaveLength(3);
    expect(rendered).not.toMatch(/\[[^\]]*\]\(/);
  });

  it.each([
    ['**bold** and __under__', '＊＊bold＊＊ and ＿＿under＿＿'],
    ['`code`', '｀code｀'],
    ['<font color="warning">红</font> <@all>', '＜font color="warning"＞红＜/font＞ ＜@all＞'],
    ['# 伪标题', '＃ 伪标题'],
    ['> 伪引用', '＞ 伪引用'],
    ['~~删~~', '～～删～～'],
    ['a\\b', 'a＼b'],
    ['第一行\r\n\r\n第二行\u2028第三行', '第一行 第二行 第三行'],
    ['tab\there', 'tab here'],
  ])('escapes %j in a placeholder value', (value, expected) => {
    expect(renderTemplate('客户：{customerRef}', { customerRef: value })).toBe(
      `客户：${expected}`,
    );
  });

  it('leaves the system-generated deepLink and the template markup untouched', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://erp.example.com');

    expect(
      renderTemplate('**新工单提交**\n[查看工单]({deepLink})\n{summary}', {
        deepLink: '/orders#wo=GD-001',
        summary: '新工单已提交，待工厂确认',
      }),
    ).toBe(
      '**新工单提交**\n[查看工单](https://erp.example.com/orders#wo=GD-001)\n新工单已提交，待工厂确认',
    );
  });

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
