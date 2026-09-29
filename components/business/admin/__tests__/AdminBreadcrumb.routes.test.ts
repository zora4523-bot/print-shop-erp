import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBreadcrumbCrumbs } from '../AdminBreadcrumb';

// 审查 #24：遍历管理端外壳下所有 page 路由，面包屑不得出现「页面」这类
// 无意义占位、不得有空段；可点击祖先必须真有 page（或 redirect 别名）。
const APP_DIR = path.resolve(__dirname, '../../../../app');
const SHELL_GROUPS = ['(admin)', '(admin-forms)', '(billing)'];
const SAMPLE_ID = 'cmey8k3s10000abcdefghijkl';

function collectPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name.startsWith('_')) continue;
      collectPages(full, out);
    } else if (name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

function toRoute(file: string): string {
  const rel = path.relative(APP_DIR, path.dirname(file));
  const parts = rel
    .split(path.sep)
    .filter((part) => !(part.startsWith('(') && part.endsWith(')')));
  return '/' + parts.join('/');
}

function samplePath(route: string): string {
  return route.replace(/\[event\]/g, 'ORDER_SUBMITTED').replace(/\[[^\]]+\]/g, SAMPLE_ID);
}

const pageFiles = SHELL_GROUPS.flatMap((group) => collectPages(path.join(APP_DIR, group)));
const routes = pageFiles.map(toRoute).sort();
const routePatterns = routes.map(
  (route) => new RegExp('^' + route.replace(/\[[^\]]+\]/g, '[^/]+') + '$'),
);

function hasPage(href: string): boolean {
  return routePatterns.some((pattern) => pattern.test(href));
}

describe('AdminBreadcrumb × app 路由', () => {
  it('找到了管理端路由', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it.each(routes)('%s 的面包屑无占位、祖先可达', (route) => {
    const crumbs = buildBreadcrumbCrumbs(samplePath(route));
    expect(crumbs.length).toBeGreaterThan(0);
    for (const crumb of crumbs) {
      expect(crumb.label.trim()).not.toBe('');
      expect(crumb.label).not.toBe('页面');
      expect(crumb.label).not.toMatch(/^[a-z0-9-]+$/i);
      if (!crumb.isLast && crumb.linkable) {
        expect(hasPage(crumb.href), `${crumb.href} 可点击但没有 page`).toBe(true);
      }
    }
  });

  it('redirect 别名页确实是 redirect', () => {
    const billsAlias = pageFiles.find((file) => toRoute(file) === '/owner/bills');
    expect(billsAlias && readFileSync(billsAlias, 'utf8')).toContain('redirect(');
  });
});

describe('路由 loading 形状（审查 #26）', () => {
  const secondary = /\/(\[[^\]]+\]|new|edit|count)$/;

  it('(admin) 下每个详情 / 表单段自带 loading.tsx，不继承列表表格骨架', () => {
    const missing = collectPages(path.join(APP_DIR, '(admin)'))
      .map((file) => path.dirname(file))
      .filter((dir) => secondary.test(dir.split(path.sep).join('/')))
      .filter((dir) => !readdirSync(dir).includes('loading.tsx'));
    expect(missing).toEqual([]);
  });

  it.each(['(billing)', '(admin-forms)'])('%s 零 JS 组刻意没有 loading.tsx', (group) => {
    const withLoading = collectPages(path.join(APP_DIR, group))
      .map((file) => path.dirname(file))
      .filter((dir) => readdirSync(dir).includes('loading.tsx'));
    expect(withLoading).toEqual([]);
    expect(readdirSync(path.join(APP_DIR, group))).not.toContain('loading.tsx');
  });
});
