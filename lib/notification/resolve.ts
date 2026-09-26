import { Prisma } from '../../generated/prisma/client';
import {
  BackgroundJobStatus,
  NotificationStatus,
  type NotificationStatus as NotificationStatusType,
} from '../../generated/prisma/enums';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { databaseNow } from '../background-jobs/clock';
import {
  NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
  NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE,
  backgroundJobRequiresOwnerResolution,
} from '../background-jobs/terminal-policy';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import { db } from '../db';
import { isNotificationEvent } from './events';

// ──────────────────────────────────────────────────────────────────────
// UNKNOWN 人工处置
// ─────────────────────────────────────────────────────────────────────

export type UnknownNotificationResolution =
  | 'DELIVERED'
  | 'NOT_DELIVERED_RETRY'
  | 'IGNORED';

export type UnknownNotificationResolutionErrorCode =
  | 'NOT_FOUND'
  | 'NOT_UNKNOWN'
  | 'NOT_DURABLE'
  | 'JOB_NOT_FOUND'
  | 'JOB_NOT_READY'
  | 'PAYLOAD_MISMATCH'
  | 'INVALID_REASON'
  | 'RETIRED_EVENT'
  | 'CONFLICT';

export class UnknownNotificationResolutionError extends Error {
  constructor(public readonly code: UnknownNotificationResolutionErrorCode) {
    super(`cannot resolve unknown notification: ${code}`);
    this.name = 'UnknownNotificationResolutionError';
  }
}

