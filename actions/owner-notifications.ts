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
  TooManyChannelsForPrivateEventError,
  createChannel,
  deleteChannel,
  updateChannel,
  updateRuleWithGuard,
} from '@/lib/notification/admin';
import {
  UnknownNotificationResolutionError,
  resolveUnknownNotification,
} from '@/lib/notification/resolve';
import {
  TestChannelError,
  testChannel,
} from '@/lib/notification/test-channel';
import type {
  ChannelTestResult,
  NotificationMutationResult,
  NotificationResolutionResult,
} from './owner-notifications.types';
import { collectFieldErrors } from '@/lib/admin/action-helpers';
import { notificationEventLabel } from '@/lib/notification/event-labels';

// NB: 同 actions/owner-accounts.ts 的注释——`'use server'` module 只能
// 导出 async function；类型 re-export 会被 RSC 编译时静默吃掉。客户端
// 类型必须从 './owner-notifications.types' 直接 import。

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
          fieldErrors: { channelKey: ['该群标识已被占用'] },
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
    // Unknown error — rethrow to onRequestError → Sentry rather than
    // swallowing it into a toast (hides real faults from monitoring).
    throw err;
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
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    // Unknown error — rethrow to onRequestError → Sentry.
    throw err;
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
      const refs = err.referencingRules
        .map((rule) => notificationEventLabel(rule.eventType))
        .join('、');
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
        message: '该群有历史推送记录，无法删除。请改为停用。',
      };
    }
    // Unknown error — rethrow to onRequestError → Sentry.
    throw err;
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
    if (err instanceof TooManyChannelsForPrivateEventError) {
      return {
        status: 'invalid',
        fieldErrors: {
          channelIds: [
            '此事件含具体客服业绩 / 提成数据，最多绑 1 个群（避免不同客服互相看到金额）',
          ],
        },
      };
    }
    if (err instanceof StaleChannelIdsError) {
      return {
        status: 'invalid',
        fieldErrors: {
          channelIds: [
            '部分所选群已被删除，请重新选择。',
          ],
        },
      };
    }
    if (err instanceof InactiveChannelBindError) {
      return {
        status: 'invalid',
        fieldErrors: {
          channelIds: [
            '不能新绑定已停用的群，请先到群配置启用。',
          ],
        },
      };
    }
    if (err instanceof RuleNotFoundError) {
      return {
        status: 'error',
        message: '该事件不存在或已下线',
      };
    }
    // Unknown error — rethrow to onRequestError → Sentry.
    throw err;
  }

  revalidatePath('/owner/notifications');
  revalidatePath(`/owner/notifications/rules/${eventType}`);
  redirect('/owner/notifications');
}

// ──────────────────────────────────────────────────────────────────────
// UNKNOWN 人工处置
// ──────────────────────────────────────────────────────────────────────

