import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import {
  NotificationStatus,
  type NotificationStatus as NotificationStatusType,
} from '../../generated/prisma/enums';
import { db } from '../db';

type NonRetryingNotificationStatus = Exclude<
  NotificationStatusType,
  typeof NotificationStatus.RETRYING
>;

type FinalNotificationStatus = Exclude<
  NotificationStatusType,
  typeof NotificationStatus.SENDING
>;

export type DurableDeliveryFinalState = Readonly<{
  status: FinalNotificationStatus;
  errorMessage: string | null;
}>;

export type DurableDeliveryClaim =
  | { claimed: true; attemptId: string }
  | {
      claimed: false;
      status: NonRetryingNotificationStatus;
      errorMessage: string | null;
    };

type ClaimInput = {
  deliveryKey: string;
  jobAttempt: number;
  eventType: string;
  channelId: string;
  destinationFingerprint?: string;
  messageContent: string;
  relatedOrderId: string | null;
  // Optional read-version CAS used by manual replay. The caller reads the
  // exact current RETRYING row, then the shared upsert proves it did not pass
  // through another UNKNOWN -> RETRYING cycle before the webhook starts.
  expectedStateVersion?: number;
};

/**
 * Before a new job generation makes any business-rule early return, expose
 * reservations left by an older generation. Returning channel IDs lets the
 * caller count them exactly once even if it later inspects the same rows.
 */
export async function reconcileAbandonedDurableDeliveries(input: {
  deliveryKey: string;
  jobAttempt: number;
}): Promise<string[]> {
  if (!Number.isSafeInteger(input.jobAttempt) || input.jobAttempt < 1) {
    throw new NotificationDeliveryLedgerError('invalid background job attempt');
  }
  const rows = await db.$queryRaw<Array<{ channelId: string }>>(Prisma.sql`
    UPDATE "NotificationLog"
       SET "status" = 'UNKNOWN'::"NotificationStatus",
           "errorMessage" = 'worker lease ended before delivery was finalized',
           "deliveryAttemptId" = NULL,
           "deliveryJobAttempt" = NULL,
           "deliveryStateVersion" = "deliveryStateVersion" + 1,
           "lastAttemptAt" = clock_timestamp(),
           "updatedAt" = clock_timestamp()
     WHERE "deliveryKey" = ${input.deliveryKey}
       AND "status" = 'SENDING'::"NotificationStatus"
       AND (
         "deliveryJobAttempt" IS NULL
         OR "deliveryJobAttempt" < ${input.jobAttempt}
       )
    RETURNING "channelId"
  `);
  return rows.map((row) => row.channelId);
}

/**
 * Atomically reserves a channel before any external I/O. Only a definitive
 * retryable failure may transition back into SENDING; SUCCESS, FAILED,
 * UNKNOWN and an in-flight SENDING state are monotonic and cannot be stolen.
 */
