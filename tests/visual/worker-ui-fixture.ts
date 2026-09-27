import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { E2E_USERS } from '../e2e/global-setup';

/**
 * 师傅端工单页显示工单归属的外部销售（业主 2026-09-27，取代「客户名称/简称」与「接单人」）。
 * 超长姓名接替原超长客户代号做中英混排不裁切检查：含一段不可断开的英文数字串，
 * 且不超过姓名上限 64 字。
 */
export const WORKER_UI_LONG_SALES_NAME =
  '超长外部销售姓名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证中英混排不裁切';
const WORKER_UI_LONG_SALES_USERNAME = 'e2e-worker-ui-long-sales';

export type WorkerUiFixtureOptions = {
  /**
   * 主工单改归一位超长姓名的停用外部销售。只给师傅端门禁用：管理端门禁以 e2e-sales
   * 身份打开同一张主工单（外部销售只看得到自己提交的单），默认必须仍归 e2e-sales。
   */
  longExternalSales?: boolean;
};

export type WorkerUiFixture = {
  craftId: string;
  craftName: string;
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
  hourlyWorkerId: string;
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
    craftId: '',
    craftName: '',
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
    hourlyWorkerId: `${prefix}-long-packer`,
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

async function deleteUnusedHourlyWorker(db: Client, id: string): Promise<void> {
  if (!/^e2e-worker-ui-[a-z0-9-]+-long-packer$/.test(id)) {
    throw new Error('Only the dedicated visual hourly worker may be cleaned up.');
  }
  const user = await db.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [id]);
  if (user.rowCount === 0) return;
  // Include every actual User foreign key, including future relations. Refuse
  // cleanup once this read-only identity acquires history; never cascade it away.
  const references = await db.query<{ relation: string; column: string }>(`
    SELECT format('%I.%I', ns.nspname, rel.relname) AS relation,
           quote_ident(col.attname) AS column
    FROM pg_constraint fk
    JOIN pg_class rel ON rel.oid = fk.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN LATERAL unnest(fk.conkey, fk.confkey) keys(local_num, remote_num) ON TRUE
    JOIN pg_attribute col ON col.attrelid = fk.conrelid AND col.attnum = keys.local_num
    JOIN pg_attribute remote_col ON remote_col.attrelid = fk.confrelid AND remote_col.attnum = keys.remote_num
    WHERE fk.contype = 'f' AND fk.confrelid = '"User"'::regclass AND remote_col.attname = 'id'
  `);
  for (const reference of references.rows) {
    // Both identifiers are quoted by PostgreSQL from its own relation catalog.
    const linked = await db.query(
      `SELECT 1 FROM ${reference.relation} WHERE ${reference.column} = $1 LIMIT 1`, [id],
    );
    if (linked.rowCount !== 0) throw new Error(`Visual hourly worker has history in ${reference.relation}; retain it.`);
  }
  await db.query('DELETE FROM "User" WHERE id = $1', [id]);
}

