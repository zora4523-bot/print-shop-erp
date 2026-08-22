import { describe, expect, it } from 'vitest';
import { backgroundJobFailureSummary } from '../result-summary';

describe('backgroundJobFailureSummary', () => {
  it('有 lastErrorCode 时优先显示它', () => {
    expect(
      backgroundJobFailureSummary({
        lastErrorCode: 'NotificationDeliveryFailedError',
        result: { failed: 2, errorCodes: ['http 500'] },
      }),
    ).toBe('NotificationDeliveryFailedError');
  });

  it('成功但一条也没送出去 → 从 result 里把 failed / errorCodes 提上来', () => {
    // completeBackgroundJob 在成功路径把 lastErrorCode 置 null，光看状态列
    // 这行就是绿色的 SUCCEEDED。没有这个摘要，ops 无从发现「群里其实一条
    // 都没收到」。
    expect(
      backgroundJobFailureSummary({
        lastErrorCode: null,
        result: { failed: 1, errorCodes: ['wecom errcode=93000'] },
      }),
    ).toBe('failed=1 (wecom errcode=93000)');
  });

  it('errorCodes 缺失时至少给出失败条数', () => {
    expect(
      backgroundJobFailureSummary({ lastErrorCode: null, result: { failed: 3 } }),
    ).toBe('failed=3');
  });

  it('errorCodes 过多只展示前 3 条并省略', () => {
    expect(
      backgroundJobFailureSummary({
        lastErrorCode: null,
        result: { failed: 4, errorCodes: ['a', 'b', 'c', 'd'] },
      }),
    ).toBe('failed=4 (a, b, c…)');
  });

  it('全部送达 / 没有 result / result 不是对象 → null（表格显示 —）', () => {
    expect(
      backgroundJobFailureSummary({
        lastErrorCode: null,
        result: { failed: 0, delivered: 2 },
      }),
    ).toBeNull();
    expect(
      backgroundJobFailureSummary({ lastErrorCode: null, result: null }),
    ).toBeNull();
    expect(
      backgroundJobFailureSummary({ lastErrorCode: null, result: [1, 2] }),
    ).toBeNull();
    expect(backgroundJobFailureSummary({ lastErrorCode: null })).toBeNull();
  });

  it('超长摘要被截断，不把 ops 表格撑爆', () => {
    const summary = backgroundJobFailureSummary({
      lastErrorCode: null,
      result: {
        failed: 3,
        errorCodes: ['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50)],
      },
    });
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(80);
    expect(summary!.endsWith('…')).toBe(true);
  });
});
