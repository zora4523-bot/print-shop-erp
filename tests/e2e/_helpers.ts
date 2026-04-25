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

// Wipes E2E bill / billItem / order rows owned by the given user.
// Used by bill-flow E2E to keep each run independent —
// generateBillsForPeriod upserts per-(salesUser, period) so prior
// runs leave aggregated state that would otherwise bleed across runs
// (totalAmount keeps growing, status moves past DRAFT, generate then
// errors out).
//
// Scoping is strict: ONLY rows tied to E2E-prefixed orders. Codex
// round 79 / P1: the earlier version's Bill DELETE used only
// salesUserId and would wipe non-E2E bills the same user might have
// from manual testing. This version drops items whose order is E2E,
// then drops bills that consequently have zero items remaining.
//
// Order matters: BillItem fk → Bill / Order, so we go BillItem first,
// then orphan Bills, then E2E Orders.
export async function resetBillsForUser(userId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `DELETE FROM "BillItem"
         WHERE "orderId" IN (
           SELECT id FROM "Order"
            WHERE "submitterId" = $1 AND "orderNo" LIKE 'E2E-%'
         )`,
      [userId],
    );
    // Bills that lost ALL their items because of the delete above are
    // pure E2E bills — safe to drop. Bills with surviving items are
    // mixed (real + E2E) or pure-real and stay intact.
    await db.query(
      `DELETE FROM "Bill"
         WHERE "salesUserId" = $1
           AND NOT EXISTS (
             SELECT 1 FROM "BillItem" WHERE "billId" = "Bill".id
           )`,
      [userId],
    );
    await db.query(
      `DELETE FROM "Order" WHERE "submitterId" = $1 AND "orderNo" LIKE 'E2E-%'`,
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