export async function claimDurableDelivery(
  input: ClaimInput,
): Promise<DurableDeliveryClaim> {
  if (!Number.isSafeInteger(input.jobAttempt) || input.jobAttempt < 1) {
    throw new NotificationDeliveryLedgerError('invalid background job attempt');
  }
  if (
    input.expectedStateVersion !== undefined &&
    (!Number.isSafeInteger(input.expectedStateVersion) ||
      input.expectedStateVersion < 0)
  ) {
    throw new NotificationDeliveryLedgerError('invalid delivery state version');
  }
  const destinationFingerprint =
    input.destinationFingerprint ??
    createHash('sha256')
      .update('legacy-notification-channel\0', 'utf8')
      .update(input.channelId, 'utf8')
      .digest('hex');
  if (!/^[a-f0-9]{64}$/.test(destinationFingerprint)) {
    throw new NotificationDeliveryLedgerError('invalid destination fingerprint');
  }

  // A later BackgroundJob generation is proof that the prior lease expired.
  // Fence its abandoned SENDING token before doing anything else. Keeping the
  // generation in its own column is important: comparing random attempt tokens
  // would let two concurrent calls from the *same* job generation steal each
  // other and misclassify an in-flight request as UNKNOWN.
  await db.$executeRaw(Prisma.sql`
    UPDATE "NotificationLog"
       SET "status" = 'UNKNOWN'::"NotificationStatus",
           "errorMessage" = 'worker lease ended before delivery was finalized',
           "deliveryAttemptId" = NULL,
           "deliveryJobAttempt" = NULL,
           "deliveryStateVersion" = "deliveryStateVersion" + 1,
           "lastAttemptAt" = clock_timestamp(),
           "updatedAt" = clock_timestamp()
     WHERE "deliveryKey" = ${input.deliveryKey}
       AND "channelId" = ${input.channelId}
       AND "status" = 'SENDING'::"NotificationStatus"
       AND (
         "deliveryJobAttempt" IS NULL
         OR "deliveryJobAttempt" < ${input.jobAttempt}
       )
  `);

  // A finalizer can move SENDING -> RETRYING between the conflict check and
  // the follow-up read. Retry that narrow race a bounded number of times; an
  // unbounded recursive retry could otherwise exhaust the stack under steady
  // contention and hide a broken state transition. A manual CAS must never
  // retry with a newer version: that would turn a stale owner decision into
  // fresh authorization, so it gets exactly one pass.
  const maxPasses = input.expectedStateVersion === undefined ? 3 : 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const attemptId = randomUUID();
    const id = randomUUID();
    const stateVersionPredicate =
      input.expectedStateVersion === undefined
        ? Prisma.empty
        : Prisma.sql`
          AND "NotificationLog"."deliveryStateVersion" = ${input.expectedStateVersion}
        `;
    const claimed = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    -- Manual replay must update the row the owner inspected, never recreate a
    -- deleted ledger row. Locking the guard row in this statement closes the
    -- EXISTS -> concurrent DELETE -> INSERT window.
    WITH "manual_claim_guard" AS MATERIALIZED (
      SELECT 1
        FROM "NotificationLog"
       WHERE ${input.expectedStateVersion !== undefined}::boolean
         AND "deliveryKey" = ${input.deliveryKey}
         AND "channelId" = ${input.channelId}
       FOR UPDATE
    )
    INSERT INTO "NotificationLog" (
      "id",
      "eventType",
      "channelId",
      "deliveryKey",
      "destinationFingerprint",
      "messageContent",
      "status",
      "errorMessage",
      "retryCount",
      "relatedOrderId",
      "sentAt",
      "deliveryAttemptId",
      "deliveryJobAttempt",
      "lastAttemptAt",
      "createdAt",
      "updatedAt"
    )
    SELECT
      ${id},
      ${input.eventType},
      ${input.channelId},
      ${input.deliveryKey},
      ${destinationFingerprint},
      ${input.messageContent},
      'SENDING'::"NotificationStatus",
      NULL,
      0,
      ${input.relatedOrderId},
      NULL,
      ${attemptId},
      ${input.jobAttempt},
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp()
    WHERE ${input.expectedStateVersion === undefined}::boolean
       OR EXISTS (SELECT 1 FROM "manual_claim_guard")
    ON CONFLICT ("deliveryKey", "channelId") DO UPDATE
      SET "eventType" = EXCLUDED."eventType",
          "destinationFingerprint" = EXCLUDED."destinationFingerprint",
          "messageContent" = EXCLUDED."messageContent",
          "relatedOrderId" = EXCLUDED."relatedOrderId",
          "status" = 'SENDING'::"NotificationStatus",
          "errorMessage" = NULL,
          "deliveryAttemptId" = EXCLUDED."deliveryAttemptId",
          "deliveryJobAttempt" = EXCLUDED."deliveryJobAttempt",
          "deliveryStateVersion" = "NotificationLog"."deliveryStateVersion" + 1,
          "lastAttemptAt" = clock_timestamp(),
          "updatedAt" = clock_timestamp()
      WHERE "NotificationLog"."status" = 'RETRYING'::"NotificationStatus"
        AND (
          "NotificationLog"."deliveryJobAttempt" IS NULL
          OR "NotificationLog"."deliveryJobAttempt" < ${input.jobAttempt}
        )
        ${stateVersionPredicate}
    RETURNING "id"
    `);
    if (claimed.length === 1) return { claimed: true, attemptId };

    const current = await db.notificationLog.findUnique({
      where: {
        deliveryKey_channelId: {
          deliveryKey: input.deliveryKey,
          channelId: input.channelId,
        },
      },
      select: { status: true, errorMessage: true },
    });
    if (!current) {
      if (input.expectedStateVersion !== undefined) {
        throw new NotificationDeliveryClaimConflictError(
          'manual replay delivery row disappeared',
        );
      }
      throw new NotificationDeliveryLedgerError('claimed delivery row disappeared');
    }
    if (current.status === NotificationStatus.RETRYING) {
      if (input.expectedStateVersion !== undefined) {
        throw new NotificationDeliveryClaimConflictError(
          'manual replay delivery state version or job generation changed',
        );
      }
      continue;
    }

    return {
      claimed: false,
      status: current.status,
      errorMessage: current.errorMessage,
    };
  }
  throw new NotificationDeliveryLedgerError(
    'delivery reservation remained contended',
  );
}

type FinalizeInput = {
  deliveryKey: string;
  channelId: string;
  attemptId: string;
  jobAttempt: number;
  status: FinalNotificationStatus;
  errorMessage: string | null;
  retryCount: number;
  sent: boolean;
};

/** A fencing-token update prevents a stale worker from changing newer state. */
export async function finalizeDurableDelivery(
  input: FinalizeInput,
): Promise<void> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE "NotificationLog"
       SET "status" = ${input.status}::"NotificationStatus",
           "errorMessage" = ${input.errorMessage},
           "retryCount" = ${input.retryCount},
           "sentAt" = CASE
             WHEN ${input.sent}::boolean THEN clock_timestamp()
             ELSE NULL
           END,
           "deliveryAttemptId" = NULL,
           "deliveryJobAttempt" = CASE
             WHEN ${input.status}::"NotificationStatus" = 'RETRYING'::"NotificationStatus"
             THEN ${input.jobAttempt}
             ELSE NULL
           END,
           "deliveryStateVersion" = "deliveryStateVersion" + 1,
           "lastAttemptAt" = clock_timestamp(),
           "updatedAt" = clock_timestamp()
     WHERE "deliveryKey" = ${input.deliveryKey}
       AND "channelId" = ${input.channelId}
       AND "status" = 'SENDING'::"NotificationStatus"
       AND "deliveryAttemptId" = ${input.attemptId}
       AND "deliveryJobAttempt" = ${input.jobAttempt}
  `);
  if (updated !== 1) {
    throw new NotificationDeliveryLedgerError('delivery fencing token was lost');
  }
}

