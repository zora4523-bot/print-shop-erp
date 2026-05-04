'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="channelKey">channelKey（标识符，建好后不可改）</Label>
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
          英文小写 / 数字 / 下划线，如 <code>scheduling_group</code>、
          <code>owner_group</code>、<code>shipping_group</code>。系统内部使用，
          不展示给群成员。
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
          来自企业微信群机器人配置页面。仅老板可见 / 编辑。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={initial?.isActive ?? true}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="isActive" className="cursor-pointer">
          启用（关闭后该群暂停接收推送，但保留配置）
        </Label>
      </div>

      {state?.status === 'error' ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {isCreate ? '创建群' : '保存修改'}
        </Button>
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
