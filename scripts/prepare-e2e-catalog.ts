import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { activateE2eDatabase, type E2eDatabase } from './lib/e2e-environment';
import type { retireUnusedPaperImports } from './maintenance/retire-unused-paper-imports';

type RepairReceipt = Awaited<ReturnType<typeof retireUnusedPaperImports>>;
type Dependencies = {
  repair(databaseName: string): Promise<RepairReceipt>;
  close(): Promise<void>;
};

async function loadDependencies(database: E2eDatabase): Promise<Dependencies> {
  const [{ Client }, { retireUnusedPaperImports }] = await Promise.all([
    import('pg'), import('./maintenance/retire-unused-paper-imports'),
  ]);
  const client = new Client({ connectionString: database.url, options: '-c search_path=public' });
  await client.connect();
  return {
    repair: (confirmDatabase) => retireUnusedPaperImports(client, { apply: true, confirmDatabase }),
    close: () => client.end(),
  };
}

/** Reproduce the audited catalog repair after fresh migrations, only in the confirmed disposable database. */
export async function prepareE2eCatalog(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: (database: E2eDatabase) => Promise<Dependencies> = loadDependencies,
): Promise<RepairReceipt> {
  const database = activateE2eDatabase(env);
  const deps = await dependencies(database);
  try {
    // The repair owns its transaction and retains all stock, FK, snapshot and
    // identity checks. A used or altered import must fail preparation.
    return await deps.repair(database.databaseName);
  } finally {
    await deps.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadEnvConfig(process.cwd(), true);
  prepareE2eCatalog().then((receipt) => {
    console.log(JSON.stringify({ ...receipt, fixture: 'E2E ONLY — audited catalog preparation' }, null, 2));
  }).catch(() => {
    console.error('E2E catalog preparation failed; verify isolation and inspect the imported paper stock, references and repair audit.');
    process.exitCode = 1;
  });
}
