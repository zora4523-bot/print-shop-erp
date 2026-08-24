import { expect, type Page } from '@playwright/test';

// Re-export so specs don't have to import from global-setup directly.
import { E2E_USERS } from './global-setup';
export { E2E_PASSWORD, E2E_USERS } from './global-setup';

// ---- DB-side fixture helpers ----
//
// These do raw SQL inserts to skip multi-step UI choreography in
// scenarios that aren't about that choreography (e.g. the bill flow
// shouldn't have to drive a 6-step production sequence just to get
// a FINISHED order on the books). We use raw `pg` for the same reason
// global-setup does — Playwright's CJS runner can't load the generated
// Prisma client cleanly.

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { isolateE2eLoginClient } from './_login-client';

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function getUserIdByUsername(username: string): Promise<string> {
  return withDb(async (db) => {
    const r = await db.query<{ id: string }>(
      'SELECT id FROM "User" WHERE username = $1',
      [username],
    );
    if (r.rowCount === 0) throw new Error(`E2E user ${username} not found`);
    return r.rows[0]!.id;
  });
}

// Wipes ALL bill / billItem rows owned by the given E2E user plus only the
// no-item e2e-bill-* Order fixtures — bill-flow uses this to keep each run
// independent without touching production-flow salary ledgers.
//
// generateBillsForPeriod upserts per-(salesUser, period); leftover
// state from prior runs causes bleed (totalAmount keeps aggregating,
// status moves past DRAFT, next generate errors out). Cleaning only
// E2E-prefixed orders (round 79 attempt) doesn't actually fix this —
// if a real bill exists for the same (salesUser, period), it occupies
// the unique slot and the next generate either appends E2E items to a
// real DRAFT bill (mixing data) or fails because that bill is non-
// DRAFT (Codex round 80 / P1). Plus stripping items from a mixed bill
// without recomputing totalAmount / paidAmount leaves the real bill
// internally inconsistent (round 80 / P2).
//
// Resolution: this helper REQUIRES an E2E-test user (username starts
// with `e2e-`). Such users are owned by globalSetup.ts and never get
// real bills — wiping them entirely is safe. Real users will throw,
// so the helper can't accidentally damage production data.
export async function resetBillsForUser(userId: string): Promise<void> {
  await withDb(async (db) => {
    const r = await db.query<{ username: string }>(
      'SELECT username FROM "User" WHERE id = $1',
      [userId],
    );
    if (r.rowCount === 0) {
      throw new Error(`resetBillsForUser: user id ${userId} not found`);
    }
    const username = r.rows[0]!.username;
    if (!username.startsWith('e2e-')) {
      throw new Error(
        `resetBillsForUser refuses to wipe non-E2E user "${username}". ` +
          'Pass a user whose username starts with "e2e-" (E2E fixtures ' +
          'created by globalSetup.ts).',
      );
    }
    // Step 1: clear append-only payments and BillItems for this user's bills
    //   (both reference Bill and must go first).
    // Step 2: clear all Bills for this user (full wipe — e2e-* user
    //   is test-only; round 80 contract).
    // Step 3: clear the helper's exact no-item e2e-bill Order shape.
    await db.query(
      `DELETE FROM "BillPayment" WHERE "billId" IN (
         SELECT id FROM "Bill" WHERE "salesUserId" = $1
       )`,
      [userId],
    );
    await db.query(
      `DELETE FROM "BillItem" WHERE "billId" IN (
         SELECT id FROM "Bill" WHERE "salesUserId" = $1
       )`,
      [userId],
    );
    await db.query(`DELETE FROM "Bill" WHERE "salesUserId" = $1`, [userId]);
    // OrderCustomerCharge intentionally uses ON DELETE RESTRICT because it is
    // a commercial ledger. Test teardown must therefore remove charges before
    // the fixture orders. Match seedFinishedOrder's exact bill-test shape:
    // E2E order number + bill-fixture customerRef + no items. The
    // e2e-cs-bill prefix is retained only to remove fixtures written by older
    // cs-accumulate runs; new callers use e2e-bill-*. Production-flow orders
    // use the same submitter and can have immutable salary ledgers, so a broad
    // FINISHED-order wipe is neither safe nor repeatable.
    await db.query(
      `DELETE FROM "OrderCustomerCharge" charge
        USING "Order" target
       WHERE charge."orderId" = target.id
         AND target."submitterId" = $1
         AND target.status = 'FINISHED'
         AND target."orderNo" LIKE 'E2E-%'
         AND (
           target."customerRef" LIKE 'e2e-bill-%'
           OR target."customerRef" LIKE 'e2e-cs-bill-%'
         )
         AND NOT EXISTS (
           SELECT 1 FROM "OrderItem" item WHERE item."orderId" = target.id
         )`,
      [userId],
    );
    await db.query(
      `DELETE FROM "Order" target
        WHERE target."submitterId" = $1
          AND target.status = 'FINISHED'
          AND target."orderNo" LIKE 'E2E-%'
          AND (
            target."customerRef" LIKE 'e2e-bill-%'
            OR target."customerRef" LIKE 'e2e-cs-bill-%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "OrderItem" item WHERE item."orderId" = target.id
          )`,
      [userId],
    );
  });
}

