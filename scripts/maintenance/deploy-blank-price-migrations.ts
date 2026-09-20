import 'dotenv/config';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { PRICE_RULE_SNAPSHOT_LOCK_KEY } from '../../lib/price/rule-snapshot-lock';
import { postgresDatabaseIdentity } from '../lib/e2e-environment';
import { readBlankPricePolicyPreflight } from './preflight-blank-price-policy';

/** Apply only this audited migration pair; unrelated pending migrations require their own review. */
const MIGRATIONS = ['20260920180000_blank_price_rules', '20260920181000_blank_bom_targets'];

function runPrisma(connectionString: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: connectionString },
      // Engine errors may echo the connection URI. Keep CLI failure output bounded and secret-free.
      stdio: 'ignore',
    });
    child.on('error', () => reject(new Error('Prisma migration could not start')));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Prisma migration failed; inspect migration status before retrying')));
  });
}

export async function deployBlankPriceMigrations(options: {
  databaseUrl: string;
  confirmDatabase: string;
  writersStopped: boolean;
}, migrate: (connectionString: string) => Promise<void> = runPrisma) {
  const identity = postgresDatabaseIdentity(options.databaseUrl);
  if (!identity || identity.databaseName !== options.confirmDatabase || !options.writersStopped) {
    throw new Error('An explicit target, matching database confirmation and stopped writers are required');
  }
  const url = new URL(options.databaseUrl);
  url.searchParams.set('options', `${url.searchParams.get('options') ?? ''} -c lock_timeout=5000 -c statement_timeout=120000`.trim());
  const client = new Client({ connectionString: url.href });
  await client.connect();
  try {
    // Session lock deliberately spans the preflight and the separate Prisma process.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [PRICE_RULE_SNAPSHOT_LOCK_KEY]);
    const database = await client.query<{ name: string }>('SELECT current_database() AS name');
    if (database.rows[0]?.name !== options.confirmDatabase) throw new Error('Connected database differs from confirmation');
    const journal = await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    if (journal.rows.some((row) => !row.finished_at && !row.rolled_back_at)) throw new Error('Unresolved migration already exists');
    const { readdir } = await import('node:fs/promises');
    const applied = new Set(journal.rows.filter((row) => row.finished_at).map((row) => row.migration_name));
    const pending = (await readdir('prisma/migrations', { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !applied.has(entry.name)).map((entry) => entry.name);
    if (pending.some((name) => !MIGRATIONS.includes(name))) throw new Error('Unreviewed pending migrations exist');
    const report = await readBlankPricePolicyPreflight(client);
    if (!report.readyForAutomaticCutover) return { applied: false, pending, report };
    if (pending.length === 0) return { applied: true, pending, report };
    // Reject existing table-lock blockers before Prisma creates a migration journal entry.
    // Writers must remain stopped; non-cooperating connections still require operational isolation.
    await client.query('BEGIN');
    try {
      await client.query('LOCK TABLE "CustomerPriceRule", "BillOfMaterial", "Material", "ProductCategoryNode", "Setting" IN ACCESS EXCLUSIVE MODE NOWAIT');
    } finally {
      await client.query('ROLLBACK');
    }
    await migrate(url.href);
    return { applied: true, pending, report };
  } finally {
    // Closing the session releases the advisory lock on every success/failure path.
    await client.end();
  }
}

/** Routine deployments must not bypass the separately reviewed cutover. Read-only. */
export async function assertBlankPriceMigrationsApplied(databaseUrl: string) {
  if (!postgresDatabaseIdentity(databaseUrl)) throw new Error('A database target is required');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND migration_name = ANY($1::text[])', [MIGRATIONS],
    );
    if (new Set(result.rows.map((row) => row.migration_name)).size !== MIGRATIONS.length) {
      throw new Error('Complete the guarded blank-price cutover before routine deployment');
    }
  } finally { await client.end(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check-applied') {
    await assertBlankPriceMigrationsApplied(process.env.DATABASE_URL ?? '');
    return;
  }
  if (args.length !== 3 || args[0] !== '--confirm-database' || args[2] !== '--writers-stopped') {
    throw new Error('Expected --confirm-database <name> --writers-stopped');
  }
  const result = await deployBlankPriceMigrations({
    databaseUrl: process.env.BLANK_CUTOVER_DATABASE_URL ?? '', confirmDatabase: args[1]!, writersStopped: true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.applied) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('空白封切换失败。请按部署指南完成显式目标切换，并检查停写、预检及迁移状态；不要直接重试或标记迁移成功。');
    process.exitCode = 1;
  });
}
