'use client';

import { useActionState, useId, useState } from 'react';
import {
  confirmUnknownNotificationDeliveredAction,
  ignoreUnknownNotificationAction,
  retryUnknownNotificationAction,
} from '@/actions/owner-notifications';
import type { NotificationResolutionResult } from '@/actions/owner-notifications.types';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionDialog,
  DisabledReason,
} from '@/components/ui-business';

type ActiveDecision = 'delivered' | 'retry' | 'ignored';

export function UnknownNotificationActions({
  logId,
  stateVersion,
  canRetry,
}: {
  logId: string;
  stateVersion: number;
  canRetry: boolean;
}) {
  const formIdPrefix = useId();
  const [activeDecision, setActiveDecision] = useState<ActiveDecision | null>(
    null,
  );
  const [deliveredState, deliveredAction, deliveredPending] = useActionState<
    NotificationResolutionResult | null,
    FormData
  >(confirmUnknownNotificationDeliveredAction, null);
  const [retryState, retryAction, retryPending] = useActionState<
    NotificationResolutionResult | null,
    FormData
  >(retryUnknownNotificationAction, null);
  const [ignoredState, ignoredAction, ignoredPending] = useActionState<
    NotificationResolutionResult | null,
    FormData
  >(ignoreUnknownNotificationAction, null);
  const pending = deliveredPending || retryPending || ignoredPending;
  const deliveredFormId = `${formIdPrefix}-delivered`;
  const retryFormId = `${formIdPrefix}-retry`;
  const ignoredFormId = `${formIdPrefix}-ignored`;
  const state =
    activeDecision === 'delivered'
      ? deliveredState
      : activeDecision === 'retry'
        ? retryState
        : activeDecision === 'ignored'
          ? ignoredState
          : null;

  return (
    <div className="flex min-w-56 flex-col items-end gap-2">
      <form id={deliveredFormId} action={deliveredAction} aria-busy={deliveredPending}>
        <ResolutionIdentity logId={logId} stateVersion={stateVersion} />
      </form>
      <form id={retryFormId} action={retryAction} aria-busy={retryPending}>
        <ResolutionIdentity logId={logId} stateVersion={stateVersion} />
      </form>
      <form id={ignoredFormId} action={ignoredAction} aria-busy={ignoredPending}>
        <ResolutionIdentity logId={logId} stateVersion={stateVersion} />
      </form>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <ConfirmActionDialog
          level="L2"
          formId={deliveredFormId}
          disabled={pending}
          trigger={
            <Button type="button" size="xs" variant="secondary" disabled={pending}>
              {deliveredPending ? '处理中…' : '确认已送达'}
            </Button>
          }
          title="确认该消息已送达？"
          description="仅在你已在对应企业微信群中看到这条消息时选择。"
          impactItems={[
            '投递状态会从“待人工核对”改为“成功”。',
            '该决策会记录操作人和时间，且不再重发该条消息。',
          ]}
          confirmLabel="确认已送达"
          onConfirm={() => setActiveDecision('delivered')}
        />

        {canRetry ? (
          <ConfirmActionDialog
            level="L2"
            formId={retryFormId}
            disabled={pending}
            trigger={
              <Button type="button" size="xs" variant="outline" disabled={pending}>
                {retryPending ? '入队中…' : '确认未送达并重发'}
              </Button>
            }
            title="确认未送达并安全重发？"
            description="请先在对应群中确认消息确实不存在。"
            impactItems={[
              '使用原消息内容和原投递目标，不套用当前规则。',
              '同一任务的所有结果不明项核对完成后，才会重新入队。',
            ]}
            confirmLabel="确认未送达并重发"
            onConfirm={() => setActiveDecision('retry')}
          />
        ) : (
          <DisabledReason
            cause="status"
            reason="该消息缺少重发记录，无法自动重发"
            className="items-end text-right [&_[data-slot=disabled-reason-copy]]:max-w-72 [&_[data-slot=disabled-reason-copy]]:text-xs"
          >
            <Button type="button" size="xs" variant="outline" disabled>
              确认未送达并重发
            </Button>
          </DisabledReason>
        )}

        <ConfirmActionDialog
          level="L3"
          formId={ignoredFormId}
          disabled={pending}
          trigger={
            <Button type="button" size="xs" variant="destructive" disabled={pending}>
              {ignoredPending ? '处理中…' : '忽略'}
            </Button>
          }
          title="忽略该条结果不明的消息？"
          description="忽略表示不再确认是否送达，也不重发该条消息。"
          impactItems={[
            '投递状态会记为“失败”并移出待人工处理队列。',
            '系统会保留操作人、时间、理由、变更前后状态和原消息记录。',
          ]}
          confirmLabel="确认忽略"
          reasonLabel="忽略理由"
          reasonPlaceholder="例如：业务已通过电话确认，无需再补发"
          onConfirm={() => setActiveDecision('ignored')}
        />
      </div>

      {state ? (
        <ActionNotice
          tone={state.status === 'error' ? 'error' : 'success'}
          title={state.message}
          className="max-w-96 p-2 text-left [&_[data-slot=action-notice-title]]:text-xs"
        />
      ) : null}
    </div>
  );
}

function ResolutionIdentity({
  logId,
  stateVersion,
}: {
  logId: string;
  stateVersion: number;
}) {
  return (
    <>
      <input type="hidden" name="logId" value={logId} />
      <input type="hidden" name="stateVersion" value={stateVersion} />
    </>
  );
}
