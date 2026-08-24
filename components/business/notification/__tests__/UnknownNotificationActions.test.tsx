import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationResolutionResult } from '@/actions/owner-notifications.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    call: 0,
    delivered: null as NotificationResolutionResult | null,
    retry: null as NotificationResolutionResult | null,
    ignored: null as NotificationResolutionResult | null,
    deliveredPending: false,
    retryPending: false,
    ignoredPending: false,
    active: null as 'delivered' | 'retry' | 'ignored' | null,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => {
      const decision = actionState.call++ % 3;
      if (decision === 0) {
        return [
          actionState.delivered,
          vi.fn(),
          actionState.deliveredPending,
        ];
      }
      if (decision === 1) {
        return [actionState.retry, vi.fn(), actionState.retryPending];
      }
      return [actionState.ignored, vi.fn(), actionState.ignoredPending];
    },
    useState: <T,>(initial: T) =>
      initial === null
        ? [actionState.active as T, vi.fn()]
        : actual.useState(initial),
  };
});
vi.mock('@/actions/owner-notifications', () => ({
  confirmUnknownNotificationDeliveredAction: vi.fn(),
  ignoreUnknownNotificationAction: vi.fn(),
  retryUnknownNotificationAction: vi.fn(),
}));

import { UnknownNotificationActions } from '../UnknownNotificationActions';

function render(canRetry: boolean) {
  actionState.call = 0;
  return renderToStaticMarkup(
    <UnknownNotificationActions
      logId="log-1"
      stateVersion={7}
      canRetry={canRetry}
    />,
  );
}

beforeEach(() => {
  actionState.call = 0;
  actionState.delivered = null;
  actionState.retry = null;
  actionState.ignored = null;
  actionState.deliveredPending = false;
  actionState.retryPending = false;
  actionState.ignoredPending = false;
  actionState.active = null;
});

describe('UnknownNotificationActions', () => {
  it('renders three explicit decisions and posts an opaque id plus version CAS', () => {
    const html = render(true);

    expect(html).toContain('确认已送达');
    expect(html).toContain('确认未送达并重发');
    expect(html).toContain('忽略');
    expect(html.match(/name="logId" value="log-1"/g)).toHaveLength(3);
    expect(html.match(/name="stateVersion" value="7"/g)).toHaveLength(3);
    expect(html).not.toContain('messageContent');
    expect(html).not.toContain('payload');
  });

  it('disables resend when no original durable background job key exists', () => {
    const html = render(false);
    const retryButton = html.match(/<button[^>]*disabled=""[^>]*>/)?.[0];

    expect(retryButton).toBeDefined();
    expect(retryButton).toContain('disabled=""');
    expect(html).toContain(
      '该日志没有可重放的持久化后台任务，无法自动重发',
    );
    expect(html).not.toContain('title="该日志没有');
  });

  it('renders a server-side concurrency conflict as an alert', () => {
    actionState.active = 'delivered';
    actionState.delivered = {
      status: 'error',
      message: '该推送已被其他管理员处置',
    };
    const html = render(true);

    expect(html).toContain('role="alert"');
    expect(html).toContain('该推送已被其他管理员处置');
  });
});