export async function resolveUnknownNotification(
  logId: string,
  resolution: UnknownNotificationResolution,
  actor: AuditActor,
  expectedStateVersion: number,
  reason?: string | null,
): Promise<{
  backgroundJobId: string | null;
  pendingUnknownCount: number;
  rearmed: boolean;
  completed: boolean;
  /** RETRYING siblings closed because their event left the registry. */
  retiredClosedCount: number;
}> {
  const normalizedReason = normalizeResolutionReason(resolution, reason);

  return db.$transaction(async (tx) => {
    const log = await tx.notificationLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        eventType: true,
        status: true,
        errorMessage: true,
        deliveryKey: true,
        deliveryStateVersion: true,
        sentAt: true,
        lastAttemptAt: true,
      },
    });
    if (!log) throw new UnknownNotificationResolutionError('NOT_FOUND');
    if (log.status !== NotificationStatus.UNKNOWN) {
      throw new UnknownNotificationResolutionError('NOT_UNKNOWN');
    }
    if (log.deliveryStateVersion !== expectedStateVersion) {
      throw new UnknownNotificationResolutionError('CONFLICT');
    }
    // The event was removed from the registry; handleNotificationJob would
    // reject the re-armed job and leave the row RETRYING, after which it can no
    // longer be confirmed or ignored. Only the closing decisions stay open.
    if (
      resolution === 'NOT_DELIVERED_RETRY' &&
      !isNotificationEvent(log.eventType)
    ) {
      throw new UnknownNotificationResolutionError('RETIRED_EVENT');
    }

    // Inline/test UNKNOWN rows can be acknowledged as delivered or deliberately
    // ignored, but cannot be replayed: there is no durable payload/dedupe
    // identity to prove which message should be sent.
    if (!log.deliveryKey) {
      if (resolution === 'NOT_DELIVERED_RETRY') {
        throw new UnknownNotificationResolutionError('NOT_DURABLE');
      }
      const at = await databaseNow(tx);
      await updateUnknownLogWithCas(
        tx,
        log,
        resolution,
        at,
        null,
        normalizedReason,
      );
      await writeResolutionAudit(tx, {
        actor,
        log,
        resolution,
        reason: normalizedReason,
        resolvedAt: at,
        pendingUnknownCount: 0,
        jobBefore: null,
        jobAfter: null,
      });
      return {
        backgroundJobId: null,
        pendingUnknownCount: 0,
        rearmed: false,
        completed: true,
        retiredClosedCount: 0,
      };
    }

    // Serialize every resolver for the same logical delivery on the owning job
    // row. Two channel decisions can then safely agree which one is the last
    // ambiguity and only that transaction may re-arm/finish the job.
    const job = await lockNotificationJob(tx, log.deliveryKey);
    if (!job || job.type !== BACKGROUND_JOB_TYPES.NOTIFICATION) {
      throw new UnknownNotificationResolutionError('JOB_NOT_FOUND');
    }
    if (notificationEventFromPayload(job.payload) !== log.eventType) {
      throw new UnknownNotificationResolutionError('PAYLOAD_MISMATCH');
    }
    if (
      job.status !== BackgroundJobStatus.DEAD ||
      !backgroundJobRequiresOwnerResolution(job)
    ) {
      throw new UnknownNotificationResolutionError('JOB_NOT_READY');
    }

    const at = await databaseNow(tx);
    await updateUnknownLogWithCas(
      tx,
      log,
      resolution,
      at,
      job.attempts,
      normalizedReason,
    );

    const pendingUnknownCount = await tx.notificationLog.count({
      where: {
        deliveryKey: log.deliveryKey,
        status: { in: [NotificationStatus.UNKNOWN, NotificationStatus.SENDING] },
      },
    });

    let rearmed = false;
    let completed = false;
    let retiredEventClosedLogs: RetiredEventClosedLog[] = [];
    let jobAfter: {
      id: string;
      status: BackgroundJobStatus;
      attempts: number;
      maxAttempts: number;
    } = {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
    };

    if (pendingUnknownCount === 0) {
      const retrying = await tx.notificationLog.findMany({
        where: {
          deliveryKey: log.deliveryKey,
          status: NotificationStatus.RETRYING,
        },
        orderBy: { id: 'asc' },
        select: { id: true, deliveryStateVersion: true },
      });

      if (retrying.length > 0 && !isNotificationEvent(log.eventType)) {
        // The event left the registry: a re-armed job would only be rejected
        // by handleNotificationJob and leave these rows RETRYING for good
        // (the owner flow only accepts UNKNOWN). Close them with the owner's
        // closing decision instead and keep the DEAD job as history.
        retiredEventClosedLogs = await closeRetiredEventRetryingLogs(
          tx,
          log.deliveryKey,
          retrying,
          resolution,
          normalizedReason,
          at,
        );
        const closed = await tx.backgroundJob.updateMany({
          where: backgroundJobResolutionCas(job),
          data: {
            // Still DEAD, but no longer waiting for an owner decision, so the
            // ops page stops pointing at the notification log.
            lastErrorCode: NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE,
            result: manuallyResolvedResult(job.result),
          },
        });
        if (closed.count !== 1) {
          throw new UnknownNotificationResolutionError('CONFLICT');
        }
      } else if (retrying.length > 0) {
        const nextMaxAttempts = Math.max(job.maxAttempts, job.attempts + 3);
        const rearmedJob = await tx.backgroundJob.updateMany({
          where: backgroundJobResolutionCas(job),
          data: {
            status: BackgroundJobStatus.PENDING,
            maxAttempts: nextMaxAttempts,
            availableAt: at,
            // Preserve the original event + business payload verbatim and add
            // only server-owned routing references. The handler then sends each
            // original log's channelId/messageContent rather than current rules.
            payload: withManualReplayTargets(job.payload, retrying),
            result: Prisma.JsonNull,
            finishedAt: null,
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
            lastErrorCode: null,
          },
        });
        if (rearmedJob.count !== 1) {
          throw new UnknownNotificationResolutionError('CONFLICT');
        }
        rearmed = true;
        jobAfter = {
          id: job.id,
          status: BackgroundJobStatus.PENDING,
          attempts: job.attempts,
          maxAttempts: nextMaxAttempts,
        };
      } else {
        const finished = await tx.backgroundJob.updateMany({
          where: backgroundJobResolutionCas(job),
          data: {
            status: BackgroundJobStatus.SUCCEEDED,
            result: manuallyResolvedResult(job.result),
            finishedAt: at,
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
            lastErrorCode: null,
          },
        });
        if (finished.count !== 1) {
          throw new UnknownNotificationResolutionError('CONFLICT');
        }
        completed = true;
        jobAfter = {
          id: job.id,
          status: BackgroundJobStatus.SUCCEEDED,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
        };
      }
    }

    await writeResolutionAudit(tx, {
      actor,
      log,
      resolution,
      reason: normalizedReason,
      resolvedAt: at,
      pendingUnknownCount,
      jobBefore: {
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
      jobAfter,
      ...(retiredEventClosedLogs.length > 0 ? { retiredEventClosedLogs } : {}),
    });
    return {
      backgroundJobId: job.id,
      pendingUnknownCount,
      rearmed,
      completed,
      retiredClosedCount: retiredEventClosedLogs.length,
    };
  });
}

