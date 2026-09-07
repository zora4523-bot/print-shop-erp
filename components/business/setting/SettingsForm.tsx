'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DisabledReason } from '@/components/ui-business';
import { updateSettingsAction } from '@/actions/owner-settings';
import type { SettingsMutationResult } from '@/actions/owner-settings.types';
import {
  SETTING_KEYS,
  SETTING_METADATA,
  type SettingKey,
} from '@/lib/settings/metadata';
import {
  notificationChannelSelectionIssueMessage,
  type NotificationChannelSelectionIssue,
} from '@/lib/notification/channel-selection';

type Props = {
  // 由 Server Component 读好当前值传进来（页面层不直连 Prisma 之外的东西，
  // 这里只负责渲染）。key → 输入框里该显示的字符串。
  initialValues: Record<SettingKey, string>;
  notificationChannels?: readonly {
    id: string;
    channelKey: string;
    channelName: string;
    isActive: boolean;
    selectionIssue: NotificationChannelSelectionIssue | null;
  }[];
};

export function SettingsForm({
  initialValues,
  notificationChannels = [],
}: Props) {
  // 直接把 Server Action 引用交给 useActionState、再原样传给 <form action>，
  // 保住零 JS 提交路径（CLAUDE.md §15.8）。不要用箭头函数包一层。
  const [state, formAction, pending] = useActionState<
    SettingsMutationResult | null,
    FormData
  >(updateSettingsAction, null);

  return (
    <form action={formAction} aria-busy={pending}>
      <fieldset disabled={pending} className="space-y-6 border-0 p-0">
        <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
          {SETTING_KEYS.map((key) => (
            <SettingField
              // The action revalidates this Server Component and can return a
              // new saved default. Base UI correctly warns when an uncontrolled
              // input's defaultValue changes in place, so remount only that
              // field when its persisted value changes. Invalid submissions keep
              // the same key and therefore preserve the user's attempted input.
              key={`${key}:${initialValues[key]}`}
              settingKey={key}
              defaultValue={initialValues[key]}
              errors={fieldErrors(state, key)}
              notificationChannels={notificationChannels}
            />
          ))}
        </div>

        {state?.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {state?.status === 'success' ? (
          <p role="status" className="text-sm text-success-foreground">
            {state.message ?? '设置已保存'}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : '保存设置'}
        </Button>
      </fieldset>
    </form>
  );
}

function SettingField({
  settingKey,
  defaultValue,
  errors,
  notificationChannels,
}: {
  settingKey: SettingKey;
  defaultValue: string;
  errors: string[];
  notificationChannels: NonNullable<Props['notificationChannels']>;
}) {
  const definition = SETTING_METADATA[settingKey];
  const { field } = definition;
  const hasError = errors.length > 0;
  const errorId = `${settingKey}-error`;
  const helpId = `${settingKey}-help`;

  if (field.kind === 'management-notification-routing') {
    return (
      <ManagementNotificationRoutingField
        settingKey={settingKey}
        defaultValue={defaultValue}
        channels={notificationChannels}
        helpId={helpId}
        errorId={errorId}
        hasError={hasError}
        errors={errors}
      />
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={settingKey} className="text-sm font-medium">
        {definition.label}
      </Label>
      <p id={helpId} className="text-xs text-muted-foreground">
        {definition.help}
      </p>
      <div className="flex items-center gap-2">
        {field.kind === 'boolean' ? (
          <select
            id={settingKey}
            name={settingKey}
            defaultValue={defaultValue}
            aria-invalid={hasError}
            aria-describedby={hasError ? `${errorId} ${helpId}` : helpId}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        ) : field.kind === 'int' ? (
          <Input
            id={settingKey}
            name={settingKey}
            defaultValue={defaultValue}
            aria-invalid={hasError}
            // 说明文字始终关联，出错时把错误排在前面先读
            aria-describedby={hasError ? `${errorId} ${helpId}` : helpId}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            className="max-w-32"
          />
        ) : (
          <Input
            id={settingKey}
            name={settingKey}
            defaultValue={defaultValue}
            aria-invalid={hasError}
            aria-describedby={hasError ? `${errorId} ${helpId}` : helpId}
            type="text"
            maxLength={field.maxLength}
            className="max-w-md"
          />
        )}
        {field.kind === 'int' ? (
          <span className="text-sm text-muted-foreground">{field.unit}</span>
        ) : null}
      </div>
      {hasError ? (
        // 逐字段错误不标 role="alert"：靠 aria-describedby 与控件关联，
        // 聚焦时读屏器自然读出来，不抢播报。与 EditOrderForm 一致。
        <p id={errorId} className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

type RoutingValue = {
  factoryConfirmer: { enabled: boolean; channelIds: string[] };
  owner: { enabled: boolean; channelIds: string[] };
};

const EMPTY_ROUTING: RoutingValue = {
  factoryConfirmer: { enabled: false, channelIds: [] },
  owner: { enabled: false, channelIds: [] },
};

function parseRoutingValue(raw: string): RoutingValue {
  try {
    const value = JSON.parse(raw) as Partial<RoutingValue>;
    if (
      typeof value.factoryConfirmer?.enabled !== 'boolean' ||
      !Array.isArray(value.factoryConfirmer.channelIds) ||
      typeof value.owner?.enabled !== 'boolean' ||
      !Array.isArray(value.owner.channelIds)
    ) {
      return EMPTY_ROUTING;
    }
    return {
      factoryConfirmer: {
        enabled: value.factoryConfirmer.enabled,
        channelIds: value.factoryConfirmer.channelIds.filter(
          (id): id is string => typeof id === 'string',
        ),
      },
      owner: {
        enabled: value.owner.enabled,
        channelIds: value.owner.channelIds.filter(
          (id): id is string => typeof id === 'string',
        ),
      },
    };
  } catch {
    return EMPTY_ROUTING;
  }
}

function ManagementNotificationRoutingField({
  settingKey,
  defaultValue,
  channels,
  helpId,
  errorId,
  hasError,
  errors,
}: {
  settingKey: SettingKey;
  defaultValue: string;
  channels: NonNullable<Props['notificationChannels']>;
  helpId: string;
  errorId: string;
  hasError: boolean;
  errors: string[];
}) {
  const definition = SETTING_METADATA[settingKey];
  const routing = parseRoutingValue(defaultValue);
  const roles = [
    {
      key: 'factoryConfirmer' as const,
      label: '工厂确认人',
      events: '新单提交、变更/取消申请',
    },
    {
      key: 'owner' as const,
      label: '老板',
      events: '报工进度异常、生产停滞、待确认积压',
    },
  ];

  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">{definition.label}</div>
      <p id={helpId} className="text-xs text-muted-foreground">
        {definition.help}
      </p>
      <div
        className="grid gap-3 lg:grid-cols-2"
        aria-invalid={hasError}
        aria-describedby={hasError ? `${errorId} ${helpId}` : helpId}
      >
        {roles.map((role) => {
          const current = routing[role.key];
          const selected = new Set(current.channelIds);
          const visibleChannels = channels.filter(
            (channel) => channel.selectionIssue !== 'LEGACY_TRANSPORT' || selected.has(channel.id),
          );
          const prefix = `${settingKey}.${role.key}`;
          return (
            <section
              key={role.key}
              className="space-y-3 rounded-lg border bg-muted/10 p-4"
              aria-label={`${role.label}通知路由`}
            >
              <div>
                <div className="text-sm font-medium">{role.label}</div>
                <p className="text-xs text-muted-foreground">
                  固定事件：{role.events}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`${prefix}.enabled`} className="text-xs">
                  角色开关
                </Label>
                <select
                  id={`${prefix}.enabled`}
                  name={`${prefix}.enabled`}
                  defaultValue={String(current.enabled)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </div>
              {visibleChannels.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  暂无企业微信群，请先到“推送配置”新建并验证群。
                </p>
              ) : (
                <div
                  className="space-y-1 rounded-md border bg-background p-2"
                  role="group"
                  aria-label={`${role.label}接收群`}
                >
                  {visibleChannels.map((channel) => {
                    const isSelected = selected.has(channel.id);
                    const disabled =
                      channel.selectionIssue !== null && !isSelected;
                    const issueMessage = channel.selectionIssue
                      ? notificationChannelSelectionIssueMessage(
                          channel.selectionIssue,
                        )
                      : null;
                    const option = (
                      <label
                        className="flex min-h-10 cursor-pointer items-center gap-1 rounded-md pr-2 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
                      >
                        <Checkbox
                          name={`${prefix}.channelIds`}
                          value={channel.id}
                          defaultChecked={isSelected}
                          disabled={disabled}
                          aria-label={`${role.label}：${channel.channelName}`}
                        />
                        <span className="min-w-0 py-2">
                          {channel.channelName}
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {channel.channelKey}
                          </span>
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
                        key={channel.id}
                        cause="prerequisite"
                        reason={`${issueMessage ?? '该通知目标当前不可用'}，不可新绑`}
                        fixHref={`/owner/notifications/channels/${channel.id}`}
                        fixLabel="查看通知目标"
                        className="[&_[data-slot=disabled-reason-copy]]:text-xs"
                      >
                        {option}
                      </DisabledReason>
                    ) : (
                      <div key={channel.id}>{option}</div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {hasError ? (
        <p id={errorId} className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function fieldErrors(
  state: SettingsMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}
