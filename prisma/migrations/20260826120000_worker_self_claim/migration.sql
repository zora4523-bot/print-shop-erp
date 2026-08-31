BEGIN;

-- A nullable worker is not sufficient evidence that a task was intentionally
-- released. Existing rows therefore stay non-claimable by default.
ALTER TABLE "ProductionTask"
  ADD COLUMN "isSelfClaimable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "selfClaimOpenedAt" TIMESTAMP(3),
  ADD COLUMN "selfClaimedAt" TIMESTAMP(3),
  ADD COLUMN "claimMachineTypes" "MachineType"[] NOT NULL
    DEFAULT ARRAY[]::"MachineType"[];

ALTER TABLE "ProductionTask"
  ADD CONSTRAINT "ProductionTask_self_claim_state_check"
  CHECK (
    (
      NOT "isSelfClaimable"
      AND "selfClaimOpenedAt" IS NULL
      AND "selfClaimedAt" IS NULL
      AND cardinality("claimMachineTypes") = 0
    )
    OR (
      "isSelfClaimable"
      AND "status" = 'PENDING'::"TaskStatus"
      AND "workerId" IS NULL
      AND "workerType" IS NOT NULL
      AND "selfClaimOpenedAt" IS NOT NULL
      AND "selfClaimedAt" IS NULL
      AND (
        ("workerType" = 'MACHINE'::"WorkerType" AND cardinality("claimMachineTypes") > 0)
        OR ("workerType" <> 'MACHINE'::"WorkerType" AND cardinality("claimMachineTypes") = 0)
      )
    )
    OR (
      NOT "isSelfClaimable"
      AND "workerId" IS NOT NULL
      AND "workerType" IS NOT NULL
      AND "selfClaimOpenedAt" IS NOT NULL
      AND "selfClaimedAt" IS NOT NULL
      AND (
        ("workerType" = 'MACHINE'::"WorkerType" AND cardinality("claimMachineTypes") > 0)
        OR ("workerType" <> 'MACHINE'::"WorkerType" AND cardinality("claimMachineTypes") = 0)
      )
    )
  );

CREATE INDEX "ProductionTask_self_claim_pool_idx"
  ON "ProductionTask"("workerType", "createdAt", "id")
  WHERE "isSelfClaimable" = true
    AND "status" = 'PENDING'::"TaskStatus"
    AND "workerId" IS NULL;

-- Deploys do not always run seed. The read path still has a false fallback,
-- while this row makes the switch inspectable and lockable immediately after
-- migrate deploy. Setting ids are opaque strings; no database-side cuid
-- generator is required.
INSERT INTO "Setting" ("id", "key", "value", "remark", "updatedAt")
VALUES (
  'setting_worker_self_claim_enabled',
  'worker_self_claim_enabled',
  '{"enabled":false}'::jsonb,
  '师傅自由抢单全局开关',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

COMMIT;
