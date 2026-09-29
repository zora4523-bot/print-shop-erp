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
  ConfirmActionController, ConfirmActionDialog,
  DisabledReason,
} from '@/components/ui-business';

type ActiveDecision = 'delivered' | 'retry' | 'ignored';

export function UnknownNotificationActions({
  logId,
  stateVersion,
  retryUnavailableReason,
}: {
  logId: string;
  stateVersion: number;
  /** null = 可以重发；否则为服务端给出的不可重发原因。 */
  retryUnavailableReason: string | null;
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
        <ConfirmActionController level="L2"
          formId={deliveredFormId}
          disabled={pending}
          trigger={
            <Button type="button" size="xs" variant="secondary" disabled={pending}>
              {deliveredPending ? '正在处理…' : '确认已送达'}
            </Button>
          }
          onConfirm={() => setActiveDecision('delivered')}>
          <ConfirmActionDialog action="确认该消息已送达" changes={[]} consequences={[
            '该消息不再重发。',
          ]} confirmText="确认已送达" />
        </ConfirmActionController>

        {retryUnavailableReason === null ? (
          <ConfirmActionController level="L2"
            formId={retryFormId}
            disabled={pending}
            trigger={
              <Button type="button" size="xs" variant="outline" disabled={pending}>
                {retryPending ? '正在入队…' : '确认未送达并重发'}
              </Button>
            }
            onConfirm={() => setActiveDecision('retry')}>
            <ConfirmActionDialog action="确认未送达并安全重发" changes={[]} consequences={[
              '使用原消息内容和原投递目标，不套用当前规则。',
              '其余结果不明的投递核对完成后重发。',
            ]} confirmText="确认未送达并重发" />
          </ConfirmActionController>
        ) : (
          <DisabledReason
            cause="status"
            reason={retryUnavailableReason}
            className="items-end text-right [&_[data-slot=disabled-reason-copy]]:max-w-72 [&_[data-slot=disabled-reason-copy]]:text-xs"
          >
            <Button type="button" size="xs" variant="outline" disabled>
              确认未送达并重发
            </Button>
          </DisabledReason>
        )}

        <ConfirmActionController level="L3"
          formId={ignoredFormId}
          disabled={pending}
          trigger={
            <Button type="button" size="xs" variant="destructive" disabled={pending}>
              {ignoredPending ? '正在处理…' : '忽略'}
            </Button>
          }
          reasonLabel="忽略理由"
          reasonPlaceholder="例如：业务已通过电话确认，无需再补发"
          onConfirm={() => setActiveDecision('ignored')}>
          <ConfirmActionDialog action="忽略该条结果不明的消息" changes={[]} consequences={[
            '该消息移出待处理列表。',
          ]} confirmText="忽略此通知" />
        </ConfirmActionController>
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
