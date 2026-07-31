import { Client } from 'pg';
import { E2E_USERS } from '../e2e/global-setup';

export type WorkerUiFixture = {
  orderId: string;
  orderNo: string;
  schedulingOrderId: string;
  schedulingOrderNo: string;
  schedulingOrderTwoId: string;
  schedulingOrderTwoNo: string;
  mixedSchedulingOrderId: string;
  mixedSchedulingOrderNo: string;
  overrideSchedulingOrderId: string;
  overrideSchedulingOrderNo: string;
  schedulingItemOneId: string;
  schedulingItemTwoId: string;
  schedulingItemThreeId: string;
  mixedSchedulingItemId: string;
  overrideSchedulingItemId: string;
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
    schedulingOrderId: `${prefix}-scheduling-order`,
    schedulingOrderNo: `GD-260719-BULK-SCHEDULING-${suffix.toUpperCase()}`,
    schedulingOrderTwoId: `${prefix}-scheduling-order-2`,
    schedulingOrderTwoNo: `GD-260719-BULK-SCHEDULING-SECOND-${suffix.toUpperCase()}`,
    mixedSchedulingOrderId: `${prefix}-scheduling-order-mixed`,
    mixedSchedulingOrderNo: `GD-260719-BULK-SCHEDULING-MIXED-${suffix.toUpperCase()}`,
    overrideSchedulingOrderId: `${prefix}-scheduling-order-override`,
    overrideSchedulingOrderNo: `GD-260719-BULK-SCHEDULING-OVERRIDE-${suffix.toUpperCase()}`,
    schedulingItemOneId: `${prefix}-scheduling-item-1`,
    schedulingItemTwoId: `${prefix}-scheduling-item-2`,
    schedulingItemThreeId: `${prefix}-scheduling-item-3`,
    mixedSchedulingItemId: `${prefix}-scheduling-item-mixed`,
    overrideSchedulingItemId: `${prefix}-scheduling-item-override`,
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
        [[
          E2E_USERS.workerHandPress!.username,
          E2E_USERS.workerWindmill!.username,
          E2E_USERS.owner!.username,
          E2E_USERS.sales!.username,
        ]],
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
         WHERE "isActive" = TRUE
           AND "isOutsource" = FALSE
           AND "defaultWorkerType" = 'MACHINE'::"WorkerType"
           AND "defaultMachineType" = 'HAND_PRESS'::"MachineType"
         ORDER BY "sortOrder", name
         LIMIT 1`,
      );
      if (!craft.rows[0]) throw new Error('Worker UI E2E requires at least one active in-house craft');
      const windmillCraft = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM "Craft"
         WHERE "isActive" = TRUE
           AND "isOutsource" = FALSE
           AND "defaultWorkerType" = 'MACHINE'::"WorkerType"
           AND "defaultMachineType" = 'WINDMILL'::"MachineType"
         ORDER BY "sortOrder", name
         LIMIT 1`,
      );
      if (!windmillCraft.rows[0]) {
        throw new Error(
          'Worker UI E2E requires at least one active WINDMILL craft',
        );
      }

      await db.query(`DELETE FROM "DailyWorkerSalary" WHERE id = $1`, [fixture.salaryId]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [fixture.orderId]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.schedulingOrderId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.schedulingOrderTwoId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.mixedSchedulingOrderId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.overrideSchedulingOrderId,
      ]);

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById", status,
           "isUrgent", "isSfCollect", "customerRef", "customName", "packageRequirement", remark, "promisedDate",
           "submittedAt", "scheduledAt", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3, 'IN_PRODUCTION'::"OrderStatus",
           TRUE, TRUE, $4, $5, $6, $7, DATE '2099-12-31',
           TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00',
           TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00'
         )`,
        [
          fixture.orderId,
          fixture.orderNo,
          salesId,
          '超长客户代号ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证中英混排不裁切',
          '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          '包装要求：请将每一万个分组装箱并标注ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          '工单备注：这是用于响应式裁切回归的超长中文文本与UnbrokenToken0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        ],
      );

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById",
           status, "customerRef", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3,
           'SUBMITTED'::"OrderStatus", '混合机型批量排产客户',
           '手动烫金与风车机分步排产测试',
           TIMESTAMP '2026-07-19 08:10:00',
           TIMESTAMP '2026-07-19 08:10:00',
           TIMESTAMP '2026-07-19 08:10:00'
         )`,
        [
          fixture.mixedSchedulingOrderId,
          fixture.mixedSchedulingOrderNo,
          salesId,
        ],
      );
      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType",
           quantity, crafts, "foilColors", "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '混合机型分步派工款式', '大号', '艳红珠光纸',
           2600, ARRAY[$3, $4]::text[], ARRAY['哑金', '红金']::text[],
           FALSE, TRUE, '先手动烫金再走风车机', NOW(), NOW()
         )`,
        [
          fixture.mixedSchedulingItemId,
          fixture.mixedSchedulingOrderId,
          craft.rows[0].id,
          windmillCraft.rows[0].id,
        ],
      );

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById",
           status, "customerRef", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3,
           'SUBMITTED'::"OrderStatus", '非推荐派工测试客户',
           '管理员最终派工原因测试',
           TIMESTAMP '2026-07-19 08:15:00',
           TIMESTAMP '2026-07-19 08:15:00',
           TIMESTAMP '2026-07-19 08:15:00'
         )`,
        [
          fixture.overrideSchedulingOrderId,
          fixture.overrideSchedulingOrderNo,
          salesId,
        ],
      );
      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType",
           quantity, crafts, "foilColors", "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '非推荐派工款式', '大号', '艳红珠光纸',
           1800, ARRAY[$3]::text[], ARRAY['哑金']::text[], FALSE, FALSE,
           '必须填写管理员派工原因', NOW(), NOW()
         )`,
        [
          fixture.overrideSchedulingItemId,
          fixture.overrideSchedulingOrderId,
          craft.rows[0].id,
        ],
      );

      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType", quantity,
           crafts, "foilColors", "isDoubleSided", "isDoubleColor", remark,
           "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 1, $4, $5, $6, 1234567, ARRAY[$7]::text[],
            ARRAY['哑金', '红金', '潘通 871C']::text[], TRUE, TRUE, $8, NOW(), NOW()),
           ($2, $3, 2, $9, $5, $6, 987654, ARRAY[$7]::text[],
            ARRAY['无颜色（纯彩印）']::text[], FALSE, FALSE, $8, NOW(), NOW())`,
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
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById",
           status, "customerRef", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3,
           'SUBMITTED'::"OrderStatus", '第二批量排产客户',
           '第二张跨工单批量排产测试',
           TIMESTAMP '2026-07-19 08:05:00',
           TIMESTAMP '2026-07-19 08:05:00',
           TIMESTAMP '2026-07-19 08:05:00'
         )`,
        [
          fixture.schedulingOrderTwoId,
          fixture.schedulingOrderTwoNo,
          salesId,
        ],
      );
      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType",
           quantity, crafts, "foilColors", "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '跨工单批量派工款式', '方形', '暗红珠光纸',
           3000, ARRAY[$3]::text[], ARRAY['浅金']::text[], FALSE, FALSE,
           '第二张工单关键备注', NOW(), NOW()
         )`,
        [
          fixture.schedulingItemThreeId,
          fixture.schedulingOrderTwoId,
          craft.rows[0].id,
        ],
      );

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "createdById",
           status, "customerRef", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", $3,
           'SUBMITTED'::"OrderStatus", '批量排产客户',
           '批量排产响应式与无障碍测试',
           TIMESTAMP '2026-07-19 08:00:00',
           TIMESTAMP '2026-07-19 08:00:00',
           TIMESTAMP '2026-07-19 08:00:00'
         )`,
        [fixture.schedulingOrderId, fixture.schedulingOrderNo, salesId],
      );
      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, specification, "paperType",
           quantity, crafts, "foilColors", "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 1, '批量派工款式一', '大号', '艳红珠光纸',
            1000, ARRAY[$4]::text[], ARRAY['哑金']::text[], FALSE, FALSE,
            '批量派工关键备注一', NOW(), NOW()),
           ($2, $3, 2, '批量派工款式二', '中号', '艳红珠光纸',
            2000, ARRAY[$4]::text[], ARRAY['红金']::text[], FALSE, FALSE,
            '批量派工关键备注二', NOW(), NOW())`,
        [
          fixture.schedulingItemOneId,
          fixture.schedulingItemTwoId,
          fixture.schedulingOrderId,
          craft.rows[0].id,
        ],
      );

      await db.query(
        `INSERT INTO "OrderItemDesign" (
           id, "orderItemId", "fileType", "fileUrl", "fileName",
           "fileSize", "thumbnailUrl", "uploadedBy", "uploadedAt"
         ) VALUES (
           $1, $2, 'IMAGE'::"DesignFileType", $3, $4,
           1024, $3, $5, TIMESTAMP '2026-07-19 08:30:00'
         )`,
        [
          `${fixture.orderItemActiveId}-design`,
          fixture.orderItemActiveId,
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          '生产设计图超长文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png',
          salesId,
        ],
      );

      await db.query(
        `INSERT INTO "OrderShipment" (
           id, "orderId", sequence, "receiverName", "receiverPhone",
           "receiverAddress", "expressCode", status, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '响应式测试收货人', '13800138000',
           '佛山市超长测试地址ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
           'SF', 'PLANNED'::"ShipmentStatus", NOW(), NOW()
         )`,
        [`${fixture.orderId}-shipment`, fixture.orderId],
      );
      await db.query(
        `INSERT INTO "OrderShipmentLine" (
           id, "shipmentId", "orderItemId", quantity
         ) VALUES
           ($1, $3, $4, 1234567),
           ($2, $3, $5, 987654)`,
        [
          `${fixture.orderId}-shipment-line-1`,
          `${fixture.orderId}-shipment-line-2`,
          `${fixture.orderId}-shipment`,
          fixture.orderItemActiveId,
          fixture.orderItemCompletedId,
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
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.schedulingOrderId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.schedulingOrderTwoId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.mixedSchedulingOrderId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [
        fixture.overrideSchedulingOrderId,
      ]);
      await db.query(`DELETE FROM "Order" WHERE id = $1`, [fixture.orderId]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}
