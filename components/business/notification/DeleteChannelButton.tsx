'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
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

  if (disabled) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        title={disabledReason}
      >
        删除
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        // 注意这是 JS 模板字符串不是 JSX：HTML 实体不会被解析，必须写
        // 字面量引号，否则用户看到的是 `确定删除&ldquo;渠道名&rdquo;？`。
        if (!confirm(`确定删除“${channelName}”？此操作不可撤销。`)) return;
        startTransition(async () => {
          const r = await deleteChannelAction(channelId);
          if (r.status === 'error') {
            alert(r.message);
            return;
          }
          // revalidatePath alone 不刷 client RSC 缓存（直调 server
          // action 没经过 Form 自动 refresh）；显式 router.refresh()
          // 让 landing 页 re-fetch 不再显示已删行。
          router.refresh();
        });
      }}
    >
      {pending ? '删除中…' : '删除'}
    </Button>
  );
}
