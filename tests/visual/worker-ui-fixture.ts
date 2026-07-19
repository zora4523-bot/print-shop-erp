import { Client } from 'pg';
import { E2E_USERS } from '../e2e/global-setup';

export type WorkerUiFixture = {
  orderId: string;
  orderNo: string;
  orderItemActiveId: string;
  orderItemCompletedId: string;
  activeTaskId: string;
  completedTaskId: string;
  salaryId: string;
  salaryItemId: string;
  adjustmentId: string;
  salaryDate: string;
};

function fixtureFor(namespace: string): WorkerUiFixture {
  const suffix = namespace
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'default';
  let hash = 0;
  for (const character of suffix) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const salaryDate = new Date(Date.UTC(2098, 0, 1 + (hash % 300)))
    .toISOString()
    .slice(0, 10);
  const prefix = `e2e-worker-ui-${suffix}`;
  return {
    orderId: `${prefix}-order`,
    orderNo: `GD-260719-WORKER-RESPONSIVE-LONG-IDENTIFIER-0123456789-${suffix.toUpperCase()}`,
    orderItemActiveId: `${prefix}-item-active`,
    orderItemCompletedId: `${prefix}-item-completed`,
    activeTaskId: `${prefix}-task-active`,
    completedTaskId: `${prefix}-task-completed`,
    salaryId: `${prefix}-salary`,
    salaryItemId: `${prefix}-salary-item`,
    adjustmentId: `${prefix}-adjustment`,
    salaryDate,
  };
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function seedWorkerUiFixture(
  namespace = 'default',
): Promise<WorkerUiFixture> {
  const fixture = fixtureFor(namespace);
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      const users = await db.query<{ id: string; username: string }>(
        `SELECT id, username FROM "User" WHERE username = ANY($1::text[])`,
        [[E2E_USERS.workerHandPress!.username, E2E_USERS.owner!.username, E2E_USERS.sales!.username]],
      );
      const userId = (username: string) => {
        const user = users.rows.find((row) => row.username === username);
        if (!user) throw new Error(`E2E user ${username} not found`);
        return user.id;
      };
      const workerId = userId(E2E_USERS.workerHandPress!.username);
      const adminId = userId(E2E_USERS.owner!.username);
      const salesId = userId(E2E_USERS.sales!.username);

      const craft = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM "Craft"
         WHERE "isActive" = TRUE AND "isOutsource" = FALSE
         ORDER BY CASE WHEN "defaultWorkerType" = 'MACHINE'::"WorkerType" THEN 0 ELSE 1 END,
                  "sortOrder", name
         LIMIT 1`,
      );
      if (!craft.rows[0]) throw new Error('Worker UI E2E requires at least one active in-house craft');

      await db.query(`DELETE FROM "DailyWorkerSalary" WHERE id = $1`, [fixture.salaryId]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [fixture.orderId]);

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById", status,
           "isUrgent", "customerRef", "packageRequirement", remark, "promisedDate",
           "submittedAt", "scheduledAt", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3, 'IN_PRODUCTION'::"OrderStatus",
           TRUE, $4, $5, $6, DATE '2099-12-31',
           TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00',
           TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00'
         )`,
        [
          fixture.orderId,
          fixture.orderNo,
          salesId,
          '超长客户代号ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证中英混排不裁切',
          '包装要求：请将每一万个分组装箱并标注ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          '工单备注：这是用于响应式裁切回归的超长中文文本与UnbrokenToken0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        ],
      );

      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType", quantity,
           crafts, "isDoubleSided", "isDoubleColor", remark, "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 1, $4, $5, $6, 1234567, ARRAY[$7]::text[], TRUE, TRUE, $8, NOW(), NOW()),
           ($2, $3, 2, $9, $5, $6, 987654, ARRAY[$7]::text[], FALSE, FALSE, $8, NOW(), NOW())`,
        [
          fixture.orderItemActiveId,
          fixture.orderItemCompletedId,
          fixture.orderId,
          '超长款式名称红包烫金高级定制版ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          'https://example.invalid/specification/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/very-long-unbroken-value',
          '特种珠光纸ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          craft.rows[0].id,
          '款式备注包含连续文本ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789防止隐式裁切',
          '已完工款式用于验证工单与工资明细的长文本布局',
        ],
      );

      await db.query(
        `INSERT INTO "ProductionTask" (
           id, "orderItemId", "craftId", "workerId", "workerType", "machineType",
           status, "plannedQty", "boardCount", "pressCount", "completedQty",
           "defectQty", "reworkQty", "pieceworkAmount", "salaryRuleSnapshot",
           "startedAt", "completedAt", remark, "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, $5, $6, 'MACHINE'::"WorkerType", 'HAND_PRESS'::"MachineType",
            'IN_PROGRESS'::"TaskStatus", 1234567, 0, 0, 0, 0, 0, 0,
            NULL, TIMESTAMP '2026-07-19 10:00:00', NULL, $7, NOW(), NOW()),
           ($2, $4, $5, $6, 'MACHINE'::"WorkerType", 'HAND_PRESS'::"MachineType",
            'COMPLETED'::"TaskStatus", 987654, 123, 456789, 987000, 321, 333, 8888.88,
            $8::jsonb, TIMESTAMP '2026-07-18 10:00:00', TIMESTAMP '2026-07-18 18:30:00',
            $7, NOW(), NOW())`,
        [
          fixture.activeTaskId,
          fixture.completedTaskId,
          fixture.orderItemActiveId,
          fixture.orderItemCompletedId,
          craft.rows[0].id,
          workerId,
          '任务备注ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于检查不可见裁切',
          JSON.stringify({ kind: 'e2e-worker-ui', price: '0.02' }),
        ],
      );

      await db.query(
        `INSERT INTO "DailyWorkerSalary" (
           id, "workerId", date, "machineType", "baseSalary", "totalPieceworkAmount",
           "adjustmentAmount", "actualSalary", "taskCount", "orderCount",
           "calculationDetail", "salaryRuleSnapshot", "isPaid", "createdAt"
         ) VALUES (
           $1, $2, $3::date, 'HAND_PRESS'::"MachineType", 300.00, 8888.88,
           123.45, 9012.33, 1, 1, $4::jsonb, $4::jsonb, FALSE,
           TIMESTAMP '2026-07-19 19:00:00'
         )`,
        [
          fixture.salaryId,
          workerId,
          fixture.salaryDate,
          JSON.stringify({ kind: 'e2e-worker-ui' }),
        ],
      );

      await db.query(
        `INSERT INTO "DailyWorkerSalaryItem" (
           id, "dailySalaryId", "productionTaskId", "orderId", "orderNo", "orderItemId",
           "orderItemName", "craftId", "craftName", "machineType", "completedQty",
           "defectQty", "reworkQty", "boardCount", "pressCount", "pieceworkAmount",
           "salaryRuleSnapshot", "completedAt", "createdAt"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           'HAND_PRESS'::"MachineType", 987000, 321, 333, 123, 456789, 8888.88,
           $10::jsonb, TIMESTAMP '2026-07-18 18:30:00', TIMESTAMP '2026-07-19 19:00:00'
         )`,
        [
          fixture.salaryItemId,
          fixture.salaryId,
          fixture.completedTaskId,
          fixture.orderId,
          fixture.orderNo,
          fixture.orderItemCompletedId,
          '已完工款式用于验证工单与工资明细的长文本布局',
          craft.rows[0].id,
          `${craft.rows[0].name}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`,
          JSON.stringify({ kind: 'e2e-worker-ui', price: '0.02' }),
        ],
      );

      await db.query(
        `INSERT INTO "SalaryAdjustment" (
           id, "dailySalaryId", type, amount, reason, "createdById", "createdAt"
         ) VALUES (
           $1, $2, 'BONUS'::"SalaryAdjustmentType", 123.45,
           $3, $4, TIMESTAMP '2026-07-19 20:00:00'
         )`,
        [
          fixture.adjustmentId,
          fixture.salaryId,
          '超长奖金原因ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证明细列不会被裁切',
          adminId,
        ],
      );

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });

  return fixture;
}

export async function cleanupWorkerUiFixture(
  fixture: WorkerUiFixture,
): Promise<void> {
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      await db.query(`DELETE FROM "DailyWorkerSalary" WHERE id = $1`, [fixture.salaryId]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [fixture.orderId]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}