// Seeds one Order with status=FINISHED, no items. Bills E2E uses this
// to skip the whole submit→schedule→report→cascade chain (that's
// wave 2's job). Returns the new order's id + orderNo.
//
// `finishedAt` is REQUIRED and must be passed by the caller. The
// earlier version used PG's NOW(), which depends on the PG session
// timezone; on UTC-configured Postgres (CI / containers) a Shanghai
// "today" near month boundaries seeds the order into the wrong
// month from the perspective of generateBillsForPeriod's JS-side
// month math, and the bill never generates (Codex round 79 / P2).
// Caller computes the timestamp deterministically from JS Date.
export async function seedFinishedOrder(opts: {
  submitterId: string;
  submitterRole: 'SALES' | 'CUSTOMER_SERVICE';
  customerRef: string;
  totalAmount: string; // decimal string, e.g. "5000.00"
  finishedAt: Date;
}): Promise<{ orderId: string; orderNo: string }> {
  const orderId = `e2e-ord-${randomBytes(8).toString('hex')}`;
  // orderNo is UNIQUE — we don't follow the YYYYMMDD-NNNN convention
  // because that would race with real production code's nextOrderNumber.
  // Prefix lets us spot test rows in the dev DB.
  const orderNo = `E2E-${randomBytes(4).toString('hex').toUpperCase()}`;
  await withDb(async (db) => {
    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "customerRef", "totalAmount",
        "submittedAt", "scheduledAt", "completedAt", "shippedAt", "finishedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4::"Role",
        CASE $4::"Role"
          WHEN 'SALES'::"Role" THEN 'EXTERNAL_SALES'::"OrderSettlementType"
          WHEN 'CUSTOMER_SERVICE'::"Role" THEN 'INTERNAL_SALES'::"OrderSettlementType"
          WHEN 'ADMIN'::"Role" THEN 'FACTORY_DIRECT'::"OrderSettlementType"
        END,
        $3,
        'FINISHED'::"OrderStatus", FALSE, $5, $6,
        $7, $7, $7, $7, $7,
        NOW(), NOW()
      )
      `,
      [
        orderId,
        orderNo,
        opts.submitterId,
        opts.submitterRole,
        opts.customerRef,
        opts.totalAmount,
        opts.finishedAt.toISOString(),
      ],
    );
  });
  return { orderId, orderNo };
}

// Seeds an Order + one OrderItem + N OrderItemDesigns for visual
// regression tests of OrderPrintLayout. Deterministic across runs:
// - Fixed orderId per design count (delete-then-insert idempotency)
// - Stable customerRef / receiverName / item fields → render is
//   pixel-identical regardless of clock or other state.
// - Designs use a tiny inline data: PNG so no network fetch is needed
//   and the image bytes are hashable. Without this the print page
//   would 404 / hang on the placeholder fileUrl.
//
// Caller is responsible for providing submitterId (admin user works).
// Returns the deterministic orderId so the spec can navigate to
// /print/orders/<id> directly.
//
// 1×1 transparent PNG, base64. Renders as a tiny dot inside whatever
// CSS sizing the design-grid imposes. Plenty for visual baseline.
const PLACEHOLDER_PNG_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function seedPrintableOrder(opts: {
  submitterId: string;
  designCount: number;
  variant?: 'default' | 'rich-context' | 'three-items';
}): Promise<{
  orderId: string;
  orderNo: string;
  orderItemId: string;
  customName: string | null;
  itemRemark: string | null;
  foilColors: string[];
}> {
  const variant = opts.variant ?? 'default';
  const richContext =
    variant === 'rich-context' || variant === 'three-items';
  const itemCount = variant === 'three-items' ? 3 : 1;
  const customName = richContext
    ? '视觉回归自定义工单名称：春节红包VIP客户加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789第二版终稿'
    : null;
  const itemRemark = richContext
    ? '关键备注：正面品牌标志必须使用红金，背面祝福语使用哑金，潘通 871C 仅用于边框；严格按最终设计稿方向生产，不可镜像、不可漏烫。LONG-CRITICAL-NOTE-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789'
    : null;
  const foilColors = richContext
    ? ['哑金', '红金', '潘通 871C']
    : ['金色'];

  // Deterministic per (variant, designCount). Existing default IDs stay
  // unchanged so the original six bucket baselines do not churn. The
  // same ID across runs also keeps the QR SVG and screenshot bytes stable.
  // CASCADE FKs on Order → OrderItem and OrderItem → OrderItemDesign
  // clean up children automatically.
  const idStem =
    variant === 'three-items'
      ? `e2e-vr-three-items-${opts.designCount}`
      : richContext
        ? `e2e-vr-rich-${opts.designCount}`
        : `e2e-vr-${opts.designCount}`;
  const orderId = idStem;
  const orderNo =
    variant === 'three-items'
      ? `E2E-VR-THREE-${opts.designCount}`
      : richContext
        ? `E2E-VR-RICH-${opts.designCount}`
        : `E2E-VR-${opts.designCount}`;
  const orderItemId = `${orderId}-item`;

  await withDb(async (db) => {
    await db.query(`DELETE FROM "Order" WHERE id = $1`, [orderId]);

    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "customerRef", "customName", "receiverName",
        "receiverPhone", "receiverAddress", "isSfCollect",
        "totalAmount", "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'ADMIN'::"Role", 'FACTORY_DIRECT'::"OrderSettlementType", $3,
        'DRAFT'::"OrderStatus", FALSE,
        'VR-CUSTOMER',
        $4,
        'VR 收件人',
        '13800138000',
        $5,
        $6,
        0,
        TIMESTAMP '2026-01-01 00:00:00',
        TIMESTAMP '2026-01-01 00:00:00',
        TIMESTAMP '2026-01-01 00:00:00'
      )
      `,
      [
        orderId,
        orderNo,
        opts.submitterId,
        customName,
        variant === 'three-items' ? '佛山市测试主地址 88 号' : null,
        variant === 'three-items',
      ],
    );

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
      const currentOrderItemId =
        itemCount === 1 ? orderItemId : `${orderItemId}-${itemIndex + 1}`;
      await db.query(
        `
        INSERT INTO "OrderItem" (
          id, "orderId", sequence, name, specification, "paperType",
          quantity, "foilColors", "isDoubleSided", "isDoubleColor",
          crafts, remark, "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, '9cm × 17cm', $8,
          $5, $6::text[], TRUE, $9,
          ARRAY[]::text[], $7, NOW(), NOW()
        )
        `,
        [
          currentOrderItemId,
          orderId,
          itemIndex + 1,
          itemCount === 1 ? 'VR 款式' : `VR 款式 ${itemIndex + 1}`,
          5000 + itemIndex * 1000,
          foilColors,
          itemRemark,
          itemCount === 3 ? '艳红珠光纸' : '珠光纸',
          itemCount === 3,
        ],
      );

      for (let designIndex = 0; designIndex < opts.designCount; designIndex++) {
        await db.query(
          `
          INSERT INTO "OrderItemDesign" (
            id, "orderItemId", "fileType", "fileUrl", "fileName",
            "fileSize", "thumbnailUrl", "uploadedBy", "uploadedAt"
          ) VALUES (
            $1, $2, 'IMAGE'::"DesignFileType", $3, $4,
            1024, $3, $5,
            TIMESTAMP '2026-01-01 00:00:00'
          )
          `,
          [
            `${currentOrderItemId}-design-${designIndex}`,
            currentOrderItemId,
            PLACEHOLDER_PNG_DATA_URL,
            itemCount === 1
              ? `design-${designIndex + 1}.png`
              : `design-${itemIndex + 1}-${designIndex + 1}.png`,
            opts.submitterId,
          ],
        );
      }
    }

    if (variant === 'three-items') {
      const primaryShipmentId = `${orderId}-shipment-1`;
      const secondaryShipmentId = `${orderId}-shipment-2`;
      await db.query(
        `
        INSERT INTO "OrderShipment" (
          id, "orderId", sequence, "receiverName", "receiverPhone",
          "receiverAddress", "expressCode", status, "createdAt", "updatedAt"
        ) VALUES
          ($1, $3, 1, 'VR 主地址收件人', '13800138000',
           '佛山市测试主地址 88 号', 'SF', 'PLANNED'::"ShipmentStatus", NOW(), NOW()),
          ($2, $3, 2, 'VR 分地址收件人', '13900139000',
           '广州市测试分地址 99 号', 'SF', 'PLANNED'::"ShipmentStatus", NOW(), NOW())
        `,
        [primaryShipmentId, secondaryShipmentId, orderId],
      );
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        const currentOrderItemId = `${orderItemId}-${itemIndex + 1}`;
        const totalQuantity = 5000 + itemIndex * 1000;
        await db.query(
          `
          INSERT INTO "OrderShipmentLine" (
            id, "shipmentId", "orderItemId", quantity
          ) VALUES
            ($1, $3, $5, $6),
            ($2, $4, $5, 100)
          `,
          [
            `${orderId}-shipment-line-primary-${itemIndex + 1}`,
            `${orderId}-shipment-line-secondary-${itemIndex + 1}`,
            primaryShipmentId,
            secondaryShipmentId,
            currentOrderItemId,
            totalQuantity - 100,
          ],
        );
      }
    }
  });

  return {
    orderId,
    orderNo,
    orderItemId,
    customName,
    itemRemark,
    foilColors,
  };
}

// Wipes ALL SalaryPeriods + CommissionRecords for an e2e-* user.
// Required for CS-accumulate E2E so each run starts with a known-
// empty period (totalSales=0). Same e2e-* guard as resetBillsForUser
// so this can never wipe a real CS user's salary state.
//
// The append-only sales/payroll ledgers and CustomerServiceCommission all
// reference SalaryPeriod, so dependent facts must be removed first.
export async function resetCsSalaryStateForUser(userId: string): Promise<void> {
  await withDb(async (db) => {
    const r = await db.query<{ username: string }>(
      'SELECT username FROM "User" WHERE id = $1',
      [userId],
    );
    if (r.rowCount === 0) {
      throw new Error(`resetCsSalaryStateForUser: user id ${userId} not found`);
    }
    const username = r.rows[0]!.username;
    if (!username.startsWith('e2e-')) {
      throw new Error(
        `resetCsSalaryStateForUser refuses to wipe non-E2E user "${username}".`,
      );
    }
    await db.query(
      `DELETE FROM "CsPayrollPayment" WHERE "salaryPeriodId" IN (
         SELECT id FROM "SalaryPeriod" WHERE "csUserId" = $1
       )`,
      [userId],
    );
    await db.query(`DELETE FROM "CsSalesEntry" WHERE "csUserId" = $1`, [
      userId,
    ]);
    await db.query(
      `DELETE FROM "CustomerServiceCommission" WHERE "csUserId" = $1`,
      [userId],
    );
    await db.query(`DELETE FROM "SalaryPeriod" WHERE "csUserId" = $1`, [userId]);
  });
}

// Seeds an IN_PROGRESS SalaryPeriod that brackets `now`. The CS
// accumulate path looks for a period where periodStart ≤ at AND
// periodEnd ≥ at AND status = IN_PROGRESS — these dates give us a
// generous window so test wall-clock drift can't push us out of it.
export async function seedActiveCsPeriod(opts: {
  csUserId: string;
  monthlyBase: string; // decimal string, e.g. "5000.00"
}): Promise<{ periodId: string }> {
  const periodId = `e2e-csp-${randomBytes(8).toString('hex')}`;
  const now = new Date();
  // [1 month ago, 3 months from now] in UTC; @db.Date strips time so
  // the day-level grain is enough.
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
  await withDb(async (db) => {
    await db.query(
      `
      INSERT INTO "SalaryPeriod" (
        id, "csUserId", "periodStart", "periodEnd",
        "durationMonths", "totalSales", "initialSales", "monthlyBase",
        status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 4, 0, 0, $5, 'IN_PROGRESS'::"SalaryPeriodStatus",
        NOW(), NOW()
      )
      `,
      [
        periodId,
        opts.csUserId,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        opts.monthlyBase,
      ],
    );
  });
  return { periodId };
}

// Reads SalaryPeriod.totalSales for the user's currently active
// (IN_PROGRESS) period. Returns null if the user has no active
// period — caller decides what that means.
export async function readActiveCsTotalSales(
  csUserId: string,
): Promise<{ periodId: string; totalSales: string } | null> {
  return withDb(async (db) => {
    const r = await db.query<{ id: string; totalSales: string }>(
      `SELECT id, "totalSales"::text AS "totalSales" FROM "SalaryPeriod"
        WHERE "csUserId" = $1 AND status = 'IN_PROGRESS'`,
      [csUserId],
    );
    if (r.rowCount === 0) return null;
    return { periodId: r.rows[0]!.id, totalSales: r.rows[0]!.totalSales };
  });
}

// ---- Owner notifications E2E (P1 #2 Slice B) ----
//
// 删掉所有 channelKey 以 'e2e_' 开头的 NotificationChannel + 对应 log，
// 把 ORDER_SUBMITTED / URGENT_ORDER 这两条 rule 重置成"未启用 / 空
// channelIds"——E2E 会现场绑定。
//
// 范围注：只清 e2e_-prefix 的 channel 和这 2 条 rule 的状态；其他 8
// 条 rule + 真实 channel（如果 owner 已经手测建过）不动。
export async function resetNotificationFixture(): Promise<void> {
  await withDb(async (db) => {
    // Step 1: nuke all logs that point at e2e_-prefix channels（FK 拒
    // 删 channel 否则）。包括 __TEST__ event log。
    await db.query(
      `DELETE FROM "NotificationLog" WHERE "channelId" IN (
         SELECT id FROM "NotificationChannel" WHERE "channelKey" LIKE 'e2e_%'
       )`,
    );
    // Step 2: nuke channels
    await db.query(
      `DELETE FROM "NotificationChannel" WHERE "channelKey" LIKE 'e2e_%'`,
    );
    // Step 3: reset 测试涉及的 rule（spec 会现场绑、改 isActive）
    await db.query(
      `UPDATE "NotificationRule"
         SET "channelIds" = ARRAY[]::text[], "isActive" = false
       WHERE "eventType" IN ('ORDER_SUBMITTED', 'URGENT_ORDER')`,
    );
  });
}

