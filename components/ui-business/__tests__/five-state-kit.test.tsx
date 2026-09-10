import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ContentSkeleton,
  DisabledReason,
  EMPTY_NO_ACCESS_TITLE,
  EmptyState,
  EnvNotice,
  ErrorState,
  LongTaskReceipt,
  PendingButton,
  remainingHoursLabel,
  SlowLoadingHint,
} from '@/components/ui-business';

describe('EmptyState kind contract', () => {
  it('no-access copy matches the missing-record page and ignores noun', () => {
    const missing = renderToStaticMarkup(<EmptyState kind="no-access" />);
    const forbidden = renderToStaticMarkup(
      <EmptyState kind="no-access" noun="工单" />,
    );
    expect(missing).toContain(EMPTY_NO_ACCESS_TITLE);
    expect(forbidden).toContain(EMPTY_NO_ACCESS_TITLE);
    expect(missing.replace(/data-kind="no-access"/, '')).toContain(
      '回我的工作台',
    );
    expect(missing).toContain('min-h-11');
    expect(missing).toContain('min-w-11');
    expect(visibleText(missing)).toBe(visibleText(forbidden));
  });

  it('fills no-data and no-result templates from noun', () => {
    const none = renderToStaticMarkup(
      <EmptyState kind="no-data" noun="工单" />,
    );
    const filtered = renderToStaticMarkup(
      <EmptyState kind="no-result" noun="工单" />,
    );
    expect(none).toContain('暂无工单');
    expect(none).toContain('工单创建后会出现在这里');
    expect(filtered).toContain('没有匹配的工单');
    expect(filtered).toContain('试试放宽条件');
  });
});

describe('DisabledReason', () => {
  it('renders nothing for permission', () => {
    const html = renderToStaticMarkup(
      <DisabledReason cause="permission">
        <button type="button">发货</button>
      </DisabledReason>,
    );
    expect(html).toBe('');
  });

  it('keeps status reasons visible without a tooltip', () => {
    const html = renderToStaticMarkup(
      <DisabledReason cause="status" reason="已结案的工单不能修改">
        <button type="button" disabled>
          发货
        </button>
      </DisabledReason>,
    );
    expect(html).toContain('已结案的工单不能修改');
    expect(html).toContain('role="group"');
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).not.toContain('title=');
  });
});

describe('ErrorState', () => {
  it('keeps business blocks off the destructive error style', () => {
    const html = renderToStaticMarkup(
      <ErrorState blocking title="有 2 个生产任务未完工，完工后可发货" />,
    );
    expect(html).toContain('data-blocking="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('bg-warning/10');
    expect(html).not.toContain('bg-destructive/10');
  });

  it('announces a technical section error assertively', () => {
    const html = renderToStaticMarkup(<ErrorState scope="section" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('<h2');
  });
});

describe('LongTaskReceipt', () => {
  it('renders remaining time in hours, not a raw timestamp', () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const expires = new Date('2026-08-24T18:00:00.000Z');
    expect(remainingHoursLabel(expires, now)).toBe('剩 18h');
    const html = renderToStaticMarkup(
      <LongTaskReceipt
        taskId="job-123"
        title="已受理：正在生成导出文件"
        expiresAt={expires}
        now={now}
      />,
    );
    expect(html).toContain('回执 job-123');
    expect(html).toContain('剩 18h');
    expect(html).not.toContain(expires.toISOString());
  });

  it('does not describe an expired or invalid receipt as still valid', () => {
    const now = new Date('2026-08-24T18:00:00.000Z');
    expect(remainingHoursLabel('2026-08-24T17:00:00.000Z', now)).toBe(
      '已过期',
    );
    expect(remainingHoursLabel('not-a-date', now)).toBe('有效期未知');
  });
});

describe('ContentSkeleton', () => {
  it('keeps real page chrome by default and only skeletonizes data rows', () => {
    const kept = renderToStaticMarkup(
      <ContentSkeleton rows={2} variant="table" />,
    );
    const replaced = renderToStaticMarkup(
      <ContentSkeleton rows={2} variant="table" keepChrome={false} />,
    );

    expect(kept).toContain('data-keep-chrome="true"');
    expect(kept.match(/data-slot="skeleton"/g)).toHaveLength(2);
    expect(replaced).toContain('data-keep-chrome="false"');
    expect(replaced.match(/data-slot="skeleton"/g)).toHaveLength(5);
  });

  it('does not flash the shared slow-loading message during initial render', () => {
    const hint = renderToStaticMarkup(<SlowLoadingHint />);
    const skeleton = renderToStaticMarkup(<ContentSkeleton rows={1} />);

    expect(hint).toBe('');
    expect(skeleton).not.toContain('仍在加载，可稍后重试。');
  });
});

describe('PendingButton', () => {
  it('exposes pending state and links an always-visible group note', () => {
    const html = renderToStaticMarkup(
      <PendingButton pending groupNote="任意一行失败时，整组都不会保存">
        保存草稿
      </PendingButton>,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('正在保存…');
    expect(html).toContain('任意一行失败时，整组都不会保存');
    expect(html).toMatch(/aria-describedby="[^"]+"/);
  });
});

describe('EnvNotice', () => {
  it('uses a labelled neutral notice instead of warning semantics', () => {
    const html = renderToStaticMarkup(<EnvNotice>mock-mode</EnvNotice>);
    expect(html).toContain('<aside');
    expect(html).toContain('aria-label="环境提示"');
    expect(html).toContain('border-l-info-neutral');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('role="alert"');
  });
});

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
