import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { AuditActor } from '../lib/audit-log';
import type { PublishPieceworkPriceBookV1Input, PieceworkPublicationReceipt } from '../lib/salary/piecework-price-book-admin';
import { activateE2eDatabase, type E2eDatabase } from './lib/e2e-environment';
import { assertReleasePieceworkPrerequisite, e2ePieceworkManifest } from './lib/e2e-piecework';

type Dependencies = {
  readBook(): Promise<{ status: string; effectiveFrom: Date | null; updatedAt: Date } | null>;
  actor(username: string): Promise<AuditActor | null>;
  publish(input: PublishPieceworkPriceBookV1Input): Promise<PieceworkPublicationReceipt>;
  waitUntilEffective(): Promise<void>;
  close(): Promise<void>;
};

async function loadDependencies(database: E2eDatabase): Promise<Dependencies> {
  if (process.env.DATABASE_URL?.trim() !== database.url) {
    throw new Error('The validated E2E URL must be activated in the database process before Prisma loads.');
  }
  const [{ db }, { publishPieceworkPriceBookV1 }, { Client }] = await Promise.all([
    import('../lib/db'), import('../lib/salary/piecework-price-book-admin'), import('pg'),
  ]);
  return {
    readBook: () => db.pieceworkPriceBook.findUnique({ where: { version: 1 },
      select: { status: true, effectiveFrom: true, updatedAt: true } }),
    async actor(username) {
      const actor = await db.user.findUnique({ where: { username },
        select: { id: true, role: true, username: true, displayName: true, isActive: true } });
      if (!actor?.isActive || actor.role !== 'ADMIN') return null;
      return { ...actor, username: String(actor.username) };
    },
    publish: publishPieceworkPriceBookV1,
    async waitUntilEffective() {
      const client = new Client({ connectionString: database.url });
      await client.connect();
      try {
        const deadline = Date.now() + 15_000;
        // Publication deliberately schedules in the future; observe the actual
        // database effective-time condition rather than backdating protected data.
        for (;;) {
          try { await assertReleasePieceworkPrerequisite(client); return; } catch (error) {
            if (Date.now() >= deadline) throw error;
          }
          await pause(250);
        }
      } finally { await client.end(); }
    },
    close: () => db.$disconnect(),
  };
}

export async function prepareE2ePiecework(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: (database: E2eDatabase) => Promise<Dependencies> = loadDependencies,
): Promise<PieceworkPublicationReceipt> {
  // Complete the same isolation contract before importing/initializing Prisma.
  const database = activateE2eDatabase(env);
  const username = env.SEED_ADMIN_USERNAME?.trim();
  if (!username) throw new Error('SEED_ADMIN_USERNAME is required for the audited E2E price publication.');
  const deps = await dependencies(database);
  try {
    const [book, actor] = await Promise.all([deps.readBook(), deps.actor(username)]);
    if (!book) throw new Error('Seed the isolated E2E database before publishing fixture rates.');
    if (!actor) throw new Error('The E2E seed administrator must be active.');
    const effectiveFrom = book.status === 'PUBLISHED' && book.effectiveFrom
      ? book.effectiveFrom : new Date(Date.now() + 5_000);
    const manifest = e2ePieceworkManifest(effectiveFrom);
    const sourceSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const receipt = await deps.publish({ manifest, sourceSha256, actor,
      expectedDraftUpdatedAt: book.updatedAt });
    await deps.waitUntilEffective();
    return receipt;
  } finally { await deps.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadEnvConfig(process.cwd(), true);
  prepareE2ePiecework().then((receipt) => {
    console.log(JSON.stringify({ ...receipt, fixture: 'E2E ONLY — not production prices' }, null, 2));
  }).catch(() => {
    // Database exceptions may contain credentials/connection details.
    console.error('E2E piecework preparation failed; verify isolation, seed administrator and the immutable price-book state.');
    process.exitCode = 1;
  });
}
