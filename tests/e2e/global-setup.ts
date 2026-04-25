import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

// Idempotent E2E user fixture. Runs once before the test suite.
// Inserts (or updates) one user per role we need for production-flow
// E2E. Passwords are deterministic and known to the test helpers so
// any spec can `login()` as the right role without going through the
// /owner/accounts UI first.
//
// Why raw pg instead of Prisma client: the generated Prisma client
// uses ESM-only constructs (top-level `import`, `import.meta.url`),
// and Playwright's runner loads .ts files as CJS — they don't compose.
// Vitest works around it via its own bundler. Raw pg sidesteps the
// whole transformer issue and keeps this file dependency-light.
//
// Why direct DB instead of going through the UI: UI-creation requires
// a logged-in OWNER each test run; that's an extra 2-3 seconds per
// cold start and adds a failure surface (account form a11y / validation
// regressions would block all production E2E from running). Direct
// upsert is orders of magnitude faster and the production flow we're
// testing doesn't depend on /owner/accounts working.

export const E2E_PASSWORD = 'e2e-test-password-1234';

// String literal unions matching the Prisma enums; we don't import
// the generated enums object (CJS / ESM tangle, see file header).
type Role = 'OWNER' | 'FOREMAN' | 'SALES' | 'CUSTOMER_SERVICE' | 'WORKER';
type WorkerType = 'MACHINE' | 'PACKER' | 'CLEANER' | 'COOK';
type MachineType = 'HAND_PRESS' | 'WINDMILL' | 'GLUE';

type E2EUser = {
  username: string;
  displayName: string;
  role: Role;
  workerType?: WorkerType | null;
  machineType?: MachineType | null;
};

export const E2E_USERS: Record<string, E2EUser> = {
  sales: {
    username: 'e2e-sales',
    displayName: 'E2E 销售',
    role: 'SALES',
  },
  foreman: {
    username: 'e2e-foreman',
    displayName: 'E2E 主管',
    role: 'FOREMAN',
  },
  // Machine worker on HAND_PRESS so 现货加烫 (defaultMachineType =
  // HAND_PRESS, per seed.ts) shows up as "推荐" in the scheduling
  // form's worker picker for that craft.
  workerHandPress: {
    username: 'e2e-worker-hand',
    displayName: 'E2E 开机仔',
    role: 'WORKER',
    workerType: 'MACHINE',
    machineType: 'HAND_PRESS',
  },
  // CUSTOMER_SERVICE user — needed for CS accumulate E2E (the
  // recordPayment → accumulateCsSales path only fires when the
  // bill's salesUser.role === CUSTOMER_SERVICE).
  customerService: {
    username: 'e2e-cs',
    displayName: 'E2E 客服',
    role: 'CUSTOMER_SERVICE',
  },
};

export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
    for (const u of Object.values(E2E_USERS)) {
      // ON CONFLICT mirrors the upsert semantics: if the row exists
      // we re-hash the password and reactivate. createdAt is set on
      // first insert and never touched again.
      //
      // ID is generated in JS (not via gen_random_uuid()) so we don't
      // require the pgcrypto extension at the DB level — the repo's
      // migrations don't install it, so a clean CI / local PG would
      // throw `function gen_random_uuid() does not exist` (Codex round
      // 76 / P1). User.id is just a `text` column populated by Prisma's
      // client-side cuid() in production; any unique string works.
      const id = `e2e-${randomBytes(12).toString('hex')}`;
      await client.query(
        `
        INSERT INTO "User" (
          id, username, "displayName", password,
          role, "workerType", "machineType", "isActive",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5::"Role", $6::"WorkerType", $7::"MachineType",
          TRUE, NOW(), NOW()
        )
        ON CONFLICT (username) DO UPDATE SET
          "displayName" = EXCLUDED."displayName",
          password = EXCLUDED.password,
          role = EXCLUDED.role,
          "workerType" = EXCLUDED."workerType",
          "machineType" = EXCLUDED."machineType",
          "isActive" = TRUE,
          "updatedAt" = NOW()
        `,
        [
          id,
          u.username,
          u.displayName,
          passwordHash,
          u.role,
          u.workerType ?? null,
          u.machineType ?? null,
        ],
      );
    }
  } finally {
    await client.end();
  }
}
