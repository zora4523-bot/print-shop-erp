-- 业主 2026-09-24：ERP 不再有客服（CUSTOMER_SERVICE）角色，所有收费业务都以
-- 外部销售身份开展（管理员代建也必须归属一个外部销售）。本迁移彻底删除：
--   * Role 的 CUSTOMER_SERVICE；
--   * OrderSettlementType 的 INTERNAL_SALES / FACTORY_DIRECT（保留
--     EXTERNAL_SALES 与免费重做使用的 NO_CHARGE）；
--   * SalaryRuleType 的 CS_COMMISSION 及其规则行（CS_BASE_SALARY /
--     CS_PERIOD_LENGTH / CS_TIERS）；
--   * 客服工资体系的四张表 SalaryPeriod / CsSalesEntry /
--     CustomerServiceCommission / CsPayrollPayment 与枚举 SalaryPeriodStatus /
--     CsSalesEntryType；
--   * 通知规则 CS_PERIOD_ENDING / CS_PERIOD_SETTLED，并取消排队中的客服 cron
--     与客服通知后台任务。
--
-- FAIL CLOSED：只要业务数据（账号、工单及其身份 / 结算快照、价目簿、考勤、
-- 审计日志、四张客服工资表、价格修订快照）仍引用这些值就整体中止，绝不静默
-- 改写或删除历史。整个脚本作为一次多语句请求执行，在 PostgreSQL 中是单一
-- 隐式事务：任何 RAISE 都会回滚全部改动（不写显式 BEGIN，否则报错信息会被
-- "current transaction is aborted" 掩盖）。

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "User" WHERE "role"::text = 'CUSTOMER_SERVICE';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个账号的角色是客服；请先把这些账号改为外部销售或其他角色（或按业主决定处理）后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Order" WHERE "submitterRole"::text = 'CUSTOMER_SERVICE';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 张工单的提交人身份快照是客服；历史工单需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Order" WHERE "settlementType"::text IN ('INTERNAL_SALES', 'FACTORY_DIRECT');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 张工单按内部销售或工厂直单结算；需业主决定如何归属外部销售后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "OrderPricingRevision"
  WHERE "snapshot" -> 'order' ->> 'settlementType' IN ('INTERNAL_SALES', 'FACTORY_DIRECT');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条价格修订快照记录内部销售或工厂直单结算；需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "CustomerPriceBook" WHERE "settlementType"::text IN ('INTERNAL_SALES', 'FACTORY_DIRECT');
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 本价目簿属于内部销售或工厂直单结算；需业主决定如何处理后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "Attendance" WHERE "roleSnapshot"::text = 'CUSTOMER_SERVICE';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条考勤记录属于客服；历史考勤需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "BusinessAuditLog" WHERE "actorRole"::text = 'CUSTOMER_SERVICE';
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条业务审计日志的操作人身份是客服；审计记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "SalaryPeriod";
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个客服工资周期（SalaryPeriod）；客服工资记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "CsSalesEntry";
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条客服业绩流水（CsSalesEntry）；业绩记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "CustomerServiceCommission";
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条客服提成结算（CustomerServiceCommission）；工资记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "CsPayrollPayment";
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 条客服工资发放流水（CsPayrollPayment）；财务记录需业主决定如何归档后再迁移', n;
  END IF;

  SELECT count(*) INTO n FROM "BackgroundJob"
  WHERE "status" = 'RUNNING'
    AND (
      "type" IN ('CRON_CS_SETTLE', 'CRON_CS_PERIOD_ENDING')
      OR ("type" = 'NOTIFICATION' AND "payload" ->> 'event' IN ('CS_PERIOD_ENDING', 'CS_PERIOD_SETTLED'))
    );
  IF n > 0 THEN
    RAISE EXCEPTION '仍有 % 个客服周期后台任务正在运行；请等待其结束后再迁移', n;
  END IF;
END $$;

-- 配置行：客服提成 / 底薪 / 周期规则与客服周期通知规则。
DELETE FROM "SalaryRule" WHERE "ruleType"::text = 'CS_COMMISSION';
DELETE FROM "NotificationRule" WHERE "eventType" IN ('CS_PERIOD_ENDING', 'CS_PERIOD_SETTLED');

-- 客服 cron 与客服周期通知已删除；排队中的任务不再有处理器。已结束的任务
-- 与历史投递日志保留为运行记录。
UPDATE "BackgroundJob"
SET "status" = 'CANCELLED',
    "finishedAt" = now(),
    "lastErrorCode" = 'JOB_TYPE_REMOVED',
    "updatedAt" = now()
WHERE "status" = 'PENDING'
  AND (
    "type" IN ('CRON_CS_SETTLE', 'CRON_CS_PERIOD_ENDING')
    OR ("type" = 'NOTIFICATION' AND "payload" ->> 'event' IN ('CS_PERIOD_ENDING', 'CS_PERIOD_SETTLED'))
  );