/**
 * Retry an uncertain finalization without overwriting a terminal commit.
 *
 * The first UPDATE may have committed even when its database response was
 * lost. This single statement writes the same intended state only while the
 * caller still owns SENDING; otherwise it returns the already-authoritative
 * terminal state.
 */
export async function recoverDurableDeliveryFinalization(
  input: FinalizeInput,
): Promise<DurableDeliveryFinalState> {
  const rows = await db.$queryRaw<
    Array<{
      status: NotificationStatusType;
      errorMessage: string | null;
    }>
  >(Prisma.sql`
    WITH "recovered_finalization" AS (
      UPDATE "NotificationLog"
         SET "status" = ${input.status}::"NotificationStatus",
             "errorMessage" = ${input.errorMessage},
             "retryCount" = ${input.retryCount},
             "sentAt" = CASE
               WHEN ${input.sent}::boolean THEN clock_timestamp()
               ELSE NULL
             END,
             "deliveryAttemptId" = NULL,
             "deliveryJobAttempt" = CASE
               WHEN ${input.status}::"NotificationStatus" = 'RETRYING'::"NotificationStatus"
               THEN ${input.jobAttempt}
               ELSE NULL
             END,
             "deliveryStateVersion" = "deliveryStateVersion" + 1,
             "lastAttemptAt" = clock_timestamp(),
             "updatedAt" = clock_timestamp()
       WHERE "deliveryKey" = ${input.deliveryKey}
         AND "channelId" = ${input.channelId}
         AND "status" = 'SENDING'::"NotificationStatus"
         AND "deliveryAttemptId" = ${input.attemptId}
         AND "deliveryJobAttempt" = ${input.jobAttempt}
      RETURNING "status", "errorMessage"
    )
    SELECT "status", "errorMessage"
      FROM "recovered_finalization"
    UNION ALL
    SELECT current."status", current."errorMessage"
      FROM "NotificationLog" AS current
     WHERE current."deliveryKey" = ${input.deliveryKey}
       AND current."channelId" = ${input.channelId}
       AND NOT EXISTS (SELECT 1 FROM "recovered_finalization")
    LIMIT 1
  `);
  const current = rows[0];
  if (!current || current.status === NotificationStatus.SENDING) {
    throw new NotificationDeliveryLedgerError(
      'delivery finalization state could not be recovered',
    );
  }
  return {
    status: current.status as FinalNotificationStatus,
    errorMessage: current.errorMessage,
  };
}

/** Preserve the explicit UNKNOWN helper for callers that already classified ambiguity. */
export async function markDurableDeliveryUnknown(input: {
  deliveryKey: string;
  channelId: string;
  attemptId: string;
  jobAttempt: number;
  errorMessage: string;
}): Promise<DurableDeliveryFinalState> {
  return recoverDurableDeliveryFinalization({
    ...input,
    status: NotificationStatus.UNKNOWN,
    retryCount: 0,
    sent: false,
  });
}

export class NotificationDeliveryLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationDeliveryLedgerError';
  }
}

/** A stale owner replay decision; retrying the same payload cannot fix it. */
export class NotificationDeliveryClaimConflictError extends NotificationDeliveryLedgerError {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationDeliveryClaimConflictError';
  }
}
