'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '../generated/prisma/client';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createNotificationChannelSchema,
  updateNotificationChannelSchema,
  updateNotificationRuleSchema,
} from '@/lib/auth/schemas';
import {
  ChannelInUseError,
  EmptyChannelIdsError,
  InactiveChannelBindError,
  RuleNotFoundError,
  StaleChannelIdsError,
  createChannel,
  deleteChannel,
  updateChannel,
  updateRuleWithGuard,
} from '@/lib/notification/admin';
import type { NotificationMutationResult, ChannelTestResult } from './owner-notifications.types';

// NB: 同 actions/owner-accounts.ts 的注释——`'use server'` module 只能
// 导出 async function；类型 re-export 会被 RSC 编译时静默吃掉。客户端
// 类型必须从 './owner-notifications.types' 直接 import。

function collectFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const head = issue.path[0];
    const key = head === undefined ? '_' : String(head);
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const CHANNEL_KEY_UNIQUE_SYNONYMS = [
  'channelKey',
  'NotificationChannel_channelKey_key',
] as const;

function matchesUnique(targets: string[], synonyms: readonly string[]): boolean {
  return targets.some((t) => synonyms.includes(t));
}

function mapPrismaError(err: unknown): NotificationMutationResult | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const raw = err.meta?.target;
      const targets: string[] = Array.isArray(raw)
        ? (raw as string[])
        : typeof raw === 'string'
          ? [raw]
          : [];
      if (matchesUnique(targets, CHANNEL_KEY_UNIQUE_SYNONYMS)) {
        return {
          status: 'invalid',
          fieldErrors: { channelKey: ['该 channelKey 已被占用'] },
        };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Channel CRUD
// ─────────────────────────────────────────────────────────────────────

export async function createChannelAction(
  _prev: NotificationMutationResult | null,
  formData: FormData,
): Promise<NotificationMutationResult> {
  await requirePermission('notification:config');

  const parsed = createNotificationChannelSchema.safeParse({
    channelKey: formData.get('channelKey'),
    channelName: formData.get('channelName'),
    webhookUrl: formData.get('webhookUrl'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  try {
    await createChannel(parsed.data);
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    return {
      status: 'error',
      message: err instanceof Error ? err.message : '创建失败',
    };
  }

  revalidatePath('/owner/notifications');
  redirect('/owner/notifications');
}

export async function updateChannelAction(
  channelId: string,
  _prev: NotificationMutationResult | null,
  formData: FormData,
): Promise<NotificationMutationResult> {
  await requirePermission('notification:config');

  const parsed = updateNotificationChannelSchema.safeParse({
    channelName: formData.get('channelName'),
    webhookUrl: formData.get('webhookUrl'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  try {
    await updateChannel(channelId, parsed.data);
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : '保存失败',
    };
  }

  revalidatePath('/owner/notifications');
  revalidatePath(`/owner/notifications/channels/${channelId}`);
  redirect('/owner/notifications');
}

export async function deleteChannelAction(
  channelId: string,
): Promise<NotificationMutationResult> {
  await requirePermission('notification:config');
  try {
    await deleteChannel(channelId);
  } catch (err) {
    if (err instanceof ChannelInUseError) {
      const refs = err.referencingRules.map((r) => r.eventType).join('、');
      return {
        status: 'error',
        message: `该群仍被 ${err.referencingRules.length} 条规则引用（含未启用：${refs}），先在规则里移除再删。`,
      };
    }
    // PG FK from NotificationLog —— 历史 log 引用此 channel 时 PG 拒删
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    ) {
      return {
        status: 'error',
        message: '该群有历史推送日志，无法删除。请改为停用（isActive=false）。',
      };
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : '删除失败',
    };
  }
  revalidatePath('/owner/notifications');
  return { status: 'success' };
}

// ─────────────────────────────────────────────────────────────────────
// Rule update
// ─────────────────────────────────────────────────────────────────────

export async function updateRuleAction(
  eventType: string,
  _prev: NotificationMutationResult | null,
  formData: FormData,
): Promise<NotificationMutationResult> {
  await requirePermission('notification:config');

  const parsed = updateNotificationRuleSchema.safeParse({
    messageTemplate: formData.get('messageTemplate'),
    channelIds: formData.getAll('channelIds').filter(
      (v): v is string => typeof v === 'string',
    ),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  try {
    await updateRuleWithGuard(eventType, parsed.data);
  } catch (err) {
    if (err instanceof EmptyChannelIdsError) {
      return {
        status: 'invalid',
        fieldErrors: { channelIds: ['启用规则时必须至少选择 1 个群'] },
      };
    }
    if (err instanceof StaleChannelIdsError) {
      return {
        status: 'invalid',
        fieldErrors: {
          channelIds: [
            `选中的群已被删除：${err.invalidIds.join('、')}。请重新选择。`,
          ],
        },
      };
    }
    if (err instanceof InactiveChannelBindError) {
      return {
        status: 'invalid',
        fieldErrors: {
          channelIds: [
            `不能新绑定已停用的群：${err.inactiveIds.join('、')}。请先到群配置启用。`,
          ],
        },
      };
    }
    if (err instanceof RuleNotFoundError) {
      return {
        status: 'error',
        message: `事件 ${err.eventType} 不存在或已下线`,
      };
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : '保存失败',
    };
  }

  revalidatePath('/owner/notifications');
  revalidatePath(`/owner/notifications/rules/${eventType}`);
  redirect('/owner/notifications');
}

// ─────────────────────────────────────────────────────────────────────
// Test 按钮：触发一次 mock notify 到指定 channel（一次性 ad-hoc rule）
// ─────────────────────────────────────────────────────────────────────

/**
 * Channel 测试按钮：让 owner 在配好 webhookUrl 后点一下，验证链路
 * 通畅。实现：临时 monkey-patch rule 走法不行（rule 是 DB 配置）；
 * 干脆走&ldquo;独立&rdquo;路径——直接构造一份测试 webhook 调用，写一条
 * NotificationLog 标记 eventType='__TEST__'。
 *
 * 范围注：
 * - 不调 notify()——notify 的入口是 event-driven，要求 rule 存在。
 *   测试不该新增临时 rule。
 * - 直接 import sendWebhook + 写 log 重复了 notify 的少量逻辑，但
 *   测试场景本来就&ldquo;旁路&rdquo;主流程，复用 notify 反而把 rule lookup
 *   等无关分支拖进来。
 * - mock-mode 下不真发 HTTP，给 owner 的反馈是&ldquo;链路通了，等真
 *   webhook URL 上线再切&rdquo;。
 */
export async function testChannelAction(
  channelId: string,
): Promise<ChannelTestResult> {
  await requirePermission('notification:config');

  // 走真 notify() 的 mock 模式——但需要一个临时 rule。最简：直接调
  // sendWebhook + 写 log。复制少量逻辑值得，避免污染 NotificationRule
  // 表。
  const { db } = await import('@/lib/db');
  const { sendWebhook, mockWebhookSender } = await import(
    '@/lib/notification/webhook'
  );
  const { isMockMode } = await import('@/lib/notification/notify');
  const { NotificationStatus } = await import(
    '../generated/prisma/enums'
  );

  const channel = await db.notificationChannel.findUnique({
    where: { id: channelId },
    select: { id: true, webhookUrl: true, isActive: true },
  });
  if (!channel) {
    return { status: 'error', message: '该群不存在' };
  }
  if (!channel.isActive) {
    return { status: 'error', message: '该群已停用，请先启用再测试' };
  }

  const mock = isMockMode();
  const sender = mock ? mockWebhookSender : sendWebhook;
  const content = `**[测试推送]**\n这是一条来自 ERP 后台的测试消息。\n如能在该群看到此消息，说明 webhook 配置正确。`;

  let result;
  try {
    result = await sender(channel.webhookUrl, content);
  } catch (err) {
    result = {
      ok: false as const,
      retries: 0,
      errorMessage: err instanceof Error ? err.name : 'sender error',
    };
  }

  // eventType='__TEST__' 让 log 列表能区分测试 / 真实推送（dashboard
  // 默认隐藏 __TEST__；owner 在 channel 编辑页能看到测试历史）
  try {
    await db.notificationLog.create({
      data: {
        eventType: '__TEST__',
        channelId: channel.id,
        messageContent: content,
        status: result.ok
          ? NotificationStatus.SUCCESS
          : NotificationStatus.FAILED,
        errorMessage: result.ok
          ? mock
            ? 'MOCK'
            : null
          : (result.errorMessage ?? 'unknown error'),
        retryCount: result.retries,
        relatedOrderId: null,
        sentAt: result.ok ? new Date() : null,
      },
    });
  } catch {
    // log 写入失败不挂主路径
  }

  revalidatePath('/owner/notifications');

  if (result.ok) {
    return { status: 'success', mock };
  }
  return {
    status: 'error',
    message: `测试失败：${result.errorMessage ?? 'unknown'}`,
  };
}

