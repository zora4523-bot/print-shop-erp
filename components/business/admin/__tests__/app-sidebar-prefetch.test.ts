import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AppSidebar navigation feedback', () => {
  it('prefetches only the route with user intent and exposes pending state', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components/business/admin/AppSidebar.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('useLinkStatus');
    expect(source).toContain(
      'prefetch={intentHref === item.href ? null : false}',
    );
    expect(source).toContain('onMouseEnter={() => setIntentHref(item.href)}');
    expect(source).toContain('onFocus={() => setIntentHref(item.href)}');
    expect(source).toContain('onTouchStart={() => setIntentHref(item.href)}');
    expect(source).toContain('<SidebarLinkPendingIndicator />');
  });
});
