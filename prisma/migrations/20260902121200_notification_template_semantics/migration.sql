-- Correct the two historical defaults whose wording no longer matches the
-- canonical workflow. Update only rows that still equal the exact old seed
-- text, so an administrator-authored template is never overwritten.
ALTER TABLE "NotificationRule"
  ALTER COLUMN "isActive" SET DEFAULT false;

UPDATE "NotificationRule"
   SET "messageTemplate" = '**工单已下发**
工单号：{orderNo}
当前生产步骤数：{taskCount}',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "eventType" = 'ORDER_SCHEDULED'
   AND "messageTemplate" = '**工单已排产**
工单号：{orderNo}
分配任务数：{taskCount}';

UPDATE "NotificationRule"
   SET "messageTemplate" = '**生产已完成**
工单号：{orderNo}
请在系统核对当前状态后处理',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "eventType" = 'ORDER_COMPLETED'
   AND "messageTemplate" = '**工单完工**
工单号：{orderNo}
可以安排发货';
