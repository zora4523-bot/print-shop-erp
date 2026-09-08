'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PendingButton } from '@/components/ui-business';
import type { NotificationMutationResult } from '@/actions/owner-notifications.types';

type EditInitial = {
  channelKey: string;
  channelName: string;
  smartBotTargetMasked: string | null;
  smartBotChatType: 'SINGLE' | 'GROUP' | null;
  smartBotBoundAt: string | null;
  smartBotBotMatchesConfigured: boolean;
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
  const smartBotBound = Boolean(initial?.smartBotBoundAt);
  const smartBotBotMatchesConfigured =
    initial?.smartBotBotMatchesConfigured ?? true;
  const [isActive, setIsActive] = useState(initial?.isActive ?? false);
  const fieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="channelKey">通知目标标识</Label>
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
        <Label htmlFor="channelName">通知目标名称</Label>
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
        <Label htmlFor="transport">通知方式</Label>
        <input type="hidden" name="transport" value="WECOM_SMART_BOT" />
        <Input
          id="transport"
          value="企业微信群"
          readOnly
          className="bg-muted/30"
        />
        {fieldErrors?.transport?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
        <p className="font-medium">群聊绑定</p>
        {isCreate ? (
          <p className="text-muted-foreground">
            先保存通知目标，再生成绑定码并发送到目标企业微信群。
          </p>
        ) : smartBotBound && !smartBotBotMatchesConfigured ? (
          <div className="space-y-1 text-destructive">
            <p>
              机器人账号已变更，当前群暂停推送。
            </p>
            <p>
              请联系管理员恢复原机器人账号，或新建通知目标绑定当前机器人。
            </p>
          </div>
        ) : smartBotBound ? (
          <div className="space-y-1 text-muted-foreground">
            <p>
              已绑定{initial?.smartBotChatType === 'GROUP' ? '群聊' : '会话'}：
              <span className="ml-1 font-mono text-foreground">
                {initial?.smartBotTargetMasked ?? '已隐藏'}
              </span>
            </p>
            <p>
              如需换群，请新建通知目标。
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            尚未绑定企业微信群。请先保存名称，再在下方生成一次性绑定码。
          </p>
        )}
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <Checkbox
          id="isActive"
          name="isActive"
          checked={isActive}
          disabled={
            pending ||
            ((isCreate || !smartBotBound || !smartBotBotMatchesConfigured) &&
              !isActive)
          }
          onCheckedChange={(checked) => setIsActive(checked === true)}
          aria-label="启用"
          aria-invalid={!!fieldErrors?.isActive}
          aria-describedby={fieldErrors?.isActive ? 'isActive-error' : undefined}
        />
        <span className="min-w-0 py-2">
          启用
        </span>
      </label>

      {fieldErrors?.isActive ? (
        <p id="isActive-error" role="alert" className="text-sm text-destructive">
          {fieldErrors.isActive.join('；')}
        </p>
      ) : null}

      {isCreate || !smartBotBound ? (
        <p className="text-xs text-muted-foreground">绑定后可启用。</p>
      ) : null}

      {state?.status === 'error' ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <PendingButton pending={pending} pendingLabel="保存中…">
          {isCreate ? '创建通知目标' : '保存修改'}
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
