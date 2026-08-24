import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';

const testClientIpByPage = new WeakMap<Page, string>();

function createDocumentationRangeIp(): string {
  const bytes = randomBytes(12);
  const groups = Array.from({ length: 6 }, (_, index) =>
    bytes.readUInt16BE(index * 2).toString(16),
  );
  // 2001:db8::/32 is reserved for documentation. Two fixed groups plus six
  // generated groups form a syntactically complete eight-group IPv6 address.
  return `2001:db8:${groups.join(':')}`;
}

/**
 * The local E2E server is reached directly, without the production reverse
 * proxy that normally supplies X-Real-IP. Without this header every Playwright
 * context collapses into the production limiter's `unresolved-client` bucket,
 * so unrelated specs rate-limit one another after six successful logins.
 *
 * Give each isolated browser page one stable address from RFC 3849's
 * documentation range. Multiple logins inside a single test still share one
 * bucket and therefore still exercise the real limiter; independent tests no
 * longer share security state accidentally.
 */
export async function isolateE2eLoginClient(page: Page): Promise<void> {
  let address = testClientIpByPage.get(page);
  if (!address) {
    address = createDocumentationRangeIp();
    testClientIpByPage.set(page, address);
  }
  await page.setExtraHTTPHeaders({ 'x-real-ip': address });
}
