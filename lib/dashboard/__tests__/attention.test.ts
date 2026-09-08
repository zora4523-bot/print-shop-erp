import { describe, expect, it } from 'vitest';
import { attentionHref, completedWaitingLabel } from '../attention';

describe('completedWaitingLabel', () => {
  it('同一上海业务日显示今日完工', () => {
    expect(completedWaitingLabel(
      new Date('2026-09-06T16:00:00Z'),
      new Date('2026-09-07T15:59:00Z'),
    )).toBe('今日完工');
  });

  it('跨上海零点即累计一天，不必等待满 24 小时', () => {
    expect(completedWaitingLabel(
      new Date('2026-09-07T15:59:00Z'),
      new Date('2026-09-07T16:00:00Z'),
    )).toBe('完工后待发 1 天');
  });

  it('跨 UTC 零点但未跨上海业务日，不增加等待天数', () => {
    expect(completedWaitingLabel(
      new Date('2026-09-06T23:59:00Z'),
      new Date('2026-09-07T00:01:00Z'),
    )).toBe('今日完工');
  });

  it('跨年仍按上海日历日计算', () => {
    expect(completedWaitingLabel(
      new Date('2026-12-31T15:59:00Z'),
      new Date('2026-12-31T16:01:00Z'),
    )).toBe('完工后待发 1 天');
  });

  it('较早完工记录显示实际等待日数', () => {
    expect(completedWaitingLabel(
      new Date('2026-09-03T17:00:00Z'),
      new Date('2026-09-07T00:00:00Z'),
    )).toBe('完工后待发 3 天');
  });

  it('时间轻微超前不会展示负等待时长', () => {
    expect(completedWaitingLabel(
      new Date('2026-09-07T16:00:00Z'),
      new Date('2026-09-07T15:59:59Z'),
    )).toBe('今日完工');
  });
});

describe('attentionHref', () => {
  it.each(['shipments', 'due', 'outsource', 'over-reports', 'settlements'] as const)(
    '%s 进入完整关注列表并选择相同类别',
    (kind) => {
      const destination = new URL(attentionHref(kind), 'http://localhost:3000');
      expect(destination.pathname).toBe('/owner/attention');
      expect(destination.searchParams.get('kind')).toBe(kind);
      expect(destination.hash).toBe('');
    },
  );
});
