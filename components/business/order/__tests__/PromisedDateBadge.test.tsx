import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import { PromisedDateBadge } from '../PromisedDateBadge';

// 上海 2026-03-10 10:00，todayShanghai() = '2026-03-10'
const NOW = new Date('2026-03-10T02:00:00Z');

function render(promisedDate: string | null, status: OrderStatus = OrderStatus.CONFIRMED) {
  return renderToStaticMarkup(
    <PromisedDateBadge
      promisedDate={promisedDate ? new Date(`${promisedDate}T00:00:00Z`) : null}
      status={status}
    />,
  );
}

describe('PromisedDateBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('逾期走 danger，文案保留天数', () => {
    const html = render('2026-03-05');

    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('逾期 5 天');
  });

  it('今天到期走 warning', () => {
    const html = render('2026-03-10');

    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('今天到期');
  });

  it('三天内到期走 warning 并显示剩余天数', () => {
    const html = render('2026-03-12');

    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('剩 2 天');
  });

  it('不再写本地 tone 类名（§6）', () => {
    for (const date of ['2026-03-05', '2026-03-10', '2026-03-12']) {
      const html = render(date);
      // 原先手写的临期边框；颜色现在只由 ui-business 的 tone 表给出
      // （TONE_BADGE_SOFT.warning 里的 border-warning/30）。
      expect(html).not.toContain('border-warning/50');
      // 每一档都必须是 StatusBadge（带 data-tone），而不是 shadcn Badge。
      expect(html).toMatch(/data-tone="(danger|warning)"/);
    }
  });

  it('未填交期或已发货不显示徽标', () => {
    expect(render(null)).toBe('');
    expect(render('2026-03-05', OrderStatus.SHIPPED)).toBe('');
    expect(render('2026-03-20')).toBe('');
  });
});
