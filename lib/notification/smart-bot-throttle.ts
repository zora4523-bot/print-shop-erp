import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import type { NotificationSmartBotChatType } from '../../generated/prisma/enums';

// One conversation may receive at most 30 messages/minute and 1000/hour,
// counting both replies and proactive messages. 3.7s caps this application at
// about 16/minute and 973/hour, leaving room for rolling-window jitter.
export const WECOM_SMART_BOT_SEND_INTERVAL_MS = 3_700;

export type SmartBotThrottleReservation =
  | { acquired: true }
  | { acquired: false; retryAfterMs: number };

export type SmartBotThrottleRepository = {
  tryReserve(targetDigest: string): Promise<SmartBotThrottleReservation>;
};

export type SmartBotThrottleClient = Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

type Delay = (ms: number, signal?: AbortSignal) => Promise<void>;

export function digestSmartBotTarget(
  botId: string,
  chatType: NotificationSmartBotChatType,
  targetId: string,
): string {
  const normalizedBotId = botId.trim();
  const normalizedTargetId = targetId.trim();
  if (
    normalizedBotId.length === 0 ||
    normalizedBotId.length > 256 ||
    normalizedTargetId.length === 0 ||
    normalizedTargetId.length > 512 ||
    (chatType !== 'GROUP' && chatType !== 'SINGLE')
  ) {
    throw new TypeError('invalid wecom smart bot target');
  }
  return createHash('sha256')
    .update('wecom-smart-bot\0', 'utf8')
    .update(normalizedBotId, 'utf8')
    .update('\0', 'utf8')
    .update(chatType, 'utf8')
    .update('\0', 'utf8')
    .update(normalizedTargetId, 'utf8')
    .digest('hex');
}

export async function tryReservePostgresSmartBotSendSlot(
  targetDigest: string,
  client?: SmartBotThrottleClient,
): Promise<SmartBotThrottleReservation> {
  if (!/^[a-f0-9]{64}$/.test(targetDigest)) {
    throw new TypeError('invalid smart bot target digest');
  }
  const database = client ?? (await import('../db')).db;
  const acquired = await database.$queryRaw<Array<{ targetDigest: string }>>(
    Prisma.sql`
      INSERT INTO "NotificationSmartBotSendSlot" (
        "targetDigest",
        "nextAvailableAt",
        "updatedAt"
      )
      VALUES (
        ${targetDigest},
        clock_timestamp() + (${WECOM_SMART_BOT_SEND_INTERVAL_MS}::int * interval '1 millisecond'),
        clock_timestamp()
      )
      ON CONFLICT ("targetDigest") DO UPDATE
        SET "nextAvailableAt" =
              GREATEST(
                "NotificationSmartBotSendSlot"."nextAvailableAt",
                clock_timestamp()
              ) + (${WECOM_SMART_BOT_SEND_INTERVAL_MS}::int * interval '1 millisecond'),
            "updatedAt" = clock_timestamp()
        WHERE "NotificationSmartBotSendSlot"."nextAvailableAt" <= clock_timestamp()
      RETURNING "targetDigest"
    `,
  );
  if (acquired.length === 1) return { acquired: true };
  if (acquired.length !== 0) {
    throw new Error('smart bot throttle returned multiple reservations');
  }

  const waiting = await database.$queryRaw<Array<{ waitMs: number }>>(Prisma.sql`
    SELECT GREATEST(
             0,
             EXTRACT(EPOCH FROM ("nextAvailableAt" - clock_timestamp())) * 1000
           )::double precision AS "waitMs"
      FROM "NotificationSmartBotSendSlot"
     WHERE "targetDigest" = ${targetDigest}
  `);
  const waitMs = Number(waiting[0]?.waitMs);
  if (waiting.length !== 1 || !Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error('smart bot throttle state unavailable');
  }
  return { acquired: false, retryAfterMs: Math.max(1, Math.ceil(waitMs)) };
}

const postgresRepository: SmartBotThrottleRepository = {
  tryReserve: (targetDigest) =>
    tryReservePostgresSmartBotSendSlot(targetDigest),
};

export async function waitForSmartBotSendSlot(
  botId: string,
  chatType: NotificationSmartBotChatType,
  targetId: string,
  options: {
    signal?: AbortSignal;
    repository?: SmartBotThrottleRepository;
    delay?: Delay;
  } = {},
): Promise<void> {
  const targetDigest = digestSmartBotTarget(botId, chatType, targetId);
  const repository = options.repository ?? postgresRepository;
  const delay = options.delay ?? abortableDelay;

  for (;;) {
    options.signal?.throwIfAborted();
    const reservation = await repository.tryReserve(targetDigest);
    options.signal?.throwIfAborted();
    if (reservation.acquired) return;
    await delay(reservation.retryAfterMs, options.signal);
  }
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        signal?.throwIfAborted();
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
