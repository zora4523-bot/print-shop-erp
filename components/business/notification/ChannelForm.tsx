'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PendingButton } from '@/components/ui-business';
import type { NotificationMutationResult } from '@/actions/owner-notifications.types';

type EditInitial = {
  channelKey: string;
  channelName: string;
  webhookUrl: string;
  isActive: boolean;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: NotificationMutationResult | null,
        fd: FormData,
      ) => Promise<NotificationMutationResult>;
    }
  | {
      mode: 'edit';
      action: (
        prev: NotificationMutationResult | null,
        fd: FormData,
      ) => Promise<NotificationMutationResult>;
      initial: EditInitial;
    };

export function ChannelForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    NotificationMutationResult | null,
    FormData
  >(props.action, null);

  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;
  const fieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="channelKey">群标识（创建后不可修改）</Label>
        {isCreate ? (
          <Input
            id="channelKey"
            name="channelKey"
            placeholder="scheduling_group"
            required
            aria-invalid={!!fieldErrors?.channelKey}
          />
        ) : (
          <Input
            id="channelKey"
            value={initial!.channelKey}
            readOnly
            className="bg-muted/30"
          />
        )}
        {fieldErrors?.channelKey?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          英文小写、数字或下划线，例如 <code>scheduling_group</code>。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="channelName">群名（用于后台展示）</Label>
        <Input
          id="channelName"
          name="channelName"
          defaultValue={initial?.channelName}
          placeholder="排产群"
          required
          aria-invalid={!!fieldErrors?.channelName}
        />
        {fieldErrors?.channelName?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="webhookUrl">企业微信 Webhook URL</Label>
        <Input
          id="webhookUrl"
          name="webhookUrl"
          defaultValue={initial?.webhookUrl}
          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
          required
          aria-invalid={!!fieldErrors?.webhookUrl}
        />
        {fieldErrors?.webhookUrl?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          从企业微信群机器人配置中复制。
        </p>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <Checkbox
          id="isActive"
          name="isActive"
          defaultChecked={initial?.isActive ?? true}
          disabled={pending}
          aria-label="启用"
        />
        <span className="min-w-0 py-2">
          启用（关闭后该群暂停接收推送，但保留配置）
        </span>
      </label>

      {state?.status === 'error' ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <PendingButton pending={pending} pendingLabel="保存中…">
          {isCreate ? '创建群' : '保存修改'}
        </PendingButton>
        <Link
          href="/owner/notifications"
          className={buttonVariants({ variant: 'outline' })}
        >
          取消
        </Link>
      </div>
    </form>
  );
}
