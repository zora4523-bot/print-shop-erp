import { expect, type Page } from '@playwright/test';

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