-- 客服工资体系四张表（上面已确认全部为空）与其枚举。
DROP TABLE "CsPayrollPayment";
DROP TABLE "CustomerServiceCommission";
DROP TABLE "CsSalesEntry";
DROP TABLE "SalaryPeriod";
DROP TYPE "CsSalesEntryType";
DROP TYPE "SalaryPeriodStatus";

-- 带旧枚举字面量的 CHECK 约束必须先删后建；列级触发器（UPDATE OF
-- "settlementType"）阻止修改列类型，同样先删后按原定义重建。
DROP TRIGGER "Order_protect_billed_settlement" ON "Order";
ALTER TABLE "Order" DROP CONSTRAINT "Order_settlement_role_consistent";
ALTER TABLE "Order" DROP CONSTRAINT "Order_billing_settlement_consistent";
ALTER TABLE "Order" DROP CONSTRAINT "Order_priceRevision_check";
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_worker_type_snapshot_role_check";

-- Role：去掉 CUSTOMER_SERVICE。
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'WORKER');
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "Order"
  ALTER COLUMN "submitterRole" TYPE "Role" USING ("submitterRole"::text::"Role");
ALTER TABLE "Attendance"
  ALTER COLUMN "roleSnapshot" TYPE "Role" USING ("roleSnapshot"::text::"Role");
ALTER TABLE "BusinessAuditLog"
  ALTER COLUMN "actorRole" TYPE "Role" USING ("actorRole"::text::"Role");
DROP TYPE "Role_old";

-- OrderSettlementType：去掉 INTERNAL_SALES / FACTORY_DIRECT。
ALTER TYPE "OrderSettlementType" RENAME TO "OrderSettlementType_old";
CREATE TYPE "OrderSettlementType" AS ENUM ('EXTERNAL_SALES', 'NO_CHARGE');
ALTER TABLE "Order"
  ALTER COLUMN "settlementType" TYPE "OrderSettlementType" USING ("settlementType"::text::"OrderSettlementType");
ALTER TABLE "CustomerPriceBook"
  ALTER COLUMN "settlementType" TYPE "OrderSettlementType" USING ("settlementType"::text::"OrderSettlementType");
DROP TYPE "OrderSettlementType_old";

-- SalaryRuleType：去掉 CS_COMMISSION（其规则行已在上面删除）。
ALTER TYPE "SalaryRuleType" RENAME TO "SalaryRuleType_old";
CREATE TYPE "SalaryRuleType" AS ENUM ('WORKER_MACHINE', 'WORKER_HOURLY');
ALTER TABLE "SalaryRule"
  ALTER COLUMN "ruleType" TYPE "SalaryRuleType" USING ("ruleType"::text::"SalaryRuleType");
DROP TYPE "SalaryRuleType_old";

CREATE TRIGGER "Order_protect_billed_settlement"
  BEFORE UPDATE OF "settledFee", "settledAt", "settlementContractVersion", "submitterId", "settlementType", "billingMode"
  ON "Order"
  FOR EACH ROW EXECUTE FUNCTION protect_billed_order_settlement();

-- 重建 CHECK 约束。收费工单只剩“外部销售提交、按外部销售结算”一条路径；
-- 免费重做仍由 NO_CHARGE 表达，不约束提交人身份。
ALTER TABLE "Order" ADD CONSTRAINT "Order_billing_settlement_consistent" CHECK (
  ("billingMode" = 'NO_CHARGE'::"OrderBillingMode" AND "settlementType" = 'NO_CHARGE'::"OrderSettlementType")
  OR ("billingMode" = 'CHARGE'::"OrderBillingMode" AND "settlementType" <> 'NO_CHARGE'::"OrderSettlementType")
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_settlement_role_consistent" CHECK (
  ("billingMode" = 'NO_CHARGE'::"OrderBillingMode" AND "settlementType" = 'NO_CHARGE'::"OrderSettlementType")
  OR (
    "billingMode" = 'CHARGE'::"OrderBillingMode"
    AND "submitterRole" = 'SALES'::"Role"
    AND "settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  )
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_priceRevision_check" CHECK (
  "priceRevision" >= 1
  OR (
    "priceRevision" = 0
    AND "status" = 'DRAFT'::"OrderStatus"
    AND "quotedPricingRevisionId" IS NULL
    AND (
      "settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      OR "purpose" = ANY (ARRAY['SAMPLE_SHIPMENT'::"OrderPurpose", 'PROOF'::"OrderPurpose"])
    )
  )
);
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_worker_type_snapshot_role_check" CHECK (
  ("roleSnapshot" = 'WORKER'::"Role" AND "workerTypeSnapshot" IS NOT NULL)
  OR ("roleSnapshot" <> 'WORKER'::"Role" AND "workerTypeSnapshot" IS NULL)
);
