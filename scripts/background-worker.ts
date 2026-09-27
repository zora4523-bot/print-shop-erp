import { loadEnvConfig } from '@next/env';

// Worker 不在 Next runtime 内，必须先按 Next 的 .env* 优先级加载配置，
// 再 import 会在模块初始化时读取 DATABASE_URL 的 Prisma/业务模块。
loadEnvConfig(
  process.cwd(),
  process.env.NODE_ENV !== 'production',
);

process.env.DATABASE_PROCESS_ROLE = 'worker';

void import('./background-worker-runtime')
  .then(({ runBackgroundWorkerProcess }) => runBackgroundWorkerProcess())
  .catch((error: unknown) => {
    console.error(
      '[worker] bootstrap failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  });