type UnknownLogForResolution = {
  id: string;
  eventType: string;
  status: NotificationStatusType;
  errorMessage: string | null;
  deliveryKey: string | null;
  deliveryStateVersion: number;
  sentAt: Date | null;
  lastAttemptAt: Date;
};

type ResolutionJob = {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  payload: Prisma.JsonValue;
  result: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
};

async function lockNotificationJob(
  tx: Prisma.TransactionClient,
  deliveryKey: string,
): Promise<ResolutionJob | null> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
      FROM "BackgroundJob"
     WHERE "dedupeKey" = ${deliveryKey}
     FOR UPDATE
  `;
  if (locked.length !== 1) return null;
  return tx.backgroundJob.findUnique({
    where: { id: locked[0]!.id },
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      result: true,
      attempts: true,
      maxAttempts: true,
      lastErrorCode: true,
    },
  });
}

async function updateUnknownLogWithCas(
  tx: Prisma.TransactionClient,
  log: UnknownLogForResolution,
  resolution: UnknownNotificationResolution,
  at: Date,
  previousJobAttempt: number | null,
  reason: string | null,
): Promise<void> {
  const outcome = resolutionLogOutcome(resolution, reason);
  const updated = await tx.notificationLog.updateMany({
    where: {
      id: log.id,
      status: NotificationStatus.UNKNOWN,
      deliveryStateVersion: log.deliveryStateVersion,
    },
    data: {
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      sentAt:
        resolution === 'DELIVERED'
          ? (log.sentAt ?? log.lastAttemptAt)
          : null,
      deliveryAttemptId: null,
      // A manually reopened RETRYING row belongs to the generation that just
      // became DEAD. claimDurableDelivery requires a strictly newer job
      // attempt, so a paused worker from the dead generation cannot send it.
      deliveryJobAttempt:
        resolution === 'NOT_DELIVERED_RETRY' ? previousJobAttempt : null,
      deliveryStateVersion: { increment: 1 },
      updatedAt: at,
    },
  });
  if (updated.count !== 1) {
    throw new UnknownNotificationResolutionError('CONFLICT');
  }
}

type RetiredEventClosedLog = {
  id: string;
  stateVersionBefore: number;
  status: NotificationStatusType;
  errorMessage: string;
};

// Rows the owner already confirmed as not delivered can no longer be resent
// once their event is retired. They end FAILED: an IGNORED decision carries its
// reason over, a DELIVERED decision on the last UNKNOWN row says nothing about
// these siblings, so they are recorded as not delivered and not resent.
async function closeRetiredEventRetryingLogs(
  tx: Prisma.TransactionClient,
  deliveryKey: string,
  retrying: Array<{ id: string; deliveryStateVersion: number }>,
  resolution: UnknownNotificationResolution,
  reason: string | null,
  at: Date,
): Promise<RetiredEventClosedLog[]> {
  const errorMessage =
    resolution === 'IGNORED'
      ? resolutionLogOutcome(resolution, reason).errorMessage
      : '人工核对：未送达；事件已停用，不再重发';
  const closed: RetiredEventClosedLog[] = [];
  for (const row of retrying) {
    const updated = await tx.notificationLog.updateMany({
      where: {
        id: row.id,
        deliveryKey,
        status: NotificationStatus.RETRYING,
        deliveryStateVersion: row.deliveryStateVersion,
      },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage,
        sentAt: null,
        deliveryAttemptId: null,
        deliveryJobAttempt: null,
        deliveryStateVersion: { increment: 1 },
        updatedAt: at,
      },
    });
    if (updated.count !== 1) {
      throw new UnknownNotificationResolutionError('CONFLICT');
    }
    closed.push({
      id: row.id,
      stateVersionBefore: row.deliveryStateVersion,
      status: NotificationStatus.FAILED,
      errorMessage,
    });
  }
  return closed;
}

function backgroundJobResolutionCas(job: ResolutionJob) {
  return {
    id: job.id,
    type: BACKGROUND_JOB_TYPES.NOTIFICATION,
    status: BackgroundJobStatus.DEAD,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastErrorCode: NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
  };
}

function withManualReplayTargets(
  payload: Prisma.JsonValue,
  retrying: Array<{ id: string; deliveryStateVersion: number }>,
): Prisma.InputJsonObject {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UnknownNotificationResolutionError('PAYLOAD_MISMATCH');
  }
  return {
    ...payload,
    manualReplay: {
      targets: retrying.map((row) => ({
        logId: row.id,
        stateVersion: row.deliveryStateVersion,
      })),
    },
  };
}

function manuallyResolvedResult(result: Prisma.JsonValue): Prisma.InputJsonObject {
  const previous =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return { ...previous, unknown: 0, manuallyResolved: true };
}

async function writeResolutionAudit(
  tx: Prisma.TransactionClient,
  input: {
    actor: AuditActor;
    log: UnknownLogForResolution;
    resolution: UnknownNotificationResolution;
    reason: string | null;
    resolvedAt: Date;
    pendingUnknownCount: number;
    jobBefore: unknown;
    jobAfter: unknown;
    retiredEventClosedLogs?: RetiredEventClosedLog[];
  },
): Promise<void> {
  const outcome = resolutionLogOutcome(input.resolution, input.reason);
  await writeAuditLogInTx(tx, {
    actor: input.actor,
    action:
      input.resolution === 'DELIVERED'
        ? 'CONFIRM_NOTIFICATION_DELIVERED'
        : input.resolution === 'NOT_DELIVERED_RETRY'
          ? 'CONFIRM_NOTIFICATION_NOT_DELIVERED_RETRY'
          : 'IGNORE_NOTIFICATION_DELIVERY',
    entityType: 'NotificationLog',
    entityId: input.log.id,
    before: {
      status: input.log.status,
      stateVersion: input.log.deliveryStateVersion,
      errorMessage: input.log.errorMessage,
      sentAt: input.log.sentAt,
      backgroundJob: input.jobBefore,
    },
    after: {
      status: outcome.status,
      stateVersion: input.log.deliveryStateVersion + 1,
      errorMessage: outcome.errorMessage,
      resolvedAt: input.resolvedAt,
      pendingUnknownCount: input.pendingUnknownCount,
      backgroundJob: input.jobAfter,
      ...(input.retiredEventClosedLogs
        ? { retiredEventClosedLogs: input.retiredEventClosedLogs }
        : {}),
    },
    requestMetadata: {
      source: 'owner-notifications.resolveUnknownNotification',
      resolution: input.resolution,
      reason: input.reason,
    },
  });
}

function resolutionLogOutcome(
  resolution: UnknownNotificationResolution,
  reason: string | null,
): { status: NotificationStatusType; errorMessage: string } {
  switch (resolution) {
    case 'DELIVERED':
      return {
        status: NotificationStatus.SUCCESS,
        errorMessage: '人工核对：已送达',
      };
    case 'NOT_DELIVERED_RETRY':
      return {
        status: NotificationStatus.RETRYING,
        errorMessage: '人工核对：未送达，等待同组核对完成后安全重发',
      };
    case 'IGNORED':
      if (!reason) {
        throw new UnknownNotificationResolutionError('INVALID_REASON');
      }
      return {
        status: NotificationStatus.FAILED,
        errorMessage: `人工忽略：${reason}`,
      };
  }
}

function normalizeResolutionReason(
  resolution: UnknownNotificationResolution,
  reason: string | null | undefined,
): string | null {
  if (resolution !== 'IGNORED') return null;
  const normalized = reason?.trim() ?? '';
  if (normalized.length === 0 || normalized.length > 500) {
    throw new UnknownNotificationResolutionError('INVALID_REASON');
  }
  return normalized;
}

function notificationEventFromPayload(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return typeof payload.event === 'string' ? payload.event : null;
}
