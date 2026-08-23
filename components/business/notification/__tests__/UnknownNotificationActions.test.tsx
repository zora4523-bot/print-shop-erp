import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationResolutionResult } from '@/actions/owner-notifications.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    call: 0,
    delivered: null as NotificationResolutionResult | null,
    retry: null as NotificationResolutionResult | null,
    deliveredPending: false,
    retryPending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => {
      const delivered = actionState.call++ % 2 === 0;
      return delivered
        ? [actionState.delivered, vi.fn(), actionState.deliveredPending]
        : [actionState.retry, vi.fn(), actionState.retryPending];
    },
  };
});
vi.mock('@/actions/owner-notifications', () => ({
  confirmUnknownNotificationDeliveredAction: vi.fn(),
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
  actionState.deliveredPending = false;
  actionState.retryPending = false;
});

describe('UnknownNotificationActions', () => {
  it('renders two explicit decisions and posts an opaque id plus version CAS', () => {
    const html = render(true);

    expect(html).toContain('确认已送达');
    expect(html).toContain('确认未送达并重发');
    expect(html.match(/name="logId" value="log-1"/g)).toHaveLength(2);
    expect(html.match(/name="stateVersion" value="7"/g)).toHaveLength(2);
    expect(html).not.toContain('messageContent');
    expect(html).not.toContain('payload');
  });

  it('disables resend when no original durable background job key exists', () => {
    const html = render(false);
    const retryButton = html.match(
      /<button[^>]*title="该日志没有可重放的持久化后台任务"[^>]*>/,
    )?.[0];

    expect(retryButton).toBeDefined();
    expect(retryButton).toContain('disabled=""');
  });

  it('renders a server-side concurrency conflict as an alert', () => {
    actionState.delivered = {
      status: 'error',
      message: '该推送已被其他管理员处置',
    };
    const html = render(true);

    expect(html).toContain('role="alert"');
    expect(html).toContain('该推送已被其他管理员处置');
  });
});
