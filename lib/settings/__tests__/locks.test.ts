import { describe, expect, it, vi } from 'vitest';
import {
  acquireWorkerSelfClaimSettingReadLock,
  acquireWorkerSelfClaimSettingWriteLock,
  WORKER_SELF_CLAIM_SETTING_LOCK_KEY,
} from '../locks';

function sqlClient() {
  return { $executeRaw: vi.fn().mockResolvedValue(0) };
}

function renderedSql(client: ReturnType<typeof sqlClient>): string {
  const call = client.$executeRaw.mock.calls[0];
  return (call[0] as TemplateStringsArray).join('?');
}

describe('worker self-claim Setting advisory lock', () => {
  it('释放/抢单读者使用 transaction shared lock', async () => {
    const client = sqlClient();
    await acquireWorkerSelfClaimSettingReadLock(client as never);
    expect(renderedSql(client)).toContain('pg_advisory_xact_lock_shared');
    expect(client.$executeRaw.mock.calls[0]).toContain(
      WORKER_SELF_CLAIM_SETTING_LOCK_KEY,
    );
  });

  it('设置写者使用同 key 的 transaction exclusive lock', async () => {
    const client = sqlClient();
    await acquireWorkerSelfClaimSettingWriteLock(client as never);
    expect(renderedSql(client)).toContain('pg_advisory_xact_lock(hashtext');
    expect(renderedSql(client)).not.toContain('lock_shared');
    expect(client.$executeRaw.mock.calls[0]).toContain(
      WORKER_SELF_CLAIM_SETTING_LOCK_KEY,
    );
  });
});
