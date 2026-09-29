'use client';

import { AMOUNT_PAYLOAD_FIELD, payloadFieldLabel } from './payload-field-labels';
import Link from 'next/link';
import { useActionState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DisabledReason, PendingButton } from '@/components/ui-business';
import type { NotificationMutationResult } from '@/actions/owner-notifications.types';
import { notificationEventLabel } from '@/lib/notification/event-labels';
import { managementNotificationRoleForEvent } from '@/lib/notification/events';
import {
  notificationChannelSelectionIssueMessage,
  type NotificationChannelSelectionIssue,
} from '@/lib/notification/channel-selection';

type ChannelOption = {
  id: string;
  channelName: string;
  isActive: boolean;
  selectionIssue: NotificationChannelSelectionIssue | null;
};

type Props = {
  eventType: string;
  initial: {
    messageTemplate: string;
    channelIds: string[];
    isActive: boolean;
  };
  channels: readonly ChannelOption[];
  // payloadFields: 提示 owner 这个事件支持哪些 placeholder（来自
  // events.ts payload 类型，只读展示）
  payloadFields: readonly string[];
  action: (
    prev: NotificationMutationResult | null,
    fd: FormData,
  ) => Promise<NotificationMutationResult>;
};

export function RuleForm({
  eventType,
  initial,
  channels,
  payloadFields,
  action,
}: Props) {
  const [state, formAction, pending] = useActionState<
    NotificationMutationResult | null,
    FormData
  >(action, null);
  const fieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const selected = new Set(initial.channelIds);
  const visibleChannels = channels.filter(
    (c) => c.selectionIssue !== 'LEGACY_TRANSPORT' || selected.has(c.id),
  );
  const managementRole = managementNotificationRoleForEvent(eventType);

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5">
      <div className="space-y-2">
        <Label>事件</Label>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {notificationEventLabel(eventType)}
        </div>
        <p className="text-xs text-muted-foreground">
          事件类型固定，不可修改。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="messageTemplate">消息模板（Markdown）</Label>
        <textarea
          id="messageTemplate"
          name="messageTemplate"
          defaultValue={initial.messageTemplate}
          rows={8}
          required
          aria-invalid={!!fieldErrors?.messageTemplate}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {fieldErrors?.messageTemplate?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          可用占位符：
          {payloadFields.map((f, i) => (
            <span key={f}>
              {i > 0 ? '、' : ' '}
              <code className="rounded-md bg-muted px-1">{`{${f}}`}</code>
              {payloadFieldLabel(f) ? `（${payloadFieldLabel(f)}）` : null}
            </span>
          ))}
        </p>
        {/* totalAmount 是&ldquo;千分位 + 2 位小数&rdquo;
            纯数字，**不**含 ¥ 前缀。需要货币符号请在模板里手写
            （如默认 `金额：¥{totalAmount}` →&ldquo;金额：¥1,234.56&rdquo;）。
            避免 owner 误以为占位符已含 ¥。 */}
        {payloadFields.some((f) =>
          f === AMOUNT_PAYLOAD_FIELD,
        ) ? (
          <p className="text-xs text-muted-foreground">
            金额类占位符（<code className="rounded-md bg-muted px-1">{`{${AMOUNT_PAYLOAD_FIELD}}`}</code>
            总金额）只是千分位数字，<strong>不含</strong>货币符号。需要 ¥ 请在模板里手写。
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {managementRole ? '收件角色（固定）' : '推送到群（多选）'}
        </legend>
        {managementRole ? (
          <div className="rounded-md border bg-muted/20 px-3 py-3 text-sm">
            <p>
              此事件固定路由到
              <strong>
                {managementRole === 'factoryConfirmer'
                  ? '工厂确认人'
                  : '老板'}
              </strong>
              ，不使用本规则的群绑定。请到{' '}
              <Link href="/owner/settings" className="font-medium underline">
                系统设置
              </Link>{' '}
              配置该角色的开关和接收群。
            </p>
            {/* Preserve legacy bindings for rollback compatibility. Runtime
                routing ignores them for managed events, and direct form
                editing cannot silently delete historical configuration. */}
            {initial.channelIds.map((channelId) => (
              <input
                key={channelId}
                type="hidden"
                name="channelIds"
                value={channelId}
              />
            ))}
          </div>
        ) : visibleChannels.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            还没有智能机器人目标。请先{' '}
            <Link
              href="/owner/notifications/channels/new"
              className="font-medium underline"
            >
              新建智能机器人目标
            </Link>
            。
          </p>
        ) : (
          <div className="space-y-2 rounded-md border bg-card p-3">
            {visibleChannels.map((c) => {
              const isSelected = selected.has(c.id);
              // 不可用渠道的 checkbox 三态语义：
              //   - 可用 → enabled，正常勾/反勾
              //   - 不可用但已绑定 → enabled，让 owner 保留或取消旧绑定
              //   - 不可用且未绑定 → disabled，禁止新绑
              const disabled = c.selectionIssue !== null && !isSelected;
              const issueMessage = c.selectionIssue
                ? notificationChannelSelectionIssueMessage(c.selectionIssue)
                : null;
              const option = (
                <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
                  <Checkbox
                    name="channelIds"
                    value={c.id}
                    defaultChecked={isSelected}
                    disabled={pending || disabled}
                    aria-label={c.channelName}
                  />
                  <span
                    className={
                      issueMessage
                        ? 'min-w-0 py-2 text-muted-foreground'
                        : 'min-w-0 py-2'
                    }
                  >
                    {c.channelName}
                    {issueMessage ? (
                      <span className="ml-1 text-destructive">
                        （{issueMessage}
                        {isSelected ? '，请取消勾选或修复' : ''}）
                      </span>
                    ) : null}
                  </span>
                </label>
              );
              return disabled ? (
                <DisabledReason
                  key={c.id}
                  cause="prerequisite"
                  reason={`${issueMessage ?? '该通知目标当前不可用'}，不可新绑`}
                  fixHref={`/owner/notifications/channels/${c.id}`}
                  fixLabel="查看通知目标"
                  className="[&_[data-slot=disabled-reason-copy]]:text-xs"
                >
                  {option}
                </DisabledReason>
              ) : (
                <div key={c.id}>{option}</div>
              );
            })}
          </div>
        )}
        {fieldErrors?.channelIds?.map((m, i) => (
          <p key={i} className="text-sm text-destructive">
            {m}
          </p>
        ))}
      </fieldset>

      <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <Checkbox
          id="isActive"
          name="isActive"
          defaultChecked={initial.isActive}
          disabled={pending}
          aria-label="启用此规则"
        />
        <span className="min-w-0 py-2">
          启用此规则（关闭后此事件不再触发推送）
        </span>
      </label>

      {state?.status === 'error' ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <PendingButton pending={pending} pendingLabel="正在保存…">
          保存修改
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
