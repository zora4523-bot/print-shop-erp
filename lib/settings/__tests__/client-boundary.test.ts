import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('设置页客户端依赖边界', () => {
  it('SettingsForm 只引用无 Zod 的客户端元数据', () => {
    const form = source('components/business/setting/SettingsForm.tsx');
    const metadata = source('lib/settings/metadata.ts');

    expect(form).toMatch(/from ['"]@\/lib\/settings\/metadata['"]/);
    expect(form).not.toMatch(/settings\/definitions|from ['"]zod['"]/);
    expect(metadata).not.toMatch(/from ['"]zod['"]|from ['"]server-only['"]/);
  });
});

describe('侧栏客户端依赖边界', () => {
  it('不为全仓零使用的子组件引入重依赖', () => {
    const sidebar = source('components/ui/sidebar.tsx');

    expect(sidebar).not.toMatch(
      /@\/components\/ui\/(?:input|separator|skeleton)/,
    );
    expect(sidebar).not.toMatch(
      /\b(?:SidebarInput|SidebarSeparator|SidebarMenuSkeleton)\b/,
    );
  });
});
