'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DisabledReason, PendingButton } from '@/components/ui-business';
import type { NotificationMutationResult } from '@/actions/owner-notifications.types';
import { notificationEventLabel } from '@/lib/notification/event-labels';

type ChannelOption = {
  id: string;
  channelName: string;
  isActive: boolean;
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
              <code className="rounded bg-muted px-1">{`{${f}}`}</code>
            </span>
          ))}
        </p>
        {/* totalAmount / totalSales / commission 是&ldquo;千分位 + 2 位小数&rdquo;
            纯数字，**不**含 ¥ 前缀。需要货币符号请在模板里手写
            （如默认 `金额：¥{totalAmount}` →&ldquo;金额：¥1,234.56&rdquo;）。
            避免 owner 误以为占位符已含 ¥。 */}
        {payloadFields.some((f) =>
          /^(totalAmount|totalSales|commission)$/.test(f),
        ) ? (
          <p className="text-xs text-muted-foreground">
            金额类占位符（<code className="rounded bg-muted px-1">totalAmount</code>
            / <code className="rounded bg-muted px-1">totalSales</code> /
            <code className="rounded bg-muted px-1">commission</code>
            ）只是千分位数字，<strong>不含</strong>货币符号。需要 ¥ 请在模板里手写。
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <Label>推送到群（多选）</Label>
        {(eventType === 'CS_PERIOD_ENDING' ||
          eventType === 'CS_PERIOD_SETTLED') && channels.length > 0 ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            此事件包含客服业绩和提成。为避免不同客服看到彼此金额，
            启用时<strong>只能选择一个推送群</strong>；停用时可暂存多个选项。
          </p>
        ) : null}
        {channels.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            还没建任何群。请先{' '}
            <Link
              href="/owner/notifications/channels/new"
              className="font-medium underline"
            >
              新建群
            </Link>
            。
          </p>
        ) : (
          <div className="space-y-2 rounded-md border bg-card p-3">
            {channels.map((c) => {
              const isSelected = selected.has(c.id);
              // inactive channel
              // 的 checkbox 三态语义：
              //   - active → enabled，正常勾/反勾
              //   - inactive 已绑定 → enabled，让 owner 看到现状、决定
              //     保留还是手动取消（保留 round 103 修的"停用 channel
              //     不丢现有 binding"承诺）
              //   - inactive 未绑定 → disabled，禁止新绑（否则 notify()
              //     必失败，dashboard 永红）
              const disabled = !c.isActive && !isSelected;
              const option = (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="channelIds"
                    value={c.id}
                    defaultChecked={isSelected}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className={c.isActive ? '' : 'text-muted-foreground'}>
                    {c.channelName}
                    {!c.isActive ? '（已停用）' : ''}
                  </span>
                </label>
              );
              return disabled ? (
                <DisabledReason
                  key={c.id}
                  cause="prerequisite"
                  reason="该群已停用，不可新绑"
                  fixHref={`/owner/notifications/channels/${c.id}`}
                  fixLabel="去启用群"
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

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={initial.isActive}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="isActive" className="cursor-pointer">
          启用此规则（关闭后此事件不再触发推送）
        </Label>
      </div>

      {state?.status === 'error' ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <PendingButton pending={pending} pendingLabel="保存中…">
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