// ---- Owner dashboard E2E (P1 #1 Slice A + B) ----
//
// Seeds a deterministic snapshot for /owner. Slice A KPI cards +
// Slice B watchlist tables share one fixture so the page renders all
// 4 cards + 3 lists from a single seed call:
//
//   Slice A (KPI cards):
//     - 3 orders submitted today (1 urgent) → 今日提交 / 急单 cards
//     - 2 orders completed today            → 今日完工 card + 待发货
//     - 1 order shipped today               → 今日发货 card
//     - 1 Bill (current Shanghai month, PARTIAL_PAID)
//                                           → 本月应收 card
//
//   Slice B (watchlist tables):
//     - 2 COMPLETED orders above            → 待发货工单 list
//     - 1 OutsourceOrder w/ expectedDate=今日 - 3d, status=IN_PROGRESS
//                                           → 超期外协 list
//     - 1 SalaryPeriod (e2e-cs) periodEnd=今日 + 3d, IN_PROGRESS
//                                           → 即将结算客服周期 list
//
// Cleanup follows fixture ownership, not user ownership: all non-bill rows use
// deterministic e2e-dash-* ids. Bills are unique per (sales user, period), so
// those are reset by the dedicated e2e-* sales account after an explicit guard.
// This keeps reruns deterministic without deleting another spec's production
// or payroll history.
export type DashboardSnapshot = {
  submittedOrderIds: string[];
  urgentOrderId: string;
  completedOrderIds: string[];
  shippedOrderId: string;
  billId: string;
  monthlyTotal: string; // 5000.00
  monthlyPaid: string; // 2000.00
  // Slice B fixtures
  outsourceId: string;
  outsourceDaysOverdue: number; // 3
  csPeriodId: string;
  csPeriodDaysUntilEnd: number; // 3
  // Slice C chart fixtures (only present when chartFixture=true)
  chartProductIds: string[];
  trendCompletedOrderIds: string[];
  rankingOrderIds: string[];
};

