import { expect, type Page } from '@playwright/test';

// Re-export so specs don't have to import from global-setup directly.
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

// Wipes ALL bill / billItem / order rows owned by the given user —
// bill-flow E2E uses this to keep each run independent.
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
    // Step 1: clear all BillItems for this user's bills
    //   (BillItem → Bill is RESTRICT, must go first).
    // Step 2: clear all Bills for this user (full wipe — e2e-* user
    //   is test-only; round 80 contract).
    // Step 3: clear FINISHED orders for this user.
    //
    // We narrow Order delete to status=FINISHED to avoid cross-spec
    // interference (Codex round 83 / P2): production-flow.spec.ts
    // leaves orders at status=COMPLETED for the same fixture user;
    // those are not bill-relevant (generateBillsForPeriod only picks
    // FINISHED) but ARE state another spec may rely on for rerun
    // observability. round-82's unconditional Order wipe was too
    // broad. Order children cascade automatically (OrderItem +
    // OrderLog ON DELETE CASCADE, ProductionTask + OrderItemDesign
    // via OrderItem, OutsourceOrder.orderId → SET NULL).
    await db.query(
      `DELETE FROM "BillItem" WHERE "billId" IN (
         SELECT id FROM "Bill" WHERE "salesUserId" = $1
       )`,
      [userId],
    );
    await db.query(`DELETE FROM "Bill" WHERE "salesUserId" = $1`, [userId]);
    await db.query(
      `DELETE FROM "Order" WHERE "submitterId" = $1 AND status = 'FINISHED'`,
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
        id, "orderNo", "submitterId", "submitterRole", "createdById",
        status, "isUrgent", "customerRef", "totalAmount",
        "submittedAt", "scheduledAt", "completedAt", "shippedAt", "finishedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4::"Role", $3,
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
}): Promise<{ orderId: string; orderNo: string; orderItemId: string }> {
  // Deterministic per (designCount). Same id across runs → same QR
  // SVG, same screenshot bytes. CASCADE FKs on Order → OrderItem and
  // OrderItem → OrderItemDesign clean up children automatically.
  const orderId = `e2e-vr-${opts.designCount}`;
  const orderNo = `E2E-VR-${opts.designCount}`;
  const orderItemId = `${orderId}-item`;

  await withDb(async (db) => {
    await db.query(`DELETE FROM "Order" WHERE id = $1`, [orderId]);

    await db.query(
      `
      INSERT INTO "Order" (
        id, "orderNo", "submitterId", "submitterRole", "createdById",
        status, "isUrgent", "customerRef", "receiverName", "receiverPhone",
        "totalAmount", "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'OWNER'::"Role", $3,
        'DRAFT'::"OrderStatus", FALSE,
        'VR-CUSTOMER',
        'VR 收件人',
        '13800138000',
        0,
        TIMESTAMP '2026-01-01 00:00:00',
        TIMESTAMP '2026-01-01 00:00:00',
        TIMESTAMP '2026-01-01 00:00:00'
      )
      `,
      [orderId, orderNo, opts.submitterId],
    );

    await db.query(
      `
      INSERT INTO "OrderItem" (
        id, "orderId", sequence, name, specification, "paperType",
        quantity, "foilColor", "isDoubleSided", "isDoubleColor",
        crafts, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 1, 'VR 款式', '9cm × 17cm', '珠光纸',
        5000, '金色', TRUE, FALSE,
        ARRAY[]::text[], NOW(), NOW()
      )
      `,
      [orderItemId, orderId],
    );

    for (let i = 0; i < opts.designCount; i++) {
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
          `${orderItemId}-design-${i}`,
          orderItemId,
          PLACEHOLDER_PNG_DATA_URL,
          `design-${i + 1}.png`,
          opts.submitterId,
        ],
      );
    }
  });

  return { orderId, orderNo, orderItemId };
}

// Wipes ALL SalaryPeriods + CommissionRecords for an e2e-* user.
// Required for CS-accumulate E2E so each run starts with a known-
// empty period (totalSales=0). Same e2e-* guard as resetBillsForUser
// so this can never wipe a real CS user's salary state.
//
// CustomerServiceCommission has a RESTRICT FK to SalaryPeriod, so we
// drop commissions first, then periods.
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

