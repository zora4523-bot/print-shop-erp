'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { testChannelAction } from '@/actions/owner-notifications';

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

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled || pending}
      title={disabled ? disabledReason : '触发一条测试消息（mock-mode 下不真发）'}
      onClick={() => {
        startTransition(async () => {
          const r = await testChannelAction(channelId);
          if (r.status === 'success') {
            alert(
              r.mock
                ? '测试已触发（mock-mode：未真发 HTTP；NotificationLog 已写 SUCCESS / MOCK）'
                : '测试已发送，请到企业微信群核对消息',
            );
            // revalidatePath alone 不刷 client cache；显式 refresh
            // 让 landing 页&ldquo;最近推送日志&rdquo;表展示新增 __TEST__ 行。
            router.refresh();
          } else {
            alert(`测试失败：${r.message}`);
          }
        });
      }}
    >
      {pending ? '发送中…' : '测试'}
    </Button>
  );
}