export async function seedDashboardSnapshot(opts: {
  // 业绩归属：bill 的销售人。e2e-sales 是 globalSetup 建好的固定 SALES 用户。
  salesUserId: string;
  // CS 周期归属：e2e-cs 是 globalSetup 的 CUSTOMER_SERVICE 用户。
  // 没传时 Slice B 的 ending-period fixture 不 seed（只渲染空 list）。
  csUserId?: string;
  // Slice C 图表 fixture：seed 30 天产量曲线 + 销售排行 + 产品分布。
  // 默认 false（Slice A/B E2E 不需要图表数据，节省运行时）。
  // 视觉回归 spec / preview 走 true。
  chartFixture?: boolean;
  // Slice C 排行 fixture 还要一个额外的销售用户（不同于 salesUserId）
  // 来体现"3 个不同 submitter / 3 种不同业绩高度"。e2e-cs (CS) 提供
  // 第二种角色色（绿）；admin (ADMIN) 提供第三种（muted）。foreman 是
  // ADMIN 角色，用其 id 喂入则角色色用 muted 同色板。
  ownerUserId?: string;
}): Promise<DashboardSnapshot> {
  const now = new Date();
  // Shanghai 中午 12:00 = UTC 04:00 —— 离日界 (UTC 16:00 / Shanghai
  // 00:00) 远，运行时刻在月初/月末附近也不会落到隔壁日 / 隔壁月。
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [yyyy, mm, dd] = ymd.split('-').map(Number);
  const todayShanghaiNoonUtc = new Date(
    Date.UTC(yyyy!, mm! - 1, dd!, 4, 0, 0),
  );
  const period = `${yyyy}-${String(mm).padStart(2, '0')}`;

  // Slice B stores both expectedDate and SalaryPeriod.periodEnd as calendar
  // dates represented by UTC midnight. Seed relative to Shanghai's YYYY-MM-DD,
  // not relative to an instant, so the result is stable around UTC/Shanghai
  // day boundaries.
  const dayMs = 24 * 60 * 60 * 1000;
  // Outsource expectedDate is written through parseStrictYmd as the calendar
  // day's UTC midnight. Seeding from Shanghai's 16:00Z boundary would serialize
  // to the previous UTC date and display one extra overdue day.
  const overdueExpectedDate = new Date(
    Date.UTC(yyyy!, mm! - 1, dd! - 3, 0, 0, 0),
  );
  // For SalaryPeriod (@db.Date), PG reads back UTC 00:00 of the stored
  // date. We pass `'YYYY-MM-DD'` strings; date-add via JS Date.UTC.
  const csPeriodEndUtcMidnight = new Date(Date.UTC(yyyy!, mm! - 1, dd! + 3));

  return withDb(async (db) => {
    const salesOwner = await db.query<{ username: string }>(
      `SELECT username FROM "User" WHERE id = $1`,
      [opts.salesUserId],
    );
    if (
      salesOwner.rowCount === 0 ||
      !salesOwner.rows[0]!.username.startsWith('e2e-')
    ) {
      throw new Error(
        'seedDashboardSnapshot refuses to reset bills for a non-E2E sales user',
      );
    }

    // Step 1: wipe only this helper's e2e-dash-* fixtures.
    // Bills are the one exception to the id-prefix rule: production enforces
    // one bill per (sales user, period), and bill-flow creates its id inside
    // the server action. The e2e-* account guard above makes a full bill reset
    // safe while avoiding a unique-key collision between independent specs.
    // Delete BillPayment/BillItem → Bill, then prefixed Orders, then Slice
    // B aux state. OutsourceOrder.orderId → ON DELETE SET NULL so a
    // wide Order delete leaves orphaned OutsourceOrder rows pointing
    // at no order — those would still surface in 超期外协 list. Wipe
    // them by id-prefix instead.
    await db.query(
      `DELETE FROM "BillPayment" WHERE "billId" IN (
         SELECT b.id FROM "Bill" b WHERE b."salesUserId" = $1
       )`,
      [opts.salesUserId],
    );
    await db.query(
      `DELETE FROM "BillItem" WHERE "billId" IN (
         SELECT b.id FROM "Bill" b WHERE b."salesUserId" = $1
       )`,
      [opts.salesUserId],
    );
    await db.query(
      `DELETE FROM "Bill" WHERE "salesUserId" = $1`,
      [opts.salesUserId],
    );
    // Delete every E2E outsource ledger before its linked order. Immutable
    // snapshots reference OrderItem with ON DELETE RESTRICT, while deleting
    // the outsource order itself cascades to those snapshots. Amount/payment
    // ledgers are restrictive children, so they must go first. The dashboard
    // id prefix is the fixture ownership boundary; other specs' e2e ledgers
    // remain intact.
    await db.query(
      `DELETE FROM "OutsourcePayment"
        WHERE "outsourceOrderId" IN (
          SELECT id FROM "OutsourceOrder" WHERE id LIKE 'e2e-dash-os-%'
        )`,
    );
    await db.query(
      `DELETE FROM "OutsourceAmountChange"
        WHERE "outsourceOrderId" IN (
          SELECT id FROM "OutsourceOrder" WHERE id LIKE 'e2e-dash-os-%'
        )`,
    );
    await db.query(
      `DELETE FROM "OutsourceOrder" WHERE id LIKE 'e2e-dash-os-%'`,
    );
    // Commercial charges restrict both their Order and optional Shipment.
    // Delete only charges belonging to the exact dashboard order population.
    await db.query(
      `DELETE FROM "OrderCustomerCharge" charge
        USING "Order" target
       WHERE charge."orderId" = target.id
         AND target.id LIKE 'e2e-dash-%'`,
    );
    // Slice C ranking may be owned by a non-e2e admin, so submitter identity
    // is not an ownership boundary. The deterministic prefix is.
    await db.query(`DELETE FROM "Order" WHERE id LIKE 'e2e-dash-%'`);
    // Slice C: nuke prior chart-fixture products (used to back
    // OrderItem.productId for category distribution). Same id-prefix
    // contract as outsource so other specs' products stay intact.
    if (opts.chartFixture) {
      await db.query(
        `DELETE FROM "Product" WHERE id LIKE 'e2e-dash-prod-%'`,
      );
    }
    // Slice B: remove only the prior dashboard CS period. The shared e2e-cs
    // account also owns fixtures for cs-accumulate.spec; deleting by user
    // would corrupt that independent ledger.
    if (opts.csUserId) {
      await db.query(
        `DELETE FROM "CsPayrollPayment" WHERE "salaryPeriodId" IN (
           SELECT id FROM "SalaryPeriod"
            WHERE "csUserId" = $1 AND id LIKE 'e2e-dash-csp-%'
         )`,
        [opts.csUserId],
      );
      await db.query(
        `DELETE FROM "CsSalesEntry" WHERE "salaryPeriodId" IN (
           SELECT id FROM "SalaryPeriod"
            WHERE "csUserId" = $1 AND id LIKE 'e2e-dash-csp-%'
         )`,
        [opts.csUserId],
      );
      await db.query(
        `DELETE FROM "CustomerServiceCommission" WHERE "salaryPeriodId" IN (
           SELECT id FROM "SalaryPeriod"
            WHERE "csUserId" = $1 AND id LIKE 'e2e-dash-csp-%'
         )`,
        [opts.csUserId],
      );
      await db.query(
        `DELETE FROM "SalaryPeriod"
          WHERE "csUserId" = $1 AND id LIKE 'e2e-dash-csp-%'`,
        [opts.csUserId],
      );
    }

    // Step 2: seed orders. ids are deterministic per-shape so a re-run
    // of the dashboard spec without a wipe in between would idempotent-
    // upsert (we don't bother — the wipe above is the contract).
    const submittedOrderIds: string[] = [];
    const submittedSpecs = [
      { suffix: 'sub-1', urgent: false },
      { suffix: 'sub-2', urgent: false },
      { suffix: 'sub-3-urgent', urgent: true },
    ];
    for (const spec of submittedSpecs) {
      const orderId = `e2e-dash-${spec.suffix}`;
      const orderNo = `E2E-DASH-${spec.suffix.toUpperCase()}`;
      await db.query(
        `
        INSERT INTO "Order" (
          id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
          status, "isUrgent", "totalAmount",
          "submittedAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
          'SUBMITTED'::"OrderStatus", $4, 0,
          $5, $5, $5
        )
        `,
        [
          orderId,
          orderNo,
          opts.salesUserId,
          spec.urgent,
          todayShanghaiNoonUtc.toISOString(),
        ],
      );
      submittedOrderIds.push(orderId);
    }

    const completedOrderIds: string[] = [];
    for (const i of [1, 2]) {
      const orderId = `e2e-dash-completed-${i}`;
      const orderNo = `E2E-DASH-COMPLETED-${i}`;
      await db.query(
        `
        INSERT INTO "Order" (
          id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
          status, "isUrgent", "totalAmount",
          "submittedAt", "scheduledAt", "completedAt",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
          'COMPLETED'::"OrderStatus", FALSE, 0,
          $4, $4, $4,
          $4, $4
        )
        `,
        [
          orderId,
          orderNo,
          opts.salesUserId,
          todayShanghaiNoonUtc.toISOString(),
        ],
      );
      completedOrderIds.push(orderId);
    }

    const shippedOrderId = 'e2e-dash-shipped-1';
    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "totalAmount",
        "submittedAt", "scheduledAt", "completedAt", "shippedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, 'E2E-DASH-SHIPPED-1', $2, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $2,
        'SHIPPED'::"OrderStatus", FALSE, 0,
        $3, $3, $3, $3,
        $3, $3
      )
      `,
      [shippedOrderId, opts.salesUserId, todayShanghaiNoonUtc.toISOString()],
    );

    // Step 3: seed one bill in the current Shanghai month.
    // 5000 总额 / 2000 已收 → outstanding 3000；UI 显示三个数字时都好认。
    // 状态 PARTIAL_PAID（已发 + 部分付款），issuedAt 必填——dashboard
    // getMonthlyBillStats 排除 DRAFT（Codex round 98 P1）。DRAFT 状态
    // 不会进 KPI；只有 ISSUED / PARTIAL_PAID / FULLY_PAID 算&ldquo;应收&rdquo;。
    const billId = `e2e-dash-bill-${randomBytes(4).toString('hex')}`;
    const monthlyTotal = '5000.00';
    const monthlyPaid = '2000.00';
    await db.query(
      `
      INSERT INTO "Bill" (
        id, "salesUserId", period, "totalAmount", "paidAmount",
        status, "issuedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'PARTIAL_PAID'::"BillStatus", NOW(), NOW(), NOW()
      )
      `,
      [billId, opts.salesUserId, period, monthlyTotal, monthlyPaid],
    );
    // A material/issued bill must have a provenance row.  Besides matching
    // the production ledger, this lets settlement migrations prove that the
    // receivable belongs to an external-sales order without guessing from the
    // account's current role.
    await db.query(
      `
      INSERT INTO "BillItem" (
        id, "billId", "orderId", "orderAmount", "createdAt"
      ) VALUES ($1, $2, $3, $4, NOW())
      `,
      [`${billId}-item`, billId, completedOrderIds[0], monthlyTotal],
    );

    // Step 4 (Slice B): seed one overdue outsource order linked to the
    // first completed order, so 超期外协 list has one row with a real
    // orderNo (more useful UI signal than orphaned).
    const outsourceId = 'e2e-dash-os-1';
    const linkedOrderId = completedOrderIds[0]!;
    const linkedOrderItemId = `${linkedOrderId}-outsource-item`;
    const outsourceQuantity = 100;
    await db.query(
      `
      INSERT INTO "OrderItem" (
        id, "orderId", sequence, name, quantity, crafts,
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 1, 'E2E 外协款式', $3, ARRAY[]::text[], NOW(), NOW()
      )
      `,
      [linkedOrderItemId, linkedOrderId, outsourceQuantity],
    );
    await db.query(
      `
      INSERT INTO "OutsourceOrder" (
        id, "idempotencyKey", "orderId", "orderItemIds", "supplierName",
        "totalQty", "expectedDate", status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $1 || ':fixture', $2, ARRAY[$3]::text[], 'E2E 阿福外协',
        $4, $5, 'IN_PROGRESS'::"OutsourceStatus", NOW(), NOW()
      )
      `,
      [
        outsourceId,
        linkedOrderId,
        linkedOrderItemId,
        outsourceQuantity,
        overdueExpectedDate.toISOString(),
      ],
    );
    await db.query(
      `
      INSERT INTO "OutsourceOrderItemSnapshot" (
        id, "outsourceOrderId", "orderItemId", quantity
      ) VALUES ($1, $2, $3, $4)
      `,
      [
        'e2e-dash-osis-1',
        outsourceId,
        linkedOrderItemId,
        outsourceQuantity,
      ],
    );

    // Step 5 (Slice B): seed one IN_PROGRESS salary period that ends in
    // ~3 days (only when caller provides csUserId). totalSales=300000
    // hits the highest tier in the seeded CS_TIERS rule (commission
    // visible in UI as a non-"—" non-"未达档位" value).
    let csPeriodId = '';
    const csPeriodDaysUntilEnd = 3;
    if (opts.csUserId) {
      csPeriodId = `e2e-dash-csp-${randomBytes(4).toString('hex')}`;
      await db.query(
        `
        WITH target AS (
          SELECT $3::date AS period_end
        ), candidate AS (
          SELECT
            (
              target.period_end + interval '1 day'
              - make_interval(months => months.value)
            )::date AS period_start,
            months.value AS duration_months
          FROM target
          CROSS JOIN generate_series(1, 24) AS months(value)
          WHERE (
            (
              target.period_end + interval '1 day'
              - make_interval(months => months.value)
            )::date
            + make_interval(months => months.value)
            - interval '1 day'
          )::date = target.period_end
          ORDER BY ABS(months.value - 4), months.value
          LIMIT 1
        )
        INSERT INTO "SalaryPeriod" (
          id, "csUserId", "periodStart", "periodEnd",
          "durationMonths", "totalSales", "initialSales", "monthlyBase",
          status, "createdAt", "updatedAt"
        )
        SELECT
          $1, $2, candidate.period_start, target.period_end,
          candidate.duration_months, 300000, 0, 5000,
          'IN_PROGRESS'::"SalaryPeriodStatus", NOW(), NOW()
        FROM target
        CROSS JOIN candidate
        `,
        [
          csPeriodId,
          opts.csUserId,
          csPeriodEndUtcMidnight.toISOString().slice(0, 10),
        ],
      );
    }

    // Step 6 (Slice C): chart-shape fixture. Adds:
    //   - 6 Products spanning 3 ProductCategory values + 1 OrderItem
    //     left without productId (UNCATEGORIZED bucket).
    //   - 30-day production trend: 7 randomized non-zero days
    //     (deterministic per-day count → stable visual baseline).
    //   - Sales ranking: 3 different submitters with ¥5k / ¥3k / ¥1.5k
    //     totals across the current month.
    //   - Category distribution: each ranking order seeds 1 OrderItem
    //     pointing at one of the seeded products + 1 with null
    //     productId (UNCATEGORIZED).
    //
    // ids all live under e2e-dash-* prefix so the next run's wipe
    // (above) re-bases cleanly.
    const chartProductIds: string[] = [];
    const trendCompletedOrderIds: string[] = [];
    const rankingOrderIds: string[] = [];

    if (opts.chartFixture) {
      // Pick 7 of last 30 days w/ a fixed-pattern count (1, 3, 2, 4,
      // 1, 5, 2). Days are 28, 22, 18, 12, 7, 3, 1 days back from today.
      // The peak (5) lands at day-3 so the chart's interesting bit
      // shows up near the right edge — readable as "recent activity".
      const trendPattern: Array<{ daysBack: number; count: number }> = [
        { daysBack: 28, count: 1 },
        { daysBack: 22, count: 3 },
        { daysBack: 18, count: 2 },
        { daysBack: 12, count: 4 },
        { daysBack: 7, count: 1 },
        { daysBack: 3, count: 5 },
        { daysBack: 1, count: 2 },
      ];
      for (const { daysBack, count } of trendPattern) {
        const completedAt = new Date(
          Date.UTC(yyyy!, mm! - 1, dd! - daysBack, 4, 0),
        );
        for (let i = 0; i < count; i++) {
          const orderId = `e2e-dash-trend-${daysBack}-${i}`;
          const orderNo = `E2E-TREND-${daysBack}-${i}`;
          await db.query(
            `
            INSERT INTO "Order" (
              id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
              status, "isUrgent", "totalAmount",
              "submittedAt", "scheduledAt", "completedAt",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
              'COMPLETED'::"OrderStatus", FALSE, 0,
              $4, $4, $4,
              $4, $4
            )
            `,
            [orderId, orderNo, opts.salesUserId, completedAt.toISOString()],
          );
          trendCompletedOrderIds.push(orderId);
        }
      }

      // 6 Products spanning 3 categories so the pie chart shows 3 +
      // UNCATEGORIZED slices (4 distinct colors). 2 per category.
      const productSpecs: Array<{
        idSuffix: string;
        category: string;
        name: string;
      }> = [
        { idSuffix: 'p-blank-1', category: 'BLANK_STOCK', name: '空白现货 9cm' },
        { idSuffix: 'p-blank-2', category: 'BLANK_STOCK', name: '空白现货 12cm' },
        {
          idSuffix: 'p-foil-1',
          category: 'CUSTOM_FLAT_FOIL',
          name: '专版烫金 苹果福',
        },
        {
          idSuffix: 'p-foil-2',
          category: 'CUSTOM_FLAT_FOIL',
          name: '专版烫金 LV福',
        },
        {
          idSuffix: 'p-color-1',
          category: 'COLOR_PRINT',
          name: '彩印 麒麟纹',
        },
        {
          idSuffix: 'p-color-2',
          category: 'COLOR_PRINT',
          name: '彩印 锦鲤纹',
        },
      ];
      for (const spec of productSpecs) {
        const id = `e2e-dash-prod-${spec.idSuffix}`;
        chartProductIds.push(id);
        await db.query(
          `
          INSERT INTO "Product" (
            id, category, name, "isActive", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2::"ProductCategory", $3, TRUE, NOW(), NOW()
          )
          `,
          [id, spec.category, spec.name],
        );
      }

      // Sales ranking: 3 submitters × different total amounts.
      //   - salesUserId (SALES, blue):       ¥5,000
      //   - csUserId (CS, green):            ¥3,000   (only when provided)
      //   - ownerUserId (ADMIN, muted):      ¥1,500   (only when provided)
      // Each order goes through the current month at varying days so
      // submittedAt is a believable spread.
      const monthlyMidUtc = new Date(Date.UTC(yyyy!, mm! - 1, 15, 4, 0));
      const rankingSpecs: Array<{
        submitterId: string;
        submitterRole: string;
        amount: string;
        daysOffset: number;
        productSuffix: string | null; // null → UNCATEGORIZED
      }> = [
        {
          submitterId: opts.salesUserId,
          submitterRole: 'SALES',
          amount: '5000.00',
          daysOffset: -10,
          productSuffix: 'p-blank-1',
        },
      ];
      if (opts.csUserId) {
        rankingSpecs.push({
          submitterId: opts.csUserId,
          submitterRole: 'CUSTOMER_SERVICE',
          amount: '3000.00',
          daysOffset: -5,
          productSuffix: 'p-foil-1',
        });
      }
      if (opts.ownerUserId) {
        rankingSpecs.push({
          submitterId: opts.ownerUserId,
          submitterRole: 'ADMIN',
          amount: '1500.00',
          daysOffset: -2,
          productSuffix: null, // → UNCATEGORIZED bucket
        });
      }
      // Plus one more SALES order from salesUserId with a COLOR_PRINT
      // product so pie chart has all three filled categories.
      rankingSpecs.push({
        submitterId: opts.salesUserId,
        submitterRole: 'SALES',
        amount: '2500.00',
        daysOffset: -7,
        productSuffix: 'p-color-1',
      });

      let rankIdx = 0;
      for (const spec of rankingSpecs) {
        const orderId = `e2e-dash-rank-${rankIdx}`;
        const orderNo = `E2E-RANK-${rankIdx}`;
        const submittedAt = new Date(
          monthlyMidUtc.getTime() + spec.daysOffset * dayMs,
        );
        await db.query(
          `
          INSERT INTO "Order" (
            id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
            status, "isUrgent", "totalAmount",
            "submittedAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4::"Role",
            CASE $4::"Role"
              WHEN 'SALES'::"Role" THEN 'EXTERNAL_SALES'::"OrderSettlementType"
              WHEN 'CUSTOMER_SERVICE'::"Role" THEN 'INTERNAL_SALES'::"OrderSettlementType"
              WHEN 'ADMIN'::"Role" THEN 'FACTORY_DIRECT'::"OrderSettlementType"
            END,
            $3,
            'SUBMITTED'::"OrderStatus", FALSE, $5,
            $6, $6, $6
          )
          `,
          [
            orderId,
            orderNo,
            spec.submitterId,
            spec.submitterRole,
            spec.amount,
            submittedAt.toISOString(),
          ],
        );
        await db.query(
          `
          INSERT INTO "OrderItem" (
            id, "orderId", sequence, name, "productId",
            quantity, crafts, "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, 1, '排行 fixture', $3,
            5000, ARRAY[]::text[], NOW(), NOW()
          )
          `,
          [
            `${orderId}-item`,
            orderId,
            spec.productSuffix ? `e2e-dash-prod-${spec.productSuffix}` : null,
          ],
        );
        rankingOrderIds.push(orderId);
        rankIdx += 1;
      }
    }

    return {
      submittedOrderIds,
      urgentOrderId: 'e2e-dash-sub-3-urgent',
      completedOrderIds,
      shippedOrderId,
      billId,
      monthlyTotal,
      monthlyPaid,
      outsourceId,
      outsourceDaysOverdue: 3,
      csPeriodId,
      csPeriodDaysUntilEnd,
      chartProductIds,
      trendCompletedOrderIds,
      rankingOrderIds,
    };
  });
}

// Returns a UTC Date that's safely in the middle of the current
// Shanghai calendar month (15th, noon UTC). Used by bill-flow E2E so
// the seeded order's `finishedAt` matches the period the UI defaults
// to ("当月" via Intl in Asia/Shanghai), regardless of the PG session
// timezone.
export function midShanghaiMonth(now: Date = new Date()): Date {
  // en-CA gives YYYY-MM. Format in Asia/Shanghai so we get the user-
  // facing month, not whatever the runner's locale says.
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const [yyyy, mm] = ym.split('-').map(Number);
  // 15th at 12:00 UTC = 20:00 Shanghai = comfortably inside both
  // UTC-month bounds and Shanghai-month bounds.
  return new Date(Date.UTC(yyyy!, mm! - 1, 15, 12, 0, 0));
}

// Seed admin credentials. We DON'T fall back to a hardcoded password:
// .env.example ships SEED_ADMIN_PASSWORD blank → seed.ts then mints a
// random one-time password and prints it to stdout. Defaulting to
// "admin@2026" here would silently fail on every clean machine / CI
// env (Codex round 73 / P1). Username defaults to "admin" because
// that's the seed's fixed default in `.env.example`.
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
export const ADMIN_PASSWORD = (() => {
  const v = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!v || v.trim() === '') {
    throw new Error(
      'E2E suite requires E2E_ADMIN_PASSWORD (or SEED_ADMIN_PASSWORD) ' +
        'to be set. Either point it at the seeded admin password, or run ' +
        'the seed with a known SEED_ADMIN_PASSWORD before pnpm test:e2e.',
    );
  }
  return v;
})();

// Logs in via the /login form. `from` is the protected URL the caller
// will go to next — the form preserves it as ?from=... so the post-
// login redirect lands the test where it expects to be (avoids a
// flaky "navigate to / first, then to target" two-step).
export async function login(
  page: Page,
  opts: { from?: string; username?: string; password?: string } = {},
): Promise<void> {
  const { from = '/', username = ADMIN_USERNAME, password = ADMIN_PASSWORD } =
    opts;
  const url = from === '/' ? '/login' : `/login?from=${encodeURIComponent(from)}`;
  await isolateE2eLoginClient(page);
  await page.goto(url);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /登录|登 录/ }).click();
  // Wait for navigation off /login. Auth.js posts to a server action
  // and bounces; we settle on whatever non-login page lands.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 10_000,
  });
}

// The new-order form is a three-step tab interface. Item controls stay in the
// DOM while hidden so draft values survive step changes; E2E flows must follow
// the same visible interaction path as an operator instead of filling hidden
// inputs or using Playwright's force option.
export async function openFirstOrderItemEditor(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /款式/ }).click();
  // During an RSC navigation React can briefly retain the outgoing hidden
  // tabpanel while mounting the incoming one. Scope all interaction to the
  // visible panel so the helper follows what the user can actually operate.
  const panel = page.locator('#order-step-items-panel:visible').first();
  await expect(panel).toBeVisible();

  const editorToggle = panel
    .locator('ol > li')
    .first()
    .getByRole('button')
    .first();
  if ((await editorToggle.getAttribute('aria-expanded')) !== 'true') {
    await editorToggle.click();
  }
  await expect(editorToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('input[name="items.0.name"]')).toBeVisible();
}

// External-sales orders must explicitly confirm both customer-facing logistics
// charges. Keep this in the visible shipping step so creation-flow tests cover
// the same prerequisite an operator sees instead of bypassing the domain rule.
export async function fillExternalSalesOrderCharges(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /收货与费用/ }).click();
  const panel = page.locator('#order-step-shipping-panel');
  await expect(panel).toBeVisible();

  await page
    .getByLabel('收货信息', { exact: true })
    .fill('E2E 收货人 13800138000 广东省深圳市南山区测试路 1 号');
  await page.locator('#primary-province').selectOption('广东');
  await page.locator('#primary-weight').fill('1');
  await page.locator('#primary-shipping-fee').fill('0.00');
  await page.locator('#primary-packing-fee').fill('0.00');
  await page
    .locator('#primary-charge-reason')
    .fill('E2E 全链路仅验证工单流程，物流与耗材由测试值人工确认');
}

// The submit button changes to "提交中…" immediately, so asserting that the
// old accessible name disappeared can pass before the server transition has
// committed. Wait for the detail heading's server-rendered status instead.
export async function submitDraftOrderAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^提交工单$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('已提交', {
    timeout: 20_000,
  });
}

// Stamps a cuid-shaped suffix onto identifiers so reruns against the
// shared dev DB don't collide on uniques (orderNo is generated server-
// side, but customerRef and free-text fields could).
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function cleanupAutoCodePartyFixture(opts: {
  partyId: string;
  expectedName: string;
}): Promise<void> {
  if (!opts.expectedName.startsWith('Codex E2E 自动编码供应商 ')) {
    throw new Error('cleanupAutoCodePartyFixture refuses a non-E2E name');
  }

  await withDb(async (db) => {
    const result = await db.query<{
      id: string;
      code: string;
      name: string;
      type: string;
      customerOrderCount: string;
      purchaseOrderCount: string;
    }>(
      `SELECT p.id, p.code, p.name, p.type::text AS type,
              (SELECT COUNT(*)::text FROM "Order" o
                WHERE o."customerPartyId" = p.id) AS "customerOrderCount",
              (SELECT COUNT(*)::text FROM "PurchaseOrder" po
                WHERE po."supplierPartyId" = p.id) AS "purchaseOrderCount"
         FROM "Party" p
        WHERE p.id = $1`,
      [opts.partyId],
    );

    if (result.rowCount === 0) return;
    const row = result.rows[0]!;
    if (
      row.name !== opts.expectedName ||
      row.type !== 'SUPPLIER' ||
      !/^PTY-\d{6}$/.test(row.code) ||
      row.customerOrderCount !== '0' ||
      row.purchaseOrderCount !== '0'
    ) {
      throw new Error('cleanupAutoCodePartyFixture refuses unexpected data');
    }

    await db.query(`DELETE FROM "Party" WHERE id = $1`, [opts.partyId]);
  });
}

// ---- Automation smoke fixtures ----
//
// The smoke suite is intentionally narrow: it proves that protected routes,
// owner-only Pigsty readiness, and the three search surfaces render against a
// real dev database. Fixtures are idempotent and use fixed CODX/E2E values so
// failed runs are easy to inspect manually.
export async function seedSearchSmokeFixtures(opts: {
  ownerId: string;
}): Promise<{
  productCode: string;
  productName: string;
  orderId: string;
  orderNo: string;
  customerRef: string;
  materialCode: string;
  materialName: string;
  materialCurrentStock: string;
  partyId: string;
  partyCode: string;
  partyName: string;
  partyContactName: string;
  partyContactPhone: string;
  partyAddress: string;
  supplierPartyId: string;
  supplierPartyCode: string;
  supplierPartyName: string;
}> {
  const productCode = 'CODX-E2E-PROD-001';
  const productName = 'Codex E2E 测试红包';
  const orderId = 'codx_e2e_order_search_001';
  const orderNo = 'CODX-E2E-ORDER-001';
  const customerRef = 'CODX-E2E客户代号';
  const materialCode = 'CODX-E2E-MAT-001';
  const materialName = 'Codex E2E 测试铜版纸';
  const partyId = 'codx_e2e_party_search_001';
  const partyCode = 'CODX_E2E_CUST_001';
  const partyName = 'Codex E2E 客户主数据';
  const partyContactName = 'Codex E2E 联系人';
  const partyContactPhone = '13800002222';
  const partyAddress = '广东深圳南山科技园 1 号';
  const supplierPartyId = 'codx_e2e_supplier_search_001';
  const supplierPartyCode = 'CODX_E2E_SUP_001';
  const supplierPartyName = 'Codex E2E 纸张供应商';
  let materialCurrentStock = '0.00';

  await withDb(async (db) => {
    const categoryNode = await db.query<{
      id: string;
      legacyCategory: string;
    }>(
      `SELECT id, "legacyCategory" AS "legacyCategory"
         FROM "ProductCategoryNode"
        WHERE "isActive" = true
        ORDER BY "sortOrder" ASC, path ASC
        LIMIT 1`,
    );
    if (categoryNode.rowCount === 0) {
      throw new Error('seedSearchSmokeFixtures: no active product category');
    }

    await db.query(
      `
      INSERT INTO "Product" (
        id, code, category, "categoryNodeId", name, specification,
        "paperType", "baseUnitPrice", "minOrderQty", "isActive",
        "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_product_search_001', $1, $2::"ProductCategory", $3,
        $4, '7寸 单色', '铜版纸', 0.1200, 1000, true, NOW(), NOW()
      )
      ON CONFLICT (code) DO UPDATE SET
        category = EXCLUDED.category,
        "categoryNodeId" = EXCLUDED."categoryNodeId",
        name = EXCLUDED.name,
        specification = EXCLUDED.specification,
        "paperType" = EXCLUDED."paperType",
        "baseUnitPrice" = EXCLUDED."baseUnitPrice",
        "minOrderQty" = EXCLUDED."minOrderQty",
        "isActive" = true,
        "updatedAt" = NOW()
      `,
      [
        productCode,
        categoryNode.rows[0]!.legacyCategory,
        categoryNode.rows[0]!.id,
        productName,
      ],
    );

    await db.query(
      `
      INSERT INTO "Material" (
        id, code, name, category, specification, unit,
        "safetyStock", "averageCost", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_material_search_001', $1, $2, 'PAPER'::"MaterialCategory",
        '250g A4', '张', 1000.00, 0.0800, true, NOW(), NOW()
      )
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        specification = EXCLUDED.specification,
        unit = EXCLUDED.unit,
        "safetyStock" = EXCLUDED."safetyStock",
        "averageCost" = EXCLUDED."averageCost",
        "isActive" = true,
        "updatedAt" = NOW()
      `,
      [materialCode, materialName],
    );

    await db.query(
      `
      INSERT INTO "MaterialLocationStock" (
        id, "materialId", "warehouseId", "locationId", "currentStock",
        "createdAt", "updatedAt"
      )
      SELECT
        'mls_' || md5(material.id || ':default_location'),
        material.id,
        'default_warehouse',
        'default_location',
        0,
        NOW(),
        NOW()
      FROM "Material" material
      WHERE material.code = $1
      ON CONFLICT ("materialId", "locationId") DO NOTHING
      `,
      [materialCode],
    );

    await db.query(
      `
      INSERT INTO "Party" (
        id, type, code, name, "shortName", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'CUSTOMER'::"PartyType", $2, $3, 'E2E客户', true, NOW(), NOW()
      )
      ON CONFLICT (code) DO UPDATE SET
        type = EXCLUDED.type,
        name = EXCLUDED.name,
        "shortName" = EXCLUDED."shortName",
        "isActive" = true,
        "updatedAt" = NOW()
      `,
      [partyId, partyCode, partyName],
    );
    await db.query(
      `
      INSERT INTO "Party" (
        id, type, code, name, "shortName", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'SUPPLIER'::"PartyType", $2, $3, 'E2E供应商', true, NOW(), NOW()
      )
      ON CONFLICT (code) DO UPDATE SET
        type = EXCLUDED.type,
        name = EXCLUDED.name,
        "shortName" = EXCLUDED."shortName",
        "isActive" = true,
        "updatedAt" = NOW()
      `,
      [supplierPartyId, supplierPartyCode, supplierPartyName],
    );
    await db.query(`DELETE FROM "PartyContact" WHERE "partyId" = $1`, [partyId]);
    await db.query(`DELETE FROM "PartyAddress" WHERE "partyId" = $1`, [partyId]);
    await db.query(
      `
      INSERT INTO "PartyContact" (
        id, "partyId", name, phone, "isPrimary", "sortOrder", "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_party_contact_001', $1, $2, $3, true, 0, NOW(), NOW()
      )
      `,
      [partyId, partyContactName, partyContactPhone],
    );
    await db.query(
      `
      INSERT INTO "PartyAddress" (
        id, "partyId", "receiverName", "receiverPhone",
        province, city, district, detail, "isDefault", "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_party_address_001', $1, $2, $3,
        '广东', '深圳', '南山', '科技园 1 号', true, 0,
        NOW(), NOW()
      )
      `,
      [partyId, partyContactName, partyContactPhone],
    );

    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "customerRef", "receiverName", "receiverPhone",
        "receiverAddress", "expressCode", "trackingNo", "createdAt",
        "updatedAt"
      ) VALUES (
        $1, $2, $3, 'ADMIN'::"Role", 'FACTORY_DIRECT'::"OrderSettlementType", $3,
        'DRAFT'::"OrderStatus", true, $4, 'Codex E2E 收货人',
        '13900001111', 'E2E 测试地址', 'SF-CODX-E2E',
        'SF123456789E2E', NOW(), NOW()
      )
      ON CONFLICT ("orderNo") DO UPDATE SET
        "submitterId" = EXCLUDED."submitterId",
        "createdById" = EXCLUDED."createdById",
        "isUrgent" = true,
        "customerRef" = EXCLUDED."customerRef",
        "receiverName" = EXCLUDED."receiverName",
        "receiverPhone" = EXCLUDED."receiverPhone",
        "receiverAddress" = EXCLUDED."receiverAddress",
        "expressCode" = EXCLUDED."expressCode",
        "trackingNo" = EXCLUDED."trackingNo",
        "updatedAt" = NOW()
      `,
      [orderId, orderNo, opts.ownerId, customerRef],
    );

    await db.query(`DELETE FROM "OrderItem" WHERE "orderId" = $1`, [orderId]);
    await db.query(
      `
      INSERT INTO "OrderItem" (
        id, "orderId", sequence, name, "productId", specification,
        "paperType", quantity, crafts, "unitPrice", subtotal,
        "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_order_item_search_001', $1, 1, 'Codex E2E 款式',
        'codx_e2e_product_search_001', '7寸 单色', '铜版纸',
        2000, ARRAY[]::text[], 0.1200, 240.00, NOW(), NOW()
      )
      `,
      [orderId],
    );

    await db.query(
      `DELETE FROM "BillOfMaterial"
        WHERE id = 'codx_e2e_bom_search_001'
           OR "productId" = 'codx_e2e_product_search_001'`,
    );
    await db.query(
      `
      INSERT INTO "BillOfMaterial" (
        id, "productId", "categoryNodeId", name, version,
        "baseQuantity", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_bom_search_001', 'codx_e2e_product_search_001',
        NULL, 'Codex E2E 标准 BOM', 1, 1000, true, NOW(), NOW()
      )
      `,
    );
    await db.query(
      `
      INSERT INTO "BillOfMaterialItem" (
        id, "bomId", "materialId", quantity, "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        'codx_e2e_bom_item_search_001', 'codx_e2e_bom_search_001',
        'codx_e2e_material_search_001', 500.0000, 10, NOW(), NOW()
      )
      `,
    );

    const generatedColumns = await db.query<{
      tableName: string;
      columnName: string;
      isGenerated: string;
    }>(
      `
      SELECT table_name AS "tableName", column_name AS "columnName",
             is_generated AS "isGenerated"
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('Order', 'Product', 'Material', 'Party')
         AND column_name IN ('searchPinyin', 'searchPinyinInitials')
      `,
    );
    const canWriteSearchColumn = (tableName: string, columnName: string) =>
      generatedColumns.rows.some(
        (row) =>
          row.tableName === tableName &&
          row.columnName === columnName &&
          row.isGenerated === 'NEVER',
      );

    if (
      canWriteSearchColumn('Product', 'searchPinyin') &&
      canWriteSearchColumn('Product', 'searchPinyinInitials')
    ) {
      await db.query(
        `UPDATE "Product"
            SET "searchPinyin" = 'codexeeceshihongbao',
                "searchPinyinInitials" = 'cdxeecshb'
          WHERE code = $1`,
        [productCode],
      );
    }
    if (
      canWriteSearchColumn('Material', 'searchPinyin') &&
      canWriteSearchColumn('Material', 'searchPinyinInitials')
    ) {
      await db.query(
        `UPDATE "Material"
            SET "searchPinyin" = 'codexeeceshitongbanzhi',
                "searchPinyinInitials" = 'cdxeecstbz'
          WHERE code = $1`,
        [materialCode],
      );
    }
    if (
      canWriteSearchColumn('Party', 'searchPinyin') &&
      canWriteSearchColumn('Party', 'searchPinyinInitials')
    ) {
      await db.query(
        `UPDATE "Party"
            SET "searchPinyin" = 'codexeecekehuzhushuju',
                "searchPinyinInitials" = 'cdxeeckhzsj'
          WHERE code = $1`,
        [partyCode],
      );
    }
    if (
      canWriteSearchColumn('Order', 'searchPinyin') &&
      canWriteSearchColumn('Order', 'searchPinyinInitials')
    ) {
      await db.query(
        `UPDATE "Order"
            SET "searchPinyin" = 'codexeekehu',
                "searchPinyinInitials" = 'cdxeekh'
          WHERE "orderNo" = $1`,
        [orderNo],
      );
    }

    const materialStock = await db.query<{ currentStock: string }>(
      `SELECT "currentStock"::text AS "currentStock"
         FROM "Material"
        WHERE code = $1`,
      [materialCode],
    );
    materialCurrentStock = materialStock.rows[0]?.currentStock ?? '0.00';
  });

  return {
    productCode,
    productName,
    orderId,
    orderNo,
    customerRef,
    materialCode,
    materialName,
    materialCurrentStock,
    partyId,
    partyCode,
    partyName,
    partyContactName,
    partyContactPhone,
    partyAddress,
    supplierPartyId,
    supplierPartyCode,
    supplierPartyName,
  };
}

