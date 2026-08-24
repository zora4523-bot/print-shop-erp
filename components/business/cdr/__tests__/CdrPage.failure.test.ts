import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CDR recent bundle failure recovery', () => {
  it('shows safe failure guidance and offers regeneration for failed bundles', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', '(admin)', 'foreman', 'cdr', 'page.tsx'),
      'utf8',
    );
    const failedBranch = source.match(
      /b\.status === DesignBundleStatus\.FAILED[\s\S]*?\) : expired \?/,
    )?.[0];

    expect(failedBranch).toBeDefined();
    expect(failedBranch).toMatch(
      /<BundleFailureMessage\s+errorCode=\{b\.lastErrorCode\}/,
    );
    expect(failedBranch).toContain(
      '<RegenerateBundleForm {...regenerateProps} />',
    );
  });
});
