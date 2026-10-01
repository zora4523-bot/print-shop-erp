'use server';

import { revalidatePath } from 'next/cache';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import {
  AgentMonthlyBillExportActorInvalidError,
  AgentMonthlyBillExportExpiredError,
  AgentMonthlyBillExportNotFoundError,
  AgentMonthlyBillExportNotPendingError,
  InvalidAgentMonthlyBillExportRequestError,
  processAgentMonthlyBillExportInline,
  requestAgentMonthlyBillExport,
  type AgentMonthlyBillExportFilter,
} from '@/lib/agent-monthly-billing/export';

export type AgentMonthlyBillExportActionResult =
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string }
  | { status: 'queued'; exportId: string }
  | { status: 'success'; exportId: string };

export async function requestAgentMonthlyBillExportAction(
  _previous: AgentMonthlyBillExportActionResult | null,
  formData: FormData,
): Promise<AgentMonthlyBillExportActionResult> {
  const actor = await requirePermission('bill:manage');
  const requestKey = stringEntry(formData.get('requestKey'));
  const period = stringEntry(formData.get('period')) || undefined;
  const statusRaw = stringEntry(formData.get('status')) || undefined;
  const agentUserId = stringEntry(formData.get('agentUserId')) || undefined;
  if (!requestKey) {
    return { status: 'invalid', message: '导出请求不完整，请刷新后重试' };
  }
  if (
    statusRaw &&
    !(Object.values(AgentMonthlyBillStatus) as string[]).includes(statusRaw)
  ) {
    return { status: 'invalid', message: '导出状态不合法' };
  }
  const filter: AgentMonthlyBillExportFilter = {
    ...(period ? { period } : {}),
    ...(statusRaw ? { status: statusRaw as AgentMonthlyBillStatus } : {}),
    ...(agentUserId ? { agentUserId } : {}),
  };

  try {
    const durable = backgroundJobsMode() === 'durable';
    const requested = await requestAgentMonthlyBillExport({
      actor,
      requestKey,
      filter,
      durable,
    });
    if (!durable && requested.status === 'PENDING') {
      await processAgentMonthlyBillExportInline(requested.id);
    }
    revalidatePath('/owner/agent-bills');
    if (requested.status === 'FAILED' || requested.status === 'EXPIRED') {
      return {
        status: 'error',
        message: '这次导出请求已失效，请刷新后重新导出',
      };
    }
    if (requested.status === 'READY') {
      return { status: 'success', exportId: requested.id };
    }
    return durable
      ? { status: 'queued', exportId: requested.id }
      : { status: 'success', exportId: requested.id };
  } catch (error) {
    if (error instanceof InvalidAgentMonthlyBillExportRequestError) {
      return { status: 'invalid', message: error.message };
    }
    // 内联处理失败时导出记录已落为 FAILED，先让记录列表失效再决定如何返回。
    revalidatePath('/owner/agent-bills');
    const message = knownFailureMessage(error);
    // 未知错误（数据库、存储等）必须继续抛出，交给错误边界与 Sentry（CLAUDE.md §15.3）。
    if (!message) throw error;
    return { status: 'error', message };
  }
}

/** Expected, user-recoverable failures of request/inline processing. */
function knownFailureMessage(error: unknown): string | null {
  if (error instanceof AgentMonthlyBillExportExpiredError) {
    return '这次导出请求已过期，请重新导出。';
  }
  if (error instanceof AgentMonthlyBillExportNotPendingError) {
    return '这次导出已在处理，请刷新导出记录查看结果。';
  }
  if (error instanceof AgentMonthlyBillExportNotFoundError) {
    return '这次导出请求已失效，请刷新后重新导出。';
  }
  if (error instanceof AgentMonthlyBillExportActorInvalidError) {
    return '当前账号已无权导出月账单，请重新登录后重试。';
  }
  return null;
}

function stringEntry(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}
