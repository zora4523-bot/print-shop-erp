import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { isValidWecomGroupBotWebhookUrl } from './webhook-url';

/**
 * The official bot limit is 20 messages/minute. A 3.5 second permit interval
 * caps this application at roughly 17/minute and leaves headroom for timing
 * jitter around the provider's rolling window.
 */
export const WECOM_WEBHOOK_SEND_INTERVAL_MS = 3_500;

export type WebhookThrottleReservation =
  | { acquired: true }
  | { acquired: false; retryAfterMs: number };

export type WebhookThrottleRepository = {
  tryReserve(webhookDigest: string): Promise<WebhookThrottleReservation>;
};

export type WebhookThrottleClient = Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

type Delay = (ms: number, signal?: AbortSignal) => Promise<void>;

export function digestWebhookUrl(webhookUrl: string): string {
  if (!isValidWecomGroupBotWebhookUrl(webhookUrl)) {
    throw new TypeError('invalid wecom webhook url');
  }
  const key = new URL(webhookUrl).searchParams.get('key');
  if (key === null) throw new TypeError('invalid wecom webhook url');
  // URLSearchParams canonicalizes equivalent query encodings (`a` / `%61`,
  // `+` / `%20`). Include the fixed endpoint identity so this digest cannot be
  // confused with a hash from another future transport.
  return createHash('sha256')
    .update('wecom-group-bot:https://qyapi.weixin.qq.com/cgi-bin/webhook/send\0')
    .update(key, 'utf8')
    .digest('hex');
}

/**
 * Atomically acquires the permit that is due now. Contenders for the same
 * digest serialize on one PostgreSQL row; different webhook digests never
 * block each other. We deliberately do not pre-allocate a long sequence of
 * future slots: a process that pauses after waking must compete again at the
 * database boundary instead of releasing a stale, burstable permit.
 */
export async function tryReservePostgresWebhookSendSlot(
  webhookDigest: string,
  client?: WebhookThrottleClient,
): Promise<WebhookThrottleReservation> {
  if (!/^[a-f0-9]{64}$/.test(webhookDigest)) {
    throw new TypeError('invalid webhook digest');
  }

  // Keep module import side-effect free for adapter tests and mock mode. The
  // Prisma client is initialized only when the real sender requests a permit.
  const database = client ?? (await import('../db')).db;
  const acquired = await database.$queryRaw<Array<{ webhookDigest: string }>>(
    Prisma.sql`
      INSERT INTO "NotificationWebhookSendSlot" (
        "webhookDigest",
        "nextAvailableAt",
        "updatedAt"
      )
      VALUES (
        ${webhookDigest},
        clock_timestamp() + (${WECOM_WEBHOOK_SEND_INTERVAL_MS}::int * interval '1 millisecond'),
        clock_timestamp()
      )
      ON CONFLICT ("webhookDigest") DO UPDATE
        SET "nextAvailableAt" =
              GREATEST(
                "NotificationWebhookSendSlot"."nextAvailableAt",
                clock_timestamp()
              ) + (${WECOM_WEBHOOK_SEND_INTERVAL_MS}::int * interval '1 millisecond'),
            "updatedAt" = clock_timestamp()
        WHERE "NotificationWebhookSendSlot"."nextAvailableAt" <= clock_timestamp()
      RETURNING "webhookDigest"
    `,
  );
  if (acquired.length === 1) return { acquired: true };
  if (acquired.length !== 0) {
    throw new Error('webhook throttle returned multiple reservations');
  }

  const waiting = await database.$queryRaw<Array<{ waitMs: number }>>(Prisma.sql`
    SELECT GREATEST(
             0,
             EXTRACT(
               EPOCH FROM ("nextAvailableAt" - clock_timestamp())
             ) * 1000
           )::double precision AS "waitMs"
      FROM "NotificationWebhookSendSlot"
     WHERE "webhookDigest" = ${webhookDigest}
  `);
  const waitMs = Number(waiting[0]?.waitMs);
  if (waiting.length !== 1 || !Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error('webhook throttle state unavailable');
  }
  return {
    acquired: false,
    // Avoid a zero-delay contention loop at the timestamp boundary.
    retryAfterMs: Math.max(1, Math.ceil(waitMs)),
  };
}

const postgresRepository: WebhookThrottleRepository = {
  tryReserve: (webhookDigest) =>
    tryReservePostgresWebhookSendSlot(webhookDigest),
};

/**
 * Waits cooperatively until this process owns the next real-send permit.
 * Abort never consumes another permit: if a durable lease is lost while
 * sleeping, the exact AbortSignal reason escapes to the worker fence.
 */
export async function waitForWebhookSendSlot(
  webhookUrl: string,
  options: {
    signal?: AbortSignal;
    repository?: WebhookThrottleRepository;
    delay?: Delay;
  } = {},
): Promise<void> {
  const webhookDigest = digestWebhookUrl(webhookUrl);
  const repository = options.repository ?? postgresRepository;
  const delay = options.delay ?? abortableDelay;

  for (;;) {
    options.signal?.throwIfAborted();
    const reservation = await repository.tryReserve(webhookDigest);
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
