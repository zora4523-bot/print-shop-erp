'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionController, ConfirmActionDialog,
  DisabledReason,
} from '@/components/ui-business';
import { deleteChannelAction } from '@/actions/owner-notifications';

type Props = {
  channelId: string;
  channelName: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function DeleteChannelButton({
  channelId,
  channelName,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (disabled) {
    return (
      <DisabledReason
        cause="prerequisite"
        reason={disabledReason ?? '当前群仍被规则引用'}
        fixHref="/owner/notifications#notification-rules"
        fixLabel="去规则移除"
        className="items-end text-right"
      >
        <Button type="button" size="sm" variant="outline" disabled>
          删除
        </Button>
      </DisabledReason>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2" aria-busy={pending}>
      <ConfirmActionController level="L2"
        disabled={pending}
        trigger={
          <Button type="button" size="sm" variant="destructive" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                删除中…
              </>
            ) : (
              '删除'
            )}
          </Button>
        }
        onConfirm={() => {
          setErrorMessage(null);
          startTransition(async () => {
            const result = await deleteChannelAction(channelId);
            if (result.status === 'error') {
              setErrorMessage(result.message);
              return;
            }
            // Direct action calls do not refresh the client RSC cache by
            // themselves; fetch the list again so the removed row disappears.
            router.refresh();
          });
        }}>
        <ConfirmActionDialog action={`删除“${channelName}”？`} changes={[]} consequences={[
          '该群配置会从系统中永久删除。',
          '存在规则或历史投递记录时无法删除。',
        ]} confirmText="删除" />
      </ConfirmActionController>
      {errorMessage ? (
        <ActionNotice
          tone="error"
          title="删除失败"
          description={errorMessage}
          className="max-w-sm p-2 text-left"
        />
      ) : null}
    </div>
  );
}