// ---- Owner dashboard E2E (P1 #1 Slice A) ----
//
// Seeds a deterministic snapshot for /owner KPI assertions:
//   - 3 orders submitted today (1 urgent) → 今日提交 / 急单 cards
//   - 2 orders completed today           → 今日完工 card
//   - 1 order shipped today              → 今日发货 card
//   - 1 Bill in current Shanghai month   → 本月应收 card
//
// Why a fresh wipe of *all* e2e-* orders + bills before seeding: the
// dashboard counts globally (no per-user filter), and earlier specs
// in this same playwright run (bill-flow, production-flow) leave
// orders behind that would inflate the counters across reruns. We
// wipe only e2e-prefixed users, same guard as resetBillsForUser, so
// production data is untouched.
//
// Returns the seeded order ids + bill id for callers that want to
// assert deeper than the rendered KPIs.
export type DashboardSnapshot = {
  submittedOrderIds: string[];
  urgentOrderId: string;
  completedOrderIds: string[];
  shippedOrderId: string;
  billId: string;
  monthlyTotal: string; // 5000.00
  monthlyPaid: string; // 2000.00
};

export async function seedDashboardSnapshot(opts: {
  // 业绩归属：bill 的销售人。e2e-sales 是 globalSetup 建好的固定 SALES 用户。
  salesUserId: string;
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

  return withDb(async (db) => {
    // Step 1: wipe ALL orders + bills owned by e2e-* users so prior
    // runs / parallel specs don't inflate global counters.
    // Bills first (BillItem → Bill RESTRICT), then Orders.
    await db.query(
      `DELETE FROM "BillItem" WHERE "billId" IN (
         SELECT b.id FROM "Bill" b
         JOIN "User" u ON u.id = b."salesUserId"
         WHERE u.username LIKE 'e2e-%'
       )`,
    );
    await db.query(
      `DELETE FROM "Bill" WHERE "salesUserId" IN (
         SELECT id FROM "User" WHERE username LIKE 'e2e-%'
       )`,
    );
    await db.query(
      `DELETE FROM "Order" WHERE "submitterId" IN (
         SELECT id FROM "User" WHERE username LIKE 'e2e-%'
       )`,
    );

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
          id, "orderNo", "submitterId", "submitterRole", "createdById",
          status, "isUrgent", "totalAmount",
          "submittedAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 'SALES'::"Role", $3,
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
          id, "orderNo", "submitterId", "submitterRole", "createdById",
          status, "isUrgent", "totalAmount",
          "submittedAt", "scheduledAt", "completedAt",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 'SALES'::"Role", $3,
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
        id, "orderNo", "submitterId", "submitterRole", "createdById",
        status, "isUrgent", "totalAmount",
        "submittedAt", "scheduledAt", "completedAt", "shippedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, 'E2E-DASH-SHIPPED-1', $2, 'SALES'::"Role", $2,
        'SHIPPED'::"OrderStatus", FALSE, 0,
        $3, $3, $3, $3,
        $3, $3
      )
      `,
      [shippedOrderId, opts.salesUserId, todayShanghaiNoonUtc.toISOString()],
    );

    // Step 3: seed one bill in the current Shanghai month.
    // 5000 总额 / 2000 已收 → outstanding 3000；UI 显示三个数字时都好认。
    const billId = `e2e-dash-bill-${randomBytes(4).toString('hex')}`;
    const monthlyTotal = '5000.00';
    const monthlyPaid = '2000.00';
    await db.query(
      `
      INSERT INTO "Bill" (
        id, "salesUserId", period, "totalAmount", "paidAmount",
        status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'DRAFT'::"BillStatus", NOW(), NOW()
      )
      `,
      [billId, opts.salesUserId, period, monthlyTotal, monthlyPaid],
    );

    return {
      submittedOrderIds,
      urgentOrderId: 'e2e-dash-sub-3-urgent',
      completedOrderIds,
      shippedOrderId,
      billId,
      monthlyTotal,
      monthlyPaid,
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

// Stamps a cuid-shaped suffix onto identifiers so reruns against the
// shared dev DB don't collide on uniques (orderNo is generated server-
// side, but customerRef and free-text fields could).
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Logs out the currently signed-in user via the header LogoutButton
// and waits to land on /login. Used by multi-role flow tests where the
// same browser context switches between SALES → FOREMAN → WORKER →
// OWNER. We click the form's submit button rather than fetch the
// signOut endpoint directly so we exercise the same path users do.
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /退出登录/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/login'), {
    timeout: 10_000,
  });
}

// Defensive assertion: when a Server Action errors, Next dev throws an
// in-page error dialog. We check for the actual error dialog (not the
// `<nextjs-portal>` shell which is present on every dev page for the
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
