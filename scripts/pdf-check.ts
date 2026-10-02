import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
void import('../lib/pdf/preflight').then(async ({ checkPdfRuntime }) => {
  console.info('[pdf-check] passed', await checkPdfRuntime({ strictProbeCleanup: true }));
}).catch((error: unknown) => {
  console.error('[pdf-check] failed:', error instanceof Error ? error.name : 'UnknownError');
  process.exitCode = 1;
});
