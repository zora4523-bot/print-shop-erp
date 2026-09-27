import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { assertReleasePieceworkPrerequisite } from '../../scripts/lib/e2e-piecework';

// Idempotent E2E user fixture. Runs once before the test suite.
// Inserts (or updates) one user per role needed by the E2E suite. Passwords
// are deterministic and known to the test helpers so
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
// a logged-in ADMIN each test run; that's an extra 2-3 seconds per
// cold start and adds a failure surface (account form a11y / validation
// regressions would block all production E2E from running). Direct
// upsert is orders of magnitude faster and the production flow we're
// testing doesn't depend on /owner/accounts working.

export const E2E_PASSWORD = 'e2e-test-password-1234';

// String literal unions matching the Prisma enums; we don't import
// the generated enums object (CJS / ESM tangle, see file header).
type Role = 'ADMIN' | 'SALES' | 'WORKER';
type WorkerType = 'MACHINE' | 'PACKER';
type MachineType = 'HAND_PRESS' | 'WINDMILL' | 'GLUE';
type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'TEMPORARY';

type E2EUser = {
  username: string;
  displayName: string;
  role: Role;
  workerType?: WorkerType | null;
  machineType?: MachineType | null;
  employmentType?: EmploymentType | null;
};

export const E2E_USERS: Record<string, E2EUser> = {
  owner: {
    username: 'e2e-owner',
    displayName: 'E2E 管理员',
    role: 'ADMIN',
  },
  sales: {
    username: 'e2e-sales',
    displayName: 'E2E 销售',
    role: 'SALES',
  },
  // Billing owns a dedicated SALES identity. Production-flow orders are
  // intentionally durable because salary and task ledgers restrict deletion;
  // sharing e2e-sales made a later bill test re-aggregate those old FINISHED
  // orders. A separate account keeps the receivables fixture deterministic
  // without weakening the production ledger cleanup rules.
  billingSales: {
    username: 'e2e-billing-sales',
    displayName: 'E2E 对账销售',
    role: 'SALES',
  },
  foreman: {
    username: 'e2e-foreman',
    displayName: 'E2E 管理员 2',
    role: 'ADMIN',
  },
  // Fixed production lane: HAND_PRESS accounts report PARTIAL operations.
  workerHandPress: {
    username: 'e2e-worker-hand',
    displayName: 'E2E 开机仔',
    role: 'WORKER',
    workerType: 'MACHINE',
    machineType: 'HAND_PRESS',
  },
  workerWindmill: {
    username: 'e2e-worker-windmill',
    displayName: 'E2E 风车机师傅',
    role: 'WORKER',
    workerType: 'MACHINE',
    machineType: 'WINDMILL',
  },
  workerPacker: {
    username: 'e2e-worker-packer',
    displayName: 'E2E 打包师傅',
    role: 'WORKER',
    workerType: 'PACKER',
    machineType: null,
    employmentType: 'FULL_TIME',
  },
};

export default async function globalSetup(): Promise<void> {
  const database = assertActivatedE2eDatabase();
  const client = new Client({ connectionString: database.url });
  await client.connect();
  try {
    const identity = await client.query<{ database: string }>('SELECT current_database() AS database');
    if (identity.rows[0]?.database !== database.databaseName) {
      throw new Error('Connected database does not match E2E_DATABASE_CONFIRM_DATABASE; fixture writes refused.');
    }
    if (process.env.E2E_RELEASE_MODE === '1') {
      await assertReleasePieceworkPrerequisite(client);
    }
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
          role, "workerType", "machineType", "employmentType", "isActive",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5::"Role", $6::"WorkerType", $7::"MachineType",
          $8::"EmploymentType", TRUE, NOW(), NOW()
        )
        ON CONFLICT (username) DO UPDATE SET
          "displayName" = EXCLUDED."displayName",
          password = EXCLUDED.password,
          role = EXCLUDED.role,
          "workerType" = EXCLUDED."workerType",
          "machineType" = EXCLUDED."machineType",
          "employmentType" = EXCLUDED."employmentType",
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
          u.employmentType ?? null,
        ],
      );
    }

  } finally {
    await client.end();
  }
}
