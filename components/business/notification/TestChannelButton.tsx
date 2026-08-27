'use client';

import { useRouter } from 'next/navigation';
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
};

export function TestChannelButton({
  channelId,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ChannelTestResult | null>(null);

  if (disabled) {
    return (
      <DisabledReason
        cause="prerequisite"
        reason={disabledReason ?? '当前群不可测试'}
        fixHref={`/owner/notifications/channels/${channelId}`}
        fixLabel="去启用群"
        className="items-end text-right"
      >
        <Button type="button" size="sm" variant="secondary" disabled>
          测试
        </Button>
      </DisabledReason>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2" aria-busy={pending}>
      <PendingButton
        type="button"
        size="sm"
        variant="secondary"
        pending={pending}
        pendingLabel="发送中…"
        title="发送测试消息（测试模式下不会实际发送）"
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const nextResult = await testChannelAction(channelId);
            setResult(nextResult);
            if (nextResult.status === 'success') {
              // Refresh the recent-log table after the direct action call.
              router.refresh();
            }
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
