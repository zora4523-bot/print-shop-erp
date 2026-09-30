'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  DisabledReason,
  PendingButton,
} from '@/components/ui-business';
import { testChannelAction } from '@/actions/owner-notifications';
import type { ChannelTestResult } from '@/actions/owner-notifications.types';

type Props = {
  channelId: string;
  disabled?: boolean;
  disabledReason?: string;
  disabledFixLabel?: string;
};

export function TestChannelButton({
  channelId,
  disabled,
  disabledReason,
  disabledFixLabel,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ChannelTestResult | null>(null);

  if (disabled) {
    return (
      <DisabledReason
        cause="prerequisite"
        reason={disabledReason ?? '当前群不可测试'}
        fixHref={`/owner/notifications/channels/${channelId}`}
        fixLabel={disabledFixLabel ?? '去启用通知目标'}
        className="items-end self-start text-right"
      >
        <Button type="button" size="sm" variant="secondary" disabled>
          测试
        </Button>
      </DisabledReason>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2 self-start" aria-busy={pending}>
      <PendingButton
        type="button"
        size="sm"
        variant="secondary"
        pending={pending}
        pendingLabel="正在发送…"
        title="发送测试消息（测试模式下不会实际发送）"
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const nextResult = await testChannelAction(channelId);
            // success/queued both revalidate /owner/notifications, so the
            // recent-log table arrives with the action response (DECISIONS 2026-08-27).
            setResult(nextResult);
          });
        }}
      >
        测试
      </PendingButton>
      {result?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title={result.mock ? '测试结果已记录' : '测试消息已发送'}
          description={
            result.mock
              ? '当前为测试模式，未向企业微信群发送消息。'
              : '请到对应企业微信群核对消息。'
          }
          className="max-w-sm p-2 text-left"
        />
      ) : null}
      {result?.status === 'queued' ? (
        <ActionNotice
          tone="info"
          title={result.mock ? '测试任务已记录' : '测试消息已排队'}
          description={
            result.mock
              ? '当前为测试模式，不会发送群消息。'
              : '请稍后刷新并查看投递结果。'
          }
          className="max-w-sm p-2 text-left"
        />
      ) : null}
      {result?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="测试发送失败"
          description={result.message}
          className="max-w-sm p-2 text-left"
        />
      ) : null}
    </div>
  );
}
