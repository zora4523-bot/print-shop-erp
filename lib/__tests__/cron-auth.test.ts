import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { timingSafeEqualSpy } = vi.hoisted(() => ({
  timingSafeEqualSpy:
    vi.fn<(a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => boolean>(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

import { requireCronAuth } from '../cron-auth';

const SECRET = 'test-cron-secret-12345';
const original = process.env.CRON_SECRET;

function req(authorization?: string): Request {
  return new Request('http://localhost/api/cron/daily-salary', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  timingSafeEqualSpy.mockClear();
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe('requireCronAuth 响应契约', () => {
  it('CRON_SECRET 未配置 → 503 且 body 逐字节固定', async () => {
    delete process.env.CRON_SECRET;
    const denied = requireCronAuth(req(`Bearer ${SECRET}`));
    expect(denied?.status).toBe(503);
    await expect(denied?.json()).resolves.toEqual({ error: 'CRON_SECRET not configured' });
  });

  it('CRON_SECRET 为空串同样按未配置处理 → 503', () => {
    process.env.CRON_SECRET = '';
    expect(requireCronAuth(req(`Bearer `))?.status).toBe(503);
  });

  it('缺 Authorization 头 → 401 且 body 逐字节固定', async () => {
    const denied = requireCronAuth(req());
    expect(denied?.status).toBe(401);
    await expect(denied?.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('密钥正确 → 返回 null', () => {
    expect(requireCronAuth(req(`Bearer ${SECRET}`))).toBeNull();
  });
});

describe('requireCronAuth 比较语义仍是完全相等', () => {
  const cases: Array<[string, string]> = [
    ['密钥错误', 'Bearer wrong-secret'],
    ['只带前缀', `Bearer ${SECRET.slice(0, -1)}`],
    ['多一个字符', `Bearer ${SECRET}x`],
    ['scheme 大小写不同', `bearer ${SECRET}`],
    ['scheme 与密钥之间多一个空格', `Bearer  ${SECRET}`],
    ['没有 Bearer 前缀', SECRET],
    ['空字符串', ''],
  ];

  for (const [name, header] of cases) {
    it(`${name} → 401`, () => {
      expect(requireCronAuth(req(header))?.status).toBe(401);
    });
  }

  it('超长头不抛异常（timingSafeEqual 的等长约束由摘要吸收）', () => {
    expect(() => requireCronAuth(req('x'.repeat(100_000)))).not.toThrow();
    expect(requireCronAuth(req('x'.repeat(100_000)))?.status).toBe(401);
  });
});

describe('requireCronAuth 恒定时间比较', () => {
  it('走 timingSafeEqual，且两侧摘要等长——长度不同不早返回', () => {
    requireCronAuth(req('B'));
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
    const [left, right] = timingSafeEqualSpy.mock.calls[0]!;
    expect(left.byteLength).toBe(32);
    expect(right.byteLength).toBe(32);
  });

  it('长度差异极大的两次请求都跑满一次比较', () => {
    requireCronAuth(req('x'));
    requireCronAuth(req('x'.repeat(5_000)));
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);
  });
});