export async function confirmUnknownNotificationDeliveredAction(
  _prev: NotificationResolutionResult | null,
  formData: FormData,
): Promise<NotificationResolutionResult> {
  const actor = await requirePermission('notification:config');
  const input = notificationResolutionInput(formData);
  if (!input) return { status: 'error', message: '推送日志状态参数无效' };

  let result: Awaited<ReturnType<typeof resolveUnknownNotification>>;
  try {
    result = await resolveUnknownNotification(
      input.logId,
      'DELIVERED',
      actor,
      input.stateVersion,
    );
  } catch (error) {
    const mapped = mapUnknownResolutionError(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath('/owner/notifications');
  revalidatePath('/owner/background-jobs');
  return {
    status: 'success',
    message:
      result.pendingUnknownCount > 0
        ? `已记录该群已送达；同一任务仍有 ${result.pendingUnknownCount} 条待核对`
        : result.rearmed
          ? '已记录该群已送达，其他已确认未送达的消息已重新入队'
          : '已记录人工核对：消息已送达',
  };
}

export async function retryUnknownNotificationAction(
  _prev: NotificationResolutionResult | null,
  formData: FormData,
): Promise<NotificationResolutionResult> {
  const actor = await requirePermission('notification:config');
  const input = notificationResolutionInput(formData);
  if (!input) return { status: 'error', message: '推送日志状态参数无效' };

  let result: Awaited<ReturnType<typeof resolveUnknownNotification>>;
  try {
    result = await resolveUnknownNotification(
      input.logId,
      'NOT_DELIVERED_RETRY',
      actor,
      input.stateVersion,
    );
  } catch (error) {
    const mapped = mapUnknownResolutionError(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath('/owner/notifications');
  revalidatePath('/owner/background-jobs');
  return {
    status: 'success',
    message:
      result.pendingUnknownCount > 0
        ? `已记录该群未送达；同一任务仍有 ${result.pendingUnknownCount} 条待核对，全部核对后再安全重发`
        : '已按原任务内容与原投递目标重新入队',
  };
}

export async function ignoreUnknownNotificationAction(
  _prev: NotificationResolutionResult | null,
  formData: FormData,
): Promise<NotificationResolutionResult> {
  const actor = await requirePermission('notification:config');
  const input = notificationResolutionInput(formData);
  const reason = notificationResolutionReason(formData);
  if (!input) return { status: 'error', message: '推送日志状态参数无效' };
  if (!reason) {
    return { status: 'error', message: '请填写 1–500 字的忽略理由' };
  }

  let result: Awaited<ReturnType<typeof resolveUnknownNotification>>;
  try {
    result = await resolveUnknownNotification(
      input.logId,
      'IGNORED',
      actor,
      input.stateVersion,
      reason,
    );
  } catch (error) {
    const mapped = mapUnknownResolutionError(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath('/owner/notifications');
  revalidatePath('/owner/background-jobs');
  return {
    status: 'success',
    message:
      result.pendingUnknownCount > 0
        ? `已记录忽略理由；同一任务仍有 ${result.pendingUnknownCount} 条待核对`
        : result.rearmed
          ? '已忽略该条，其他已确认未送达的消息已重新入队'
          : '已记录忽略理由并关闭该条待办',
  };
}

function notificationResolutionInput(
  formData: FormData,
): { logId: string; stateVersion: number } | null {
  const rawId = formData.get('logId');
  const rawVersion = formData.get('stateVersion');
  if (typeof rawId !== 'string' || typeof rawVersion !== 'string') return null;
  const logId = rawId.trim();
  const stateVersion = Number(rawVersion);
  if (
    logId.length === 0 ||
    logId.length > 191 ||
    !Number.isSafeInteger(stateVersion) ||
    stateVersion < 0
  ) {
    return null;
  }
  return { logId, stateVersion };
}

function notificationResolutionReason(formData: FormData): string | null {
  const rawReason = formData.get('reason');
  if (typeof rawReason !== 'string') return null;
  const reason = rawReason.trim();
  return reason.length > 0 && reason.length <= 500 ? reason : null;
}

function mapUnknownResolutionError(
  error: unknown,
): NotificationResolutionResult | null {
  if (!(error instanceof UnknownNotificationResolutionError)) return null;
  switch (error.code) {
    case 'NOT_FOUND':
      return { status: 'error', message: '该推送日志已不存在' };
    case 'NOT_UNKNOWN':
    case 'CONFLICT':
      return {
        status: 'error',
        message: '该推送已被其他管理员处置，请刷新后核对',
      };
    case 'NOT_DURABLE':
      return {
        status: 'error',
        message: '该记录没有可重放的原后台任务，只能核对后确认已送达',
      };
    case 'JOB_NOT_FOUND':
    case 'PAYLOAD_MISMATCH':
      return {
        status: 'error',
        message: '原后台任务缺失或与日志不匹配，已拒绝重建消息',
      };
    case 'JOB_NOT_READY':
      return {
        status: 'error',
        message: '原后台任务尚未进入可人工重发的死信状态，请稍后刷新',
      };
    case 'INVALID_REASON':
      return { status: 'error', message: '请填写 1–500 字的忽略理由' };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Test 按钮：触发一次 ad-hoc channel test（不创建临时 rule）
// ─────────────────────────────────────────────────────────────────────

export async function testChannelAction(
  channelId: string,
): Promise<ChannelTestResult> {
  await requirePermission('notification:config');

  let outcome: Awaited<ReturnType<typeof testChannel>>;
  try {
    outcome = await testChannel(channelId);
  } catch (error) {
    const mapped = mapTestChannelError(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath('/owner/notifications');

  return outcome.ok
    ? { status: 'success', mock: outcome.mock }
    : { status: 'error', message: outcome.errorMessage };
}

function mapTestChannelError(error: unknown): ChannelTestResult | null {
  if (!(error instanceof TestChannelError)) return null;
  switch (error.code) {
    case 'CHANNEL_NOT_FOUND':
      return { status: 'error', message: '该群不存在' };
    case 'CHANNEL_INACTIVE':
      return { status: 'error', message: '该群已停用，请先启用再测试' };
    case 'LOG_WRITE_FAILED':
      return {
        status: 'error',
        message: '测试推送结果未能写入日志，请检查数据库后再核对群消息',
      };
  }
}