// Logs out the currently signed-in user via the header UserMenu dropdown
// and waits to land on /login. Used by multi-role flow tests where the
// same browser context switches between SALES → ADMIN → WORKER →
// ADMIN. We click the form's submit button rather than fetch the
// signOut endpoint directly so we exercise the same path users do.
//
// Phase D（2026-05-06）退出按钮收进 AdminHeader 的 UserMenu dropdown：
// (a) 先点头像 trigger 展开 menu（aria-label 以&ldquo;用户菜单&rdquo;开头），
// (b) data-slot="user-menu-logout" 锁定 form 内 submit 按钮。
// Worker (H5) 仍是 inline LogoutButton —— 用 role=button name=退出登录
// 兜底（dropdown 路径找不到时降级）。
export async function logout(page: Page): Promise<void> {
  const userMenuTrigger = page.locator('button[aria-label^="用户菜单"]');
  if (await userMenuTrigger.isVisible().catch(() => false)) {
    await userMenuTrigger.click();
    // dropdown 内的 logout 是平铺 form>button（非 DropdownMenuItem，避
    // 免 form/menuitem 嵌套冲突）。data-slot 锁定 + auto-wait 等 portal
    // 内容真正渲染。
    await page.locator('[data-slot="user-menu-logout"]').click();
  } else {
    // worker 端 H5 layout 没接 admin shell，仍是 inline button。
    await page.getByRole('button', { name: /退出登录/ }).click();
  }
  await page.waitForURL((url) => url.pathname.startsWith('/login'), {
    timeout: 10_000,
  });
}

