import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AppSidebar navigation feedback', () => {
  it('prefetches only after sustained mouse intent', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components/business/admin/AppSidebar.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('useLinkStatus');
    expect(source).toContain(
      'prefetch={intentHref === item.href ? true : false}',
    );
    expect(source).toContain('IntentPrefetchScheduler');
    expect(source).toContain('onEnter={scheduleIntentPrefetch}');
    expect(source).toContain('onLeave={cancelIntentPrefetch}');
    expect(source).toContain('onEnter(item.href)');
    expect(source).toContain('onMouseLeave');
    expect(source).not.toContain('onFocus');
    expect(source).not.toContain('onTouchStart');
    expect(source).toContain('<SidebarLinkPendingIndicator />');
  });

  it('persists collapsible navigation groups across browser sessions', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components/business/admin/AppSidebar.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY');
    expect(source).toContain('window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY');
    expect(source).toContain('aria-expanded={!hideItems}');
    expect(source).toContain(
      '.filter((group) => group.items.length > 0)',
    );
    expect(source).toContain('未上线');
    expect(source).not.toContain('window.sessionStorage');
  });

  it('renders rule modules as accessible child navigation', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components/business/admin/AppSidebar.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<SidebarMenuSub');
    expect(source).toContain('<SidebarMenuSubItem data-menu-level="child">');
    expect(source).toContain('<SidebarMenuSubButton');
    expect(source).toContain("aria-current={active ? 'page' : undefined}");
    expect(source).toContain('data-has-active-child');
    expect(source).toContain('aria-controls={contentId}');
  });

  it('keeps icon-only navigation vertically scrollable', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'components/ui/sidebar.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'group-data-[collapsible=icon]:overflow-y-auto',
    );
    expect(source).not.toContain(
      'group-data-[collapsible=icon]:overflow-hidden',
    );
  });
});
