/**
 * 自由抢单的开关是一条业务围栏：释放/抢单与关闭必须可线性化。
 * 读者共享同一把 transaction-scoped lock，设置写者拿排他锁。
 */
export const WORKER_SELF_CLAIM_SETTING_LOCK_KEY =
  'print-shop-erp:setting:worker-self-claim-enabled:v1';

export type WorkerSelfClaimSettingLockClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

export async function acquireWorkerSelfClaimSettingReadLock(
  client: WorkerSelfClaimSettingLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${WORKER_SELF_CLAIM_SETTING_LOCK_KEY}))`;
}

export async function acquireWorkerSelfClaimSettingWriteLock(
  client: WorkerSelfClaimSettingLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${WORKER_SELF_CLAIM_SETTING_LOCK_KEY}))`;
}
