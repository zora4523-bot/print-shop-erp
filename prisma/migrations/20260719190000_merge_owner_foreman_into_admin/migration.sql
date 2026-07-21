-- OWNER 与 FOREMAN 在当前组织中没有实际权限边界，统一为 ADMIN。
-- 采用重建 enum 的方式一次性迁移用户、历史工单快照和审计日志；
-- 迁移在事务中执行，避免出现代码和数据只完成一半的状态。
BEGIN;

ALTER TYPE "Role" RENAME TO "Role_legacy";

CREATE TYPE "Role" AS ENUM (
  'ADMIN',
  'SALES',
  'CUSTOMER_SERVICE',
  'WORKER'
);

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role"
  USING (
    CASE "role"::text
      WHEN 'OWNER' THEN 'ADMIN'
      WHEN 'FOREMAN' THEN 'ADMIN'
      ELSE "role"::text
    END
  )::"Role";

ALTER TABLE "Order"
  ALTER COLUMN "submitterRole" TYPE "Role"
  USING (
    CASE "submitterRole"::text
      WHEN 'OWNER' THEN 'ADMIN'
      WHEN 'FOREMAN' THEN 'ADMIN'
      ELSE "submitterRole"::text
    END
  )::"Role";

ALTER TABLE "BusinessAuditLog"
  ALTER COLUMN "actorRole" TYPE "Role"
  USING (
    CASE "actorRole"::text
      WHEN 'OWNER' THEN 'ADMIN'
      WHEN 'FOREMAN' THEN 'ADMIN'
      ELSE "actorRole"::text
    END
  )::"Role";

DROP TYPE "Role_legacy";

COMMIT;
