import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260826120000_worker_self_claim',
    'migration.sql',
  ),
  'utf8',
);

const stateCheck = migration.slice(
  migration.indexOf('ADD CONSTRAINT "ProductionTask_self_claim_state_check"'),
  migration.indexOf('CREATE INDEX "ProductionTask_self_claim_pool_idx"'),
);

const poolIndex = migration.slice(
  migration.indexOf('CREATE INDEX "ProductionTask_self_claim_pool_idx"'),
  migration.indexOf('-- Deploys do not always run seed.'),
);

describe('worker self-claim migration contract', () => {
  it('adds the claim state with closed-by-default, non-null snapshots', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      'ADD COLUMN "isSelfClaimable" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'ADD COLUMN "selfClaimOpenedAt" TIMESTAMP(3)',
    );
    expect(migration).toContain(
      'ADD COLUMN "selfClaimedAt" TIMESTAMP(3)',
    );
    expect(migration).toMatch(
      /ADD COLUMN "claimMachineTypes" "MachineType"\[\] NOT NULL\s+DEFAULT ARRAY\[\]::"MachineType"\[\]/,
    );
  });

  it('enforces ordinary, open-pool, and claimed states in one CHECK', () => {
    expect(stateCheck).toContain(
      'ADD CONSTRAINT "ProductionTask_self_claim_state_check"',
    );
    expect(stateCheck.match(/\n    OR \(/g)).toHaveLength(2);

    expect(stateCheck).toContain(
      'NOT "isSelfClaimable"\n      AND "selfClaimOpenedAt" IS NULL\n      AND "selfClaimedAt" IS NULL\n      AND cardinality("claimMachineTypes") = 0',
    );
    expect(stateCheck).toContain(
      '"isSelfClaimable"\n      AND "status" = \'PENDING\'::"TaskStatus"\n      AND "workerId" IS NULL\n      AND "workerType" IS NOT NULL\n      AND "selfClaimOpenedAt" IS NOT NULL\n      AND "selfClaimedAt" IS NULL',
    );
    expect(stateCheck).toContain(
      'NOT "isSelfClaimable"\n      AND "workerId" IS NOT NULL\n      AND "workerType" IS NOT NULL\n      AND "selfClaimOpenedAt" IS NOT NULL\n      AND "selfClaimedAt" IS NOT NULL',
    );
    expect(
      stateCheck.match(
        /"workerType" = 'MACHINE'::"WorkerType" AND cardinality\("claimMachineTypes"\) > 0/g,
      ),
    ).toHaveLength(2);
    expect(
      stateCheck.match(
        /"workerType" <> 'MACHINE'::"WorkerType" AND cardinality\("claimMachineTypes"\) = 0/g,
      ),
    ).toHaveLength(2);
  });

  it('indexes only actionable pool rows', () => {
    expect(poolIndex).toContain(
      'ON "ProductionTask"("workerType", "createdAt", "id")',
    );
    expect(poolIndex).toContain('WHERE "isSelfClaimable" = true');
    expect(poolIndex).toContain(
      'AND "status" = \'PENDING\'::"TaskStatus"',
    );
    expect(poolIndex).toContain('AND "workerId" IS NULL');
  });

  it('installs the global switch as disabled without overwriting operator state', () => {
    expect(migration).toContain("'worker_self_claim_enabled'");
    expect(migration).toContain('\'{"enabled":false}\'::jsonb');
    expect(migration).toContain('ON CONFLICT ("key") DO NOTHING');
    expect(migration).not.toContain('DO UPDATE SET');
  });
});
