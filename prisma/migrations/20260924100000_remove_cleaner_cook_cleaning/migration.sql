-- 业主 2026-09-24：ERP 不再有清废（CLEANER / CLEANING 工艺）与厨师（COOK）。
-- 本迁移彻底删除它们：WorkerType 的 CLEANER / COOK、SalaryRuleType 的
-- COOK_SALARY、CLEANING 工艺行、只服务于它们的工资规则，以及只由厨师使用的
-- 空闲打包工时列（Attendance.spareHours / HourlyWorkerPayroll.totalSpareHours /
-- HourlyWorkerPayroll.spareSalary）。
--
-- FAIL CLOSED：只要业务数据（账号、考勤、派工、工单款式、进度、薪资、待审
-- 改单）仍引用这些值就整体中止，绝不静默改写历史。配置行（规则、未被引用的
-- CLEANING 工艺、工艺能力、排队中的时薪月结 cron 任务）由本迁移删除/取消。
-- 整个脚本作为一次多语句请求执行，在 PostgreSQL 中是单一隐式事务：任何
-- RAISE 都会回滚全部改动（不写显式 BEGIN，否则报错信息会被
-- "current transaction is aborted" 掩盖）。

DO $$
DECLARE
  cleaning_ids text[];
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "User" WHERE "workerType"::text IN ('CLEANER', 'COOK');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个账号的岗位是清废或厨师；请先把这些账号改为其他岗位或按业主决定处理后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Attendance" WHERE "workerTypeSnapshot"::text IN ('CLEANER', 'COOK');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条考勤记录属于清废或厨师；历史考勤需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Attendance" WHERE "spareHours" <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条考勤记录含厨师空闲打包工时；需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "HourlyWorkerPayroll"
  WHERE "salaryRuleSnapshot" ->> 'workerType' IN ('CLEANER', 'COOK')
     OR "spareSalary" <> 0
     OR "totalSpareHours" <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条清废或厨师的时薪月结；工资记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "ProductionTask" WHERE "workerType"::text IN ('CLEANER', 'COOK');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条生产任务派给清废或厨师岗位；需业主决定如何处理后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Craft"
  WHERE "defaultWorkerType"::text IN ('CLEANER', 'COOK') AND "code" <> 'CLEANING';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个非清废工艺的接单岗位是清废或厨师；请先在工艺字典改为其他岗位后再迁移', n;
  END IF;

  SELECT coalesce(array_agg("id"), ARRAY[]::text[]) INTO cleaning_ids
  FROM "Craft" WHERE "code" = 'CLEANING';

  IF cardinality(cleaning_ids) > 0 THEN
    SELECT count(*) INTO n FROM "OrderItem" WHERE "crafts" && cleaning_ids;
    IF n > 0 THEN
      RAISE EXCEPTION '仍有 % 个工单款式选择了清废工艺；需业主决定如何处理后再迁移', n;
    END IF;

    SELECT count(*) INTO n FROM "ProductionTask" WHERE "craftId" = ANY (cleaning_ids);
    IF n > 0 THEN
      RAISE EXCEPTION '仍有 % 条生产任务属于清废工艺；需业主决定如何处理后再迁移', n;
    END IF;

    SELECT count(*) INTO n FROM "DailyWorkerSalaryItem" WHERE "craftId" = ANY (cleaning_ids);
    IF n > 0 THEN
      RAISE EXCEPTION '仍有 % 条日工资明细属于清废工艺；需业主决定如何处理后再迁移', n;
    END IF;

    SELECT count(*) INTO n FROM "OrderChangeRequest"
    WHERE "status" = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM unnest(cleaning_ids) AS c(id)
        WHERE "OrderChangeRequest"."proposedChanges"::text LIKE '%' || c.id || '%'
      );
    IF n > 0 THEN
      RAISE EXCEPTION '仍有 % 个待审改单选择了清废工艺；请先驳回或撤回后再迁移', n;
    END IF;
  END IF;

  SELECT count(*) INTO n FROM "ProductionProgressStep"
  WHERE "craftCode" = 'CLEANING' OR "craftId" = ANY (cleaning_ids);
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条生产进度步骤属于清废工艺；需业主决定如何处理后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "BackgroundJob"
  WHERE "type" = 'CRON_HOURLY_PAYROLL' AND "status" = 'RUNNING';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个时薪月结后台任务正在运行；请等待其结束后再迁移', n;
  END IF;