// Defensive assertion: when a Server Action errors, Next dev throws an
// in-page error dialog. We check for the actual error dialog (not the
// `<nextjs-portal>` shell which is present on every dev page for the
// ---- CDR E2E (P0 #7) ----
//
// 种 1 个 SUBMITTED 工单，含 N 个 CDR-type OrderItemDesign。foreman
// 在 /foreman/cdr 选当天 → 看到这条工单 → 勾 → 生成下载包。
//
// **deterministic id 前缀** `e2e-cdr-` 让重跑的 E2E 走同一行（替代）
// 而不是堆积。每次运行先 wipe 再 insert。
export async function seedCdrOrder(opts: {
  submitterId: string;
  // 当天提交（Asia/Shanghai noon UTC）—— UI 默认 from=today / to=today
  // 抓得住。
  cdrCount?: number;
}): Promise<{ orderId: string; orderNo: string }> {
  const cdrCount = opts.cdrCount ?? 2;
  const orderId = 'e2e-cdr-1';
  const orderNo = 'E2E-CDR-1';
  const orderItemId = `${orderId}-item`;

  // 当天 Shanghai noon → UTC 04:00 of today
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [yyyy, mm, dd] = ymd.split('-').map(Number);
  const submittedAt = new Date(Date.UTC(yyyy!, mm! - 1, dd!, 4, 0, 0));

  return withDb(async (db) => {
    // CASCADE 顺序：DesignBundle.designIds 引用是 string[]（无 FK），
    // 不影响 wipe；Order delete CASCADE 到 OrderItem → OrderItemDesign。
    await db.query(`DELETE FROM "Order" WHERE id = $1`, [orderId]);
    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "totalAmount",
        "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
        'SUBMITTED'::"OrderStatus", FALSE, 0,
        $4, $4, $4
      )
      `,
      [orderId, orderNo, opts.submitterId, submittedAt.toISOString()],
    );
    await db.query(
      `
      INSERT INTO "OrderItem" (
        id, "orderId", sequence, name, "specification", "paperType",
        quantity, "foilColors", "isDoubleSided", "isDoubleColor",
        crafts, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 1, 'CDR 测试款', '9cm', '珠光纸',
        5000, ARRAY['金色']::text[], FALSE, FALSE,
        ARRAY[]::text[], NOW(), NOW()
      )
      `,
      [orderItemId, orderId],
    );
    for (let i = 0; i < cdrCount; i++) {
      await db.query(
        `
        INSERT INTO "OrderItemDesign" (
          id, "orderItemId", "fileType", "fileUrl", "fileName",
          "fileSize", "uploadedBy", "uploadedAt"
        ) VALUES (
          $1, $2, 'CDR'::"DesignFileType",
          $3, $4, 1024, $5, NOW()
        )
        `,
        [
          `${orderItemId}-cdr-${i}`,
          orderItemId,
          // 占位 URL；mock-mode 不真 fetch 它，只走 metadata 路径
          `https://oss.example.com/${orderItemId}-${i}.cdr`,
          `design-${i + 1}.cdr`,
          opts.submitterId,
        ],
      );
    }
    // 同时清掉之前 E2E 留下的 DesignBundle，让 recent 列表看起来干净
    await db.query(`DELETE FROM "DesignBundle" WHERE "createdById" IN (
       SELECT id FROM "User" WHERE username LIKE 'e2e-%'
     )`);

    return { orderId, orderNo };
  });
}