// 停用且口令不是 bcrypt 哈希：不能登录，也不进建单的外部销售下拉；清理时保留（与打印
// 夹具的 e2e-vr-long-sales 同一做法）。id 只在首次插入时用：并发的门禁 project 以
// username 为唯一冲突目标，按行锁先后更新同一行，不会因主键撞车而失败。
async function upsertLongExternalSales(db: Client): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO "User" (id, username, "displayName", password, role, "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'fixture-no-login', 'SALES'::"Role", FALSE, NOW(), NOW())
     ON CONFLICT (username) DO UPDATE SET
       "displayName" = EXCLUDED."displayName", role = EXCLUDED.role, "isActive" = FALSE, "updatedAt" = NOW()
     RETURNING id`,
    [
      `e2e-${randomBytes(12).toString('hex')}`,
      WORKER_UI_LONG_SALES_USERNAME,
      WORKER_UI_LONG_SALES_NAME,
    ],
  );
  return result.rows[0]!.id;
}

export async function seedWorkerUiFixture(
  namespace = 'default',
  options: WorkerUiFixtureOptions = {},
): Promise<WorkerUiFixture> {
  const fixture = fixtureFor(namespace);
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      await deleteUnusedHourlyWorker(db, fixture.hourlyWorkerId);
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
           AND code = 'FLAT_FOIL_PARTIAL'
         ORDER BY "sortOrder", name
         LIMIT 1`,
      );
      if (!craft.rows[0]) throw new Error('Worker UI E2E requires the active partial-foil craft');
      fixture.craftId = craft.rows[0].id;
      fixture.craftName = craft.rows[0].name;
      const windmillCraft = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM "Craft"
         WHERE "isActive" = TRUE
           AND "isOutsource" = FALSE
           AND id <> $1
         ORDER BY "sortOrder", name
         LIMIT 1`,
        [craft.rows[0].id],
      );
      if (!windmillCraft.rows[0]) {
        throw new Error(
          'Worker UI E2E requires at least one active WINDMILL craft',
        );
      }

      await db.query(`DELETE FROM "DailyWorkerSalary" WHERE id = $1`, [fixture.salaryId]);
      await db.query(
        `DELETE FROM "ProductionOperationSource" WHERE "operationId" = ANY($1::text[])`,
        [[fixture.activeTaskId, fixture.completedTaskId]],
      );
      await db.query(
        `DELETE FROM "ProductionOperation" WHERE id = ANY($1::text[])`,
        [[fixture.activeTaskId, fixture.completedTaskId]],
      );
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
        `INSERT INTO "User" (id, username, password, role, "workerType", "displayName", "isActive", "createdAt", "updatedAt")
         SELECT $1::text, $1::text::citext, password, 'WORKER'::"Role", 'PACKER'::"WorkerType",
                '长姓名打包师傅ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证筛选不会撑开小屏', FALSE, NOW(), NOW()
         FROM "User" WHERE id = $2`,
        [fixture.hourlyWorkerId, adminId],
      );

      // 业主 2026-09-27：工单页以归属的外部销售取代「客户名称/简称」，夹具不再写 customerRef。
      const mainOrderSubmitterId = options.longExternalSales
        ? await upsertLongExternalSales(db)
        : salesId;
      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById", status,
           "pricingStatus", "pricingConfirmedAt",
           "isUrgent", "isSfCollect", "customName", "packageRequirement", remark, "promisedDate",
           "totalAmount", "submittedAt", "scheduledAt", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3, 'IN_PRODUCTION'::"OrderStatus",
           'LEGACY_CONFIRMED'::"OrderPricingStatus", TIMESTAMP '2026-07-19 08:00:00',
           TRUE, TRUE, $4, $5, $6, DATE '2099-12-31',
           646172.57, TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00',
           TIMESTAMP '2026-07-19 08:00:00', TIMESTAMP '2026-07-19 09:00:00'
         )`,
        [
          fixture.orderId,
          fixture.orderNo,
          mainOrderSubmitterId,
          '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          '包装要求：请将每一万个分组装箱并标注ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          '工单备注：这是用于响应式裁切回归的超长中文文本与UnbrokenToken0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        ],
      );

      await db.query(
        `INSERT INTO "Order" (
           id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
           status, "pricingStatus", "pricingConfirmedAt", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
           'SUBMITTED'::"OrderStatus", 'LEGACY_CONFIRMED'::"OrderPricingStatus",
           TIMESTAMP '2026-07-19 08:10:00',
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
           id, "orderId", sequence, name, "pricingRoute", "productStructure",
           specification, "paperType", quantity, crafts, "foilColors", "foilTechnique",
           "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '混合机型分步派工款式',
           'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
           'STANDARD_ENVELOPE'::"OrderProductStructure", '大号', '艳红珠光纸',
           2600, ARRAY[$3, $4]::text[], ARRAY['哑金', '红金']::text[],
           'FLAT'::"OrderFoilTechnique", FALSE, TRUE,
           '先手动烫金再走风车机', NOW(), NOW()
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
           id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
           status, "pricingStatus", "pricingConfirmedAt", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
           'SUBMITTED'::"OrderStatus", 'LEGACY_CONFIRMED'::"OrderPricingStatus",
           TIMESTAMP '2026-07-19 08:15:00',
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
           id, "orderId", sequence, name, "pricingRoute", "productStructure",
           specification, "paperType", quantity, crafts, "foilColors", "foilTechnique",
           "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '非推荐派工款式',
           'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
           'STANDARD_ENVELOPE'::"OrderProductStructure", '大号', '艳红珠光纸',
           1800, ARRAY[$3]::text[], ARRAY['哑金']::text[],
           'FLAT'::"OrderFoilTechnique", FALSE, FALSE,
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
           id, "orderId", sequence, name, "pricingRoute", "productStructure",
           specification, "paperType", quantity, "unitPrice", subtotal, crafts,
           "foilColors", "foilTechnique", "isDoubleSided", "isDoubleColor", remark,
           "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 1, $4, 'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
            'STANDARD_ENVELOPE'::"OrderProductStructure", $5, $6, 1234567,
            0.1234, 152345.57, ARRAY[$7]::text[],
            ARRAY['哑金', '红金', '潘通 871C']::text[], 'FLAT'::"OrderFoilTechnique",
            TRUE, TRUE, $8, NOW(), NOW()),
           ($2, $3, 2, $9, 'COLOR_PRINT'::"OrderItemPricingRoute",
            'STANDARD_ENVELOPE'::"OrderProductStructure", $5, $6, 987654,
            0.5000, 493827.00, ARRAY[$7]::text[],
            ARRAY['无颜色（纯彩印）']::text[], 'NONE'::"OrderFoilTechnique",
            FALSE, FALSE, $8, NOW(), NOW())`,
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
           id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
           status, "pricingStatus", "pricingConfirmedAt", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
           'SUBMITTED'::"OrderStatus", 'LEGACY_CONFIRMED'::"OrderPricingStatus",
           TIMESTAMP '2026-07-19 08:05:00',
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
           id, "orderId", sequence, name, "pricingRoute", "productStructure",
           specification, "paperType", quantity, crafts, "foilColors", "foilTechnique",
           "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, 1, '跨工单批量派工款式',
           'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
           'STANDARD_ENVELOPE'::"OrderProductStructure", '方形', '暗红珠光纸',
           3000, ARRAY[$3]::text[], ARRAY['浅金']::text[],
           'FLAT'::"OrderFoilTechnique", FALSE, FALSE,
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
           id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
           status, "pricingStatus", "pricingConfirmedAt", "customName", "submittedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
           'SUBMITTED'::"OrderStatus", 'LEGACY_CONFIRMED'::"OrderPricingStatus",
           TIMESTAMP '2026-07-19 08:00:00',
           '批量排产响应式与无障碍测试',
           TIMESTAMP '2026-07-19 08:00:00',
           TIMESTAMP '2026-07-19 08:00:00',
           TIMESTAMP '2026-07-19 08:00:00'
         )`,
        [fixture.schedulingOrderId, fixture.schedulingOrderNo, salesId],
      );
      await db.query(
        `INSERT INTO "OrderItem" (
           id, "orderId", sequence, name, "pricingRoute", "productStructure",
           specification, "paperType", quantity, crafts, "foilColors", "foilTechnique",
           "isDoubleSided", "isDoubleColor",
           remark, "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 1, '批量派工款式一',
            'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
            'STANDARD_ENVELOPE'::"OrderProductStructure", '大号', '艳红珠光纸',
            1000, ARRAY[$4]::text[], ARRAY['哑金']::text[],
            'FLAT'::"OrderFoilTechnique", FALSE, FALSE,
            '批量派工关键备注一', NOW(), NOW()),
           ($2, $3, 2, '批量派工款式二',
            'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
            'STANDARD_ENVELOPE'::"OrderProductStructure", '中号', '艳红珠光纸',
            2000, ARRAY[$4]::text[], ARRAY['红金']::text[],
            'FLAT'::"OrderFoilTechnique", FALSE, FALSE,
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
        `INSERT INTO "ProductionOperation" (
           id, "orderId", "operationType", unit, status, "plannedQty", "createdAt", "updatedAt"
         ) VALUES
           ($1, $3, 'PARTIAL'::"PieceworkOperationType", 'PER_PASS'::"PieceworkRateUnit",
            'IN_PROGRESS'::"ProductionOperationStatus", 1234567, NOW(), NOW()),
           ($2, $3, 'PARTIAL'::"PieceworkOperationType", 'PER_PASS'::"PieceworkRateUnit",
            'COMPLETED'::"ProductionOperationStatus", 987654, NOW(), NOW())`,
        [fixture.activeTaskId, fixture.completedTaskId, fixture.orderId],
      );
      await db.query(
        `INSERT INTO "ProductionOperationSource" (
           id, "operationId", "sourceType", "orderItemId", "sourceQty", "createdAt"
         ) VALUES
           ($1, $3, 'ORDER_ITEM'::"ProductionOperationSourceType", $5, 1234567, NOW()),
           ($2, $4, 'ORDER_ITEM'::"ProductionOperationSourceType", $6, 987654, NOW())`,
        [
          `${fixture.activeTaskId}-source`,
          `${fixture.completedTaskId}-source`,
          fixture.activeTaskId,
          fixture.completedTaskId,
          fixture.orderItemActiveId,
          fixture.orderItemCompletedId,
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
           id, "dailySalaryId", "idempotencyKey", type, amount, reason, "createdById", "createdAt"
         ) VALUES (
           $1, $2, $3, 'BONUS'::"SalaryAdjustmentType", 123.45,
           $4, $5, TIMESTAMP '2026-07-19 20:00:00'
         )`,
        [
          fixture.adjustmentId,
          fixture.salaryId,
          `visual-salary-adjustment:${fixture.adjustmentId}`,
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
      await deleteUnusedHourlyWorker(db, fixture.hourlyWorkerId);
      await db.query(`DELETE FROM "DailyWorkerSalary" WHERE id = $1`, [fixture.salaryId]);
      await db.query(
        `DELETE FROM "ProductionOperationSource" WHERE "operationId" = ANY($1::text[])`,
        [[fixture.activeTaskId, fixture.completedTaskId]],
      );
      await db.query(
        `DELETE FROM "ProductionOperation" WHERE id = ANY($1::text[])`,
        [[fixture.activeTaskId, fixture.completedTaskId]],
      );
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
