import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('root error recovery contracts', () => {
  it('provides a route fallback for paths outside the admin and worker groups', () => {
    const routeError = source('app/error.tsx');

    expect(routeError).toMatch(/^'use client';/);
    expect(routeError).toContain('unstable_retry');
    expect(routeError).toContain('scope="page"');
    expect(routeError).toContain('返回系统首页');
    expect(routeError).not.toContain('{error.message}');
  });

  it('provides a self-contained global fallback for root-layout failures', () => {
    const globalError = source('app/global-error.tsx');

    expect(globalError).toMatch(/^'use client';/);
    expect(globalError).toContain("import './globals.css'");
    expect(globalError).toContain('<html lang="zh-CN">');
    expect(globalError).toContain('<body');
    expect(globalError).toContain('unstable_retry');
    expect(globalError).not.toContain('{error.message}');
  });
});
