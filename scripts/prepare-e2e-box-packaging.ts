import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { AuditActor } from '../lib/audit-log';
import type { BoxPackagingInstallReceipt } from './lib/box-packaging-install';
import { activateE2eDatabase, type E2eDatabase } from './lib/e2e-environment';

type Dependencies = {
  actor(username: string): Promise<AuditActor | null>;
  install(actor: AuditActor): Promise<BoxPackagingInstallReceipt>;
  close(): Promise<void>;
};

async function loadDependencies(database: E2eDatabase): Promise<Dependencies> {
  if (process.env.DATABASE_URL?.trim() !== database.url) {
    throw new Error('The validated E2E URL must be activated in the database process before Prisma loads.');
  }
  const [{ db }, { installConfirmedBoxPackagingRules }] = await Promise.all([
    import('../lib/db'),
    import('./lib/box-packaging-install'),
  ]);
  return {
    async actor(username) {
      const actor = await db.user.findUnique({
        where: { username },
        select: { id: true, role: true, username: true, displayName: true, isActive: true },
      });
      if (!actor?.isActive || actor.role !== 'ADMIN') return null;
      return { ...actor, username: String(actor.username) };
    },
    install: (actor) => installConfirmedBoxPackagingRules(actor, { apply: true }),
    close: () => db.$disconnect(),
  };
}

/**
 * 在已确认的隔离 E2E 库里安装 2026-09-13 用户确认的装盒价目。装盒是部署后的数据步骤
 * （scripts/install-box-packaging-rules.ts），不在迁移链里；不装的话 order-packaging-types
 * 等装盒 spec 在任何全新库（含 CI）都无法提交工单。幂等：已安装即 already-installed。
 *
 * 价目簿管理模块引入了 server-only，必须以 `node --conditions=react-server --import tsx`
 * 运行（package.json 的 test:e2e:prepare 已如此配置），直接 `tsx` 会在导入阶段被拒。
 */
export async function prepareE2eBoxPackaging(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: (database: E2eDatabase) => Promise<Dependencies> = loadDependencies,
): Promise<BoxPackagingInstallReceipt> {
  // Complete the same isolation contract before importing/initializing Prisma.
  const database = activateE2eDatabase(env);
  const username = env.SEED_ADMIN_USERNAME?.trim();
  if (!username) throw new Error('SEED_ADMIN_USERNAME is required to install the E2E box packaging prices.');
  const deps = await dependencies(database);
  try {
    const actor = await deps.actor(username);
    if (!actor) throw new Error('The E2E seed administrator must be active.');
    return await deps.install(actor);
  } finally {
    await deps.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadEnvConfig(process.cwd(), true);
  prepareE2eBoxPackaging()
    .then((receipt) => {
      console.log(JSON.stringify({ ...receipt, fixture: 'E2E ONLY — confirmed box packaging prices' }, null, 2));
    })
    .catch(() => {
      // Database exceptions may contain credentials/connection details.
      console.error('E2E box packaging preparation failed; verify isolation, seed administrator and the current price-book state.');
      process.exitCode = 1;
    });
}
