import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { RuleForm } from '@/components/business/notification/RuleForm';
import { updateRuleAction } from '@/actions/owner-notifications';
import {
  getRule,
  listChannelsWithRefCount,
} from '@/lib/notification/admin';
import { NOTIFICATION_EVENTS } from '@/lib/notification';
import { NOTIFICATION_PAYLOAD_FIELDS } from '@/lib/notification/payload-fields';

export const metadata = { title: '编辑事件规则 · 推送配置' };

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ event: string }>;
}) {
  await requirePermission('notification:config');
  const { event } = await params;

  // event 合法性双闸：URL 直接打不存在的事件会 notFound
  const valid = (Object.values(NOTIFICATION_EVENTS) as string[]).includes(
    event,
  );
  if (!valid) notFound();

  const [rule, channels] = await Promise.all([
    getRule(event),
    listChannelsWithRefCount(),
  ]);
  if (!rule) notFound();

  // payloadFields 是事件 payload 类型对应的可用 placeholder。从
  // lib/notification/payload-fields 取（runtime const，与 events.ts
  // 类型一一对应）。
  const payloadFields =
    NOTIFICATION_PAYLOAD_FIELDS[
      event as keyof typeof NOTIFICATION_PAYLOAD_FIELDS
    ] ?? [];

  const action = updateRuleAction.bind(null, event);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑事件规则</h1>
        <p className="text-sm text-muted-foreground">
          模板支持 Markdown 和列出的占位符；至少选择一个群并启用后才会推送。
        </p>
      </div>
      <RuleForm
        eventType={event}
        initial={{
          messageTemplate: rule.messageTemplate,
          channelIds: rule.channelIds,
          isActive: rule.isActive,
        }}
        channels={channels.map((c) => ({
          id: c.id,
          channelName: c.channelName,
          isActive: c.isActive,
        }))}
        payloadFields={payloadFields}
        action={action}
      />
    </div>
  );
}
