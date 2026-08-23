'use client';

import { useActionState } from 'react';
import {
  confirmUnknownNotificationDeliveredAction,
  retryUnknownNotificationAction,
} from '@/actions/owner-notifications';
import type { NotificationResolutionResult } from '@/actions/owner-notifications.types';
import { Button } from '@/components/ui/button';

export function UnknownNotificationActions({
  logId,
  stateVersion,
  canRetry,
}: {
  logId: string;
  stateVersion: number;
  canRetry: boolean;
}) {
  const [deliveredState, deliveredAction, deliveredPending] = useActionState<
    NotificationResolutionResult | null,
    FormData
  >(confirmUnknownNotificationDeliveredAction, null);
  const [retryState, retryAction, retryPending] = useActionState<
    NotificationResolutionResult | null,
    FormData
  >(retryUnknownNotificationAction, null);
  const pending = deliveredPending || retryPending;
  const state = deliveredState ?? retryState;

  return (
    <div className="flex min-w-44 flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1">
        <form
          action={deliveredAction}
          onSubmit={(event) => {
            if (!window.confirm('已在企业微信群中确认看到这条消息？')) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="logId" value={logId} />
          <input type="hidden" name="stateVersion" value={stateVersion} />
          <Button type="submit" size="xs" variant="secondary" disabled={pending}>
            {deliveredPending ? '处理中…' : '确认已送达'}
          </Button>
        </form>
        <form
          action={retryAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                '已确认群中没有这条消息？系统将使用原后台任务内容重发。',
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="logId" value={logId} />
          <input type="hidden" name="stateVersion" value={stateVersion} />
          <Button
            type="submit"
            size="xs"
            variant="outline"
            disabled={pending || !canRetry}
            title={
              canRetry
                ? '确认未送达后，使用原任务内容与原投递目标重发'
                : '该日志没有可重放的持久化后台任务'
            }
          >
            {retryPending ? '入队中…' : '确认未送达并重发'}
          </Button>
        </form>
      </div>
      {state?.status === 'error' ? (
        <span role="alert" className="max-w-72 text-right text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
      {state?.status === 'success' ? (
        <span role="status" className="max-w-72 text-right text-xs text-success-foreground">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