// dev tools indicator). If selectors drift on a future Next bump, tests
// still pass — surrounding URL / content assertions catch real failures.
export async function expectNoNextErrorOverlay(page: Page): Promise<void> {
  // Next 16 dev error dialog: visible h1 like "Build Error" / "Runtime
  // Error" inside the portal. We pierce shadow DOM via :light and grep
  // for those headings.
  const overlay = page.locator(
    'nextjs-portal [role="dialog"]:has-text("Error")',
  );
  await expect(overlay).toHaveCount(0);
}

// ---- Slice C wire fixtures (P1 #2) ----
//
// Seeds 1 mock channel `e2e_wire_test_group` + binds the 5 status-machine
// rules (ORDER_SUBMITTED / URGENT_ORDER / ORDER_SCHEDULED / ORDER_COMPLETED
// / ORDER_SHIPPED) to it + flips them isActive=true. Existing seed.ts
// default templates (already populated by globalSetup → seed.ts) provide
// the message bodies — no extra writes needed.
//
// Why a fixed channelKey 'e2e_wire_test_group' (not random): wipe
// idempotency. resetNotificationFixture deletes channelKey LIKE 'e2e_%';
// reusing the same key on rerun keeps the wipe scope tight and predictable.
//
// 在 NOTIFICATION_MOCK_MODE=true（dev / test 默认）环境下，notify 不会
// 真发 HTTP — 只写 NotificationLog 行（status=SUCCESS errorMessage='MOCK'），
// 这是 E2E 校验 wire 的唯一证据。
export async function seedNotificationWireFixture(): Promise<{
  channelId: string;
}> {
  return withDb(async (db) => {
    // Step 1: same wipe as resetNotificationFixture (e2e_-prefix scoped)
    await db.query(
      `DELETE FROM "NotificationLog" WHERE "channelId" IN (
         SELECT id FROM "NotificationChannel" WHERE "channelKey" LIKE 'e2e_%'
       )`,
    );
    await db.query(
      `DELETE FROM "NotificationChannel" WHERE "channelKey" LIKE 'e2e_%'`,
    );

    // Step 2: insert mock channel. webhookUrl 不会真用（mock-mode），
    // 但 schema 要 String NOT NULL；放一个明显的 fake 域名让 ops 一眼
    // 看出&ldquo;这条 channel 是 e2e fixture&rdquo;。
    const channelId = `e2e-notif-wire-${randomBytes(4).toString('hex')}`;
    await db.query(
      `
      INSERT INTO "NotificationChannel" (
        id, "channelKey", "channelName", "webhookUrl",
        "isActive", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'e2e_wire_test_group', 'E2E 推送测试群',
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=E2E_FIXTURE',
        TRUE, NOW(), NOW()
      )
      `,
      [channelId],
    );

    // Step 3: bind + activate all wired events（5 状态机 + 5 cron/库存）。
    // STOCK_ALERT 由出库跨越检测触发；ORDER_OVERDUE 由
    // /api/cron/order-overdue 触发（2026-07-07 新增）。
    await db.query(
      `
      UPDATE "NotificationRule"
         SET "channelIds" = ARRAY[$1]::text[],
             "isActive" = true,
             "updatedAt" = NOW()
       WHERE "eventType" IN (
         'ORDER_SUBMITTED', 'URGENT_ORDER', 'ORDER_SCHEDULED',
         'ORDER_COMPLETED', 'ORDER_SHIPPED',
         'DAILY_WORKER_SALARY', 'CS_PERIOD_SETTLED',
         'OUTSOURCE_OVERDUE', 'CS_PERIOD_ENDING', 'ORDER_OVERDUE'
       )
      `,
      [channelId],
    );

    return { channelId };
  });
}

