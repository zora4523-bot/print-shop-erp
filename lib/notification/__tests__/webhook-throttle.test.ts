import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  WECOM_WEBHOOK_SEND_INTERVAL_MS,
  digestWebhookUrl,
  tryReservePostgresWebhookSendSlot,
  waitForWebhookSendSlot,
  type WebhookThrottleRepository,
} from '../webhook-throttle';

const endpoint =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=';

function sqlCall(mock: ReturnType<typeof vi.fn>, index: number) {
  return mock.mock.calls[index]?.[0] as
    | { sql?: string; values?: unknown[] }
    | undefined;
}

describe('WeCom webhook global throttle', () => {
  it('canonicalizes equivalent key encodings into one irreversible bucket', () => {
    expect(digestWebhookUrl(`${endpoint}a`)).toBe(
      digestWebhookUrl(`${endpoint}%61`),
    );
    expect(digestWebhookUrl(`${endpoint}a+b`)).toBe(
      digestWebhookUrl(`${endpoint}a%20b`),
    );

    const secret = 'super-secret-webhook-key';
    const digest = digestWebhookUrl(`${endpoint}${secret}`);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(secret);
    expect(digestWebhookUrl(`${endpoint}another-key`)).not.toBe(digest);
  });

  it('uses one conditional PostgreSQL upsert as the cross-process permit gate', async () => {
    const url = `${endpoint}shared-secret`;
    const digest = digestWebhookUrl(url);
    const queryRaw = vi.fn().mockResolvedValueOnce([
      { webhookDigest: digest },
    ]);

    await expect(
      tryReservePostgresWebhookSendSlot(digest, {
        $queryRaw: queryRaw,
      }),
    ).resolves.toEqual({ acquired: true });

    const query = sqlCall(queryRaw, 0);
    expect(query?.sql).toContain(
      'INSERT INTO "NotificationWebhookSendSlot"',
    );
    expect(query?.sql).toContain('ON CONFLICT ("webhookDigest") DO UPDATE');
    expect(query?.sql).toContain('GREATEST(');
    expect(query?.sql).toContain(
      '"NotificationWebhookSendSlot"."nextAvailableAt" <= clock_timestamp()',
    );
    expect(query?.values).toEqual([
      digest,
      WECOM_WEBHOOK_SEND_INTERVAL_MS,
      WECOM_WEBHOOK_SEND_INTERVAL_MS,
    ]);
    expect(query?.values).not.toContain(url);
  });

  it('returns a database-clock retry delay when another process owns the slot', async () => {
    const digest = digestWebhookUrl(`${endpoint}shared-secret`);
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ waitMs: 3499.2 }]);

    await expect(
      tryReservePostgresWebhookSendSlot(digest, {
        $queryRaw: queryRaw,
      }),
    ).resolves.toEqual({ acquired: false, retryAfterMs: 3500 });
    expect(sqlCall(queryRaw, 1)?.sql).toContain(
      '"nextAvailableAt" - clock_timestamp()',
    );
  });

  it('serializes concurrent callers for the same URL while keeping URLs independent', async () => {
    const attempts = new Map<string, number>();
    const repository: WebhookThrottleRepository = {
      tryReserve: vi.fn(async (digest) => {
        const attempt = attempts.get(digest) ?? 0;
        attempts.set(digest, attempt + 1);
        return attempt === 1
          ? {
              acquired: false as const,
              retryAfterMs: WECOM_WEBHOOK_SEND_INTERVAL_MS,
            }
          : { acquired: true as const };
      }),
    };
    const delay = vi.fn(async () => undefined);
    const sharedUrl = `${endpoint}shared`;

    await Promise.all([
      waitForWebhookSendSlot(sharedUrl, { repository, delay }),
      waitForWebhookSendSlot(sharedUrl, { repository, delay }),
    ]);

    const sharedDigest = digestWebhookUrl(sharedUrl);
    expect(repository.tryReserve).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(repository.tryReserve).mock.calls.map(([digest]) => digest),
    ).toEqual([sharedDigest, sharedDigest, sharedDigest]);
    expect(delay).toHaveBeenCalledExactlyOnceWith(
      WECOM_WEBHOOK_SEND_INTERVAL_MS,
      undefined,
    );

    attempts.clear();
    vi.mocked(repository.tryReserve).mockClear();
    delay.mockClear();
    await Promise.all([
      waitForWebhookSendSlot(`${endpoint}one`, { repository, delay }),
      waitForWebhookSendSlot(`${endpoint}two`, { repository, delay }),
    ]);
    expect(repository.tryReserve).toHaveBeenCalledTimes(2);
    expect(delay).not.toHaveBeenCalled();
    expect(
      new Set(
        vi.mocked(repository.tryReserve).mock.calls.map(([digest]) => digest),
      ).size,
    ).toBe(2);
  });

  it('aborts a durable wait with the exact lease signal reason', async () => {
    const controller = new AbortController();
    const reason = new Error('lease lost');
    const repository: WebhookThrottleRepository = {
      tryReserve: vi.fn(async () => ({
        acquired: false,
        retryAfterMs: 60_000,
      })),
    };
    const pending = waitForWebhookSendSlot(`${endpoint}shared`, {
      repository,
      signal: controller.signal,
    });
    const rejection = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => {
      expect(repository.tryReserve).toHaveBeenCalledOnce();
    });

    controller.abort(reason);

    await rejection;
  });

  it('ships a digest-only independent Prisma model and migration', () => {
    const schema = readFileSync(
      new URL('../../../prisma/schema.prisma', import.meta.url),
      'utf8',
    );
    const migration = readFileSync(
      new URL(
        '../../../prisma/migrations/20260902121100_notification_webhook_global_throttle/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(schema).toContain('model NotificationWebhookSendSlot');
    expect(schema).toMatch(
      /webhookDigest\s+String\s+@id\s+@db\.Char\(64\)/,
    );
    expect(migration).toContain('CHECK ("webhookDigest" ~');
    expect(migration).toContain('TIMESTAMPTZ(3) NOT NULL');
    expect(migration).not.toMatch(/webhookUrl|["']key["']/);
  });
});
