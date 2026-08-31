import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CDR recent bundle failure recovery', () => {
  it('isolates eligibility from recent-history failures', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', '(admin)', 'foreman', 'cdr', 'page.tsx'),
      'utf8',
    );
    const eligibleSection = source.match(
      /export async function CdrEligibleOrdersSection[\s\S]*?export async function CdrRecentBundlesSection/,
    )?.[0];
    const historySection = source.match(
      /export async function CdrRecentBundlesSection[\s\S]*?function CdrSectionLoading/,
    )?.[0];

    expect(source).not.toContain('await Promise.all([');
    expect(source.match(/listEligibleOrders\(\{ from, to \}\)/g)).toHaveLength(1);
    expect(source.match(/listRecentBundles\(20\)/g)).toHaveLength(1);
    expect(source.match(/<ErrorBoundary/g)).toHaveLength(2);
    expect(source.match(/<Suspense/g)).toHaveLength(2);
    expect(eligibleSection).toContain('await eligibleOrdersPromise');
    expect(eligibleSection).not.toContain('recentBundlesPromise');
    expect(historySection).toContain('await recentBundlesPromise');
    expect(historySection).not.toContain('eligibleOrdersPromise');
  });

  it('shows safe failure guidance and offers regeneration for failed bundles', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', '(admin)', 'foreman', 'cdr', 'page.tsx'),
      'utf8',
    );
    const failedBranch = source.match(
      /bundle\.status === DesignBundleStatus\.FAILED[\s\S]*?\) : expired \?/,
    )?.[0];

    expect(failedBranch).toBeDefined();
    expect(failedBranch).toMatch(
      /<BundleFailureMessage\s+errorCode=\{bundle\.lastErrorCode\}/,
    );
    expect(failedBranch).toContain(
      '<RegenerateBundleForm {...regenerateProps} />',
    );
  });
});