// Seeds 1 overdue Order (promisedDate 5 天前 + IN_PRODUCTION) for
// /api/cron/order-overdue tests. id 前缀 e2e-cron-order-，每次先 wipe。
export async function seedOrderOverdueForCron(): Promise<{
  orderId: string;
  orderNo: string;
}> {
  return withDb(async (db) => {
    await db.query(`DELETE FROM "Order" WHERE id LIKE 'e2e-cron-order-%'`);
    const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
    const suffix = randomBytes(4).toString('hex');
    const orderId = `e2e-cron-order-${suffix}`;
    const orderNo = `E2E-DUE-${suffix.toUpperCase()}`;
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
        status, "isUrgent", "customerRef", "totalAmount", "promisedDate",
        "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'SALES'::"Role", 'EXTERNAL_SALES'::"OrderSettlementType", $3,
        'IN_PRODUCTION'::"OrderStatus", false, 'E2E交期客户', 100, $4,
        NOW(), NOW(), NOW()
      )
      `,
      [orderId, orderNo, salesId, fiveDaysAgo.toISOString()],
    );
    return { orderId, orderNo };
  });
}

// Seeds 1 overdue OutsourceOrder for /api/cron/outsource-overdue tests.
// id-prefixed `e2e-cron-os-` so seedDashboardSnapshot's wipe scope
// (`e2e-dash-os-%`) doesn't accidentally clobber it.
export async function seedOverdueOutsourceForCron(): Promise<{
  outsourceId: string;
}> {
  return withDb(async (db) => {
    // Wipe prior cron-fixture rows (this fixture is rerun every cron
    // E2E run; idempotency).
    await db.query(
      `DELETE FROM "OutsourceOrder" WHERE id LIKE 'e2e-cron-os-%'`,
    );
    const outsourceId = `e2e-cron-os-${randomBytes(4).toString('hex')}`;
    // expectedDate 在 5 天前（UTC 任意时间，肯定 < 今日 Shanghai 0:00）
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await db.query(
      `
      INSERT INTO "OutsourceOrder" (
        id, "idempotencyKey", "orderItemIds", "supplierName", "expectedDate",
        status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $1 || ':fixture', ARRAY[]::text[], 'E2E cron 阿福外协', $2,
        'IN_PROGRESS'::"OutsourceStatus", NOW(), NOW()
      )
      `,
      [outsourceId, fiveDaysAgo.toISOString()],
    );
    return { outsourceId };
  });
}

// Seeds 1 ending-soon SalaryPeriod for /api/cron/cs-period-ending.
// periodEnd = 今日 + 3d Shanghai → daysUntilEnd = 3 (matches
// seedDashboardSnapshot's csPeriod 计算)。csUserId 必传；调用方 wipe
// 其他 SalaryPeriod 通过 resetCsSalaryStateForUser。
export async function seedEndingPeriodForCron(opts: {
  csUserId: string;
}): Promise<{ periodId: string }> {
  return withDb(async (db) => {
    // Same wipe-by-user pattern as resetCsSalaryStateForUser
    await db.query(
      `DELETE FROM "CsPayrollPayment" WHERE "salaryPeriodId" IN (
         SELECT id FROM "SalaryPeriod" WHERE "csUserId" = $1
       )`,
      [opts.csUserId],
    );
    await db.query(`DELETE FROM "CsSalesEntry" WHERE "csUserId" = $1`, [
      opts.csUserId,
    ]);
    await db.query(
      `DELETE FROM "CustomerServiceCommission" WHERE "csUserId" = $1`,
      [opts.csUserId],
    );
    await db.query(`DELETE FROM "SalaryPeriod" WHERE "csUserId" = $1`, [
      opts.csUserId,
    ]);

    const now = new Date();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const [yyyy, mm, dd] = ymd.split('-').map(Number);
    // periodEnd = today + 3d (UTC midnight of that date — @db.Date strips
    // time anyway). periodStart = today - 90d.
    const periodEnd = new Date(Date.UTC(yyyy!, mm! - 1, dd! + 3));
    const periodStart = new Date(Date.UTC(yyyy!, mm! - 1, dd! - 90));

    const periodId = `e2e-cron-csp-${randomBytes(4).toString('hex')}`;
    await db.query(
      `
      INSERT INTO "SalaryPeriod" (
        id, "csUserId", "periodStart", "periodEnd",
        "durationMonths", "totalSales", "initialSales", "monthlyBase",
        status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, 4, 100000, 0, 5000,
        'IN_PROGRESS'::"SalaryPeriodStatus", NOW(), NOW()
      )
      `,
      [
        periodId,
        opts.csUserId,
        periodStart.toISOString().slice(0, 10),
        periodEnd.toISOString().slice(0, 10),
      ],
    );
    return { periodId };
  });
}

// 读取按 createdAt 升序排的 NotificationLog 行，可选按 eventType 过滤。
// E2E 用：跑完一步生产流程后断言"出现一条新 ORDER_SUBMITTED log"。
export async function readNotificationLogs(filter: {
  eventType?: string;
  channelId?: string;
}): Promise<
  Array<{
    id: string;
    eventType: string;
    channelId: string;
    status: string;
    errorMessage: string | null;
    messageContent: string;
    relatedOrderId: string | null;
    createdAt: Date;
  }>
> {
  return withDb(async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`"eventType" = $${params.length}`);
    }
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`"channelId" = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await db.query(
      `SELECT id, "eventType", "channelId", status::text AS status,
              "errorMessage", "messageContent", "relatedOrderId", "createdAt"
         FROM "NotificationLog"
        ${where}
        ORDER BY "createdAt" ASC`,
      params,
    );
    return r.rows as Array<{
      id: string;
      eventType: string;
      channelId: string;
      status: string;
      errorMessage: string | null;
      messageContent: string;
      relatedOrderId: string | null;
      createdAt: Date;
    }>;
  });
}
