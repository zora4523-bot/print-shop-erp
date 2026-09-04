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
  transport: NotificationChannelTransportValue;
  webhookUrl: string | null;
  smartBotTargetMasked: string | null;
  smartBotChatType: 'SINGLE' | 'GROUP' | null;
  smartBotBoundAt: string | null;
  smartBotBotMatchesConfigured: boolean;
  isActive: boolean;
};

export type NotificationChannelTransportValue =
  | 'WECOM_GROUP_WEBHOOK'
  | 'WECOM_SMART_BOT';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const TRANSPORT_LABELS: Record<NotificationChannelTransportValue, string> = {
  WECOM_SMART_BOT: 'Bot ID + Secret 智能机器人',
  WECOM_GROUP_WEBHOOK: '群机器人 Webhook（兼容方式）',
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
  const [transport, setTransport] =
    useState<NotificationChannelTransportValue>(
      initial?.transport ?? 'WECOM_SMART_BOT',
    );
  const smartBotBound = Boolean(initial?.smartBotBoundAt);
  const smartBotBotMatchesConfigured =
    initial?.smartBotBotMatchesConfigured ?? true;
  const [isActive, setIsActive] = useState(initial?.isActive ?? false);
  const fieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="channelKey">通知目标标识（创建后不可修改）</Label>
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
        <Label htmlFor="channelName">通知目标名称（用于后台展示）</Label>
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
        <Label htmlFor="transport">传输方式</Label>
        {isCreate ? (
          <select
            id="transport"
            name="transport"
            className={selectClass}
            value={transport}
            disabled={pending}
            aria-invalid={!!fieldErrors?.transport}
            onChange={(event) => {
              const next = event.target
                .value as NotificationChannelTransportValue;
              setTransport(next);
              setIsActive(next === 'WECOM_GROUP_WEBHOOK');
            }}
          >
            <option value="WECOM_SMART_BOT">
              {TRANSPORT_LABELS.WECOM_SMART_BOT}
            </option>
            <option value="WECOM_GROUP_WEBHOOK">
              {TRANSPORT_LABELS.WECOM_GROUP_WEBHOOK}
            </option>
          </select>
        ) : (
          <>
            <input type="hidden" name="transport" value={transport} />
            <Input
              id="transport"
              value={TRANSPORT_LABELS[transport]}
              readOnly
              className="bg-muted/30"
            />
          </>
        )}
        {fieldErrors?.transport?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          传输方式创建后不可修改。
        </p>
      </div>

      {transport === 'WECOM_GROUP_WEBHOOK' ? (
        <div className="space-y-2">
          <Label htmlFor="webhookUrl">企业微信 Webhook URL</Label>
          <Input
            id="webhookUrl"
            name="webhookUrl"
            defaultValue={initial?.webhookUrl ?? ''}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            required
            disabled={pending}
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
      ) : (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
          <p className="font-medium">智能机器人长连接</p>
          {isCreate ? (
            <p className="text-muted-foreground">
              Bot ID 与 Secret 由运维通过服务端环境变量统一配置。创建后需要在目标企业微信群中发送一次性绑定码，绑定完成前不能启用或测试。
            </p>
          ) : smartBotBound && !smartBotBotMatchesConfigured ? (
            <div className="space-y-1 text-destructive">
              <p>
                当前 Bot ID 与该群绑定时不一致，已阻止推送。
              </p>
              <p>
                请恢复原 Bot ID，或新建通知目标并重新绑定。当前目标只能停用，不能换绑。
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
                绑定目标不可更改；如需切换企业微信群，请新建通知目标并重新配置事件规则。
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              尚未绑定企业微信群。请先保存名称，再在下方生成一次性绑定码。
            </p>
          )}
        </div>
      )}

      <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <Checkbox
          id="isActive"
          name="isActive"
          checked={isActive}
          disabled={
            pending ||
            (transport === 'WECOM_SMART_BOT' &&
              (isCreate || !smartBotBound || !smartBotBotMatchesConfigured) &&
              !isActive)
          }
          onCheckedChange={(checked) => setIsActive(checked === true)}
          aria-label="启用"
        />
        <span className="min-w-0 py-2">
          启用（关闭后该目标暂停接收推送，但保留配置）
        </span>
      </label>

      {transport === 'WECOM_SMART_BOT' &&
      (isCreate || !smartBotBound || !smartBotBotMatchesConfigured) ? (
        <p className="text-xs text-muted-foreground">
          {smartBotBound && !smartBotBotMatchesConfigured
            ? '当前 Bot ID 不匹配，该目标不能再次启用。'
            : '智能机器人通道会先以停用状态保存；绑定企业微信群后才可启用。'}
        </p>
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