END $$;

-- 配置行：CLEANING 工艺（其能力配置随外键级联删除）与只服务于清废/厨师的工资规则。
DELETE FROM "WorkerCraftCapability"
WHERE "craftId" IN (SELECT "id" FROM "Craft" WHERE "code" = 'CLEANING');
DELETE FROM "Craft" WHERE "code" = 'CLEANING';

DELETE FROM "SalaryRule"
WHERE "ruleType"::text = 'COOK_SALARY'
   OR ("ruleType"::text = 'WORKER_HOURLY'
       AND "ruleKey" IN ('CLEANER_HOURLY', 'COOK_SPARE_HOURLY', 'OT_MULTIPLIER'));

-- 时薪月结 cron 已删除；排队中的任务不再有处理器。已结束的任务保留为运行历史。
UPDATE "BackgroundJob"
SET "status" = 'CANCELLED',
    "finishedAt" = now(),
    "lastErrorCode" = 'JOB_TYPE_REMOVED',
    "updatedAt" = now()
WHERE "type" = 'CRON_HOURLY_PAYROLL' AND "status" = 'PENDING';

-- 厨师专用的空闲打包工时列（上面已确认全部为 0）。
ALTER TABLE "HourlyWorkerPayroll"
  DROP CONSTRAINT "HourlyWorkerPayroll_component_total_reconciles";
ALTER TABLE "HourlyWorkerPayroll"
  DROP COLUMN "totalSpareHours",
  DROP COLUMN "spareSalary";
ALTER TABLE "HourlyWorkerPayroll"
  ADD CONSTRAINT "HourlyWorkerPayroll_component_total_reconciles"
  CHECK ("totalSalary" = "baseSalary" + "otSalary");
ALTER TABLE "Attendance" DROP COLUMN "spareHours";

-- WorkerType：去掉 CLEANER / COOK。自助接单的 CHECK 约束带有旧类型字面量，
-- 必须先删后建。
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_self_claim_state_check";

ALTER TYPE "WorkerType" RENAME TO "WorkerType_old";
CREATE TYPE "WorkerType" AS ENUM ('MACHINE', 'PACKER');
ALTER TABLE "User"
  ALTER COLUMN "workerType" TYPE "WorkerType" USING ("workerType"::text::"WorkerType");
ALTER TABLE "Craft"
  ALTER COLUMN "defaultWorkerType" TYPE "WorkerType" USING ("defaultWorkerType"::text::"WorkerType");
ALTER TABLE "ProductionTask"
  ALTER COLUMN "workerType" TYPE "WorkerType" USING ("workerType"::text::"WorkerType");
ALTER TABLE "Attendance"
  ALTER COLUMN "workerTypeSnapshot" TYPE "WorkerType" USING ("workerTypeSnapshot"::text::"WorkerType");
DROP TYPE "WorkerType_old";

ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_self_claim_state_check" CHECK (
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

-- SalaryRuleType：去掉 COOK_SALARY（其规则行已在上面删除）。
ALTER TYPE "SalaryRuleType" RENAME TO "SalaryRuleType_old";
CREATE TYPE "SalaryRuleType" AS ENUM ('CS_COMMISSION', 'WORKER_MACHINE', 'WORKER_HOURLY');
ALTER TABLE "SalaryRule"
  ALTER COLUMN "ruleType" TYPE "SalaryRuleType" USING ("ruleType"::text::"SalaryRuleType");
DROP TYPE "SalaryRuleType_old";

