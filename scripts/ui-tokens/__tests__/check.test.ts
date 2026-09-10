import { describe, expect, it } from 'vitest';
import { inspectFile, scan } from '../check.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rules = (file: string, source: string) => inspectFile(file, source).map((h) => h.rule);

describe('ui token / money gate', () => {
  it('flags raw colour literals in tsx and css', () => {
    expect(rules('components/business/x.tsx', 'const c = "#a8121a";')).toEqual(['color']);
    expect(rules('components/business/x.module.css', '.a { color: rgb(0 0 0 / 28%); }')).toEqual(['color']);
    expect(rules('components/business/x.tsx', 'style={{ color: "oklch(0.5 0.2 25)" }}')).toEqual(['color']);
  });

  it('ignores hash fragments, routes and comments', () => {
    expect(rules('app/page.tsx', 'href="/orders#abc123"')).toEqual([]);
    expect(rules('app/page.tsx', '// 品牌红 #a8121a 见 globals.css')).toEqual([]);
    expect(rules('app/page.tsx', 'const id = `${base}#section-2`;')).toEqual([]);
  });

  it('flags inline money formatting but allows quantity thousands separators', () => {
    expect(rules('app/page.tsx', '{amount.toFixed(2)}')).toEqual(['money']);
    expect(rules('app/page.tsx', "new Intl.NumberFormat('zh-CN', { style: 'currency' })")).toEqual(['money']);
    expect(rules('app/page.tsx', "value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })")).toEqual(['money']);
    expect(rules('components/business/x.tsx', 'const money = (v: string) => `¥${v}`;')).toEqual(['money']);
    expect(rules('app/page.tsx', '<td>¥ {row.amount}</td>')).toEqual(['money']);
    expect(rules('app/page.tsx', 'hint={`合计 ¥${total}`}')).toEqual(['money']);
    expect(rules('app/page.tsx', '{formatMoney(row.amount)}')).toEqual([]);
    expect(rules('app/page.tsx', "{item.quantity.toLocaleString('zh-CN')} 个")).toEqual([]);
    // 文件大小 / 百分比不是金额形态
    expect(rules('app/page.tsx', '`${(size / 1024).toFixed(1)} MB`')).toEqual([]);
  });

  it('treats permanent exemptions as silent, baseline entries as warnings, and both as stale when gone', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ui-tokens-'));
    mkdirSync(path.join(root, 'app'));
    writeFileSync(path.join(root, 'app', 'a.tsx'), 'const c = "#a8121a";\nconst m = v.toFixed(2);\n');
    const baseline = {
      entries: [{ rule: 'money', file: 'app/a.tsx', text: 'const m = v.toFixed(2);', count: 1 }],
      permanent: [{ rule: 'color', file: 'app/a.tsx', text: 'const c = "#a8121a";', count: 1, reason: '测试用材料色' }],
    };
    const result = scan(root, baseline);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w: { rule: string }) => w.rule)).toEqual(['money']);
    expect(result.stale).toEqual([]);
    const gone = scan(root, { entries: [], permanent: [{ ...baseline.permanent[0], text: 'const c = "#ffffff";' }] });
    expect(gone.errors.map((e: { rule: string }) => e.rule).sort()).toEqual(['color', 'money']);
    expect(gone.stale).toHaveLength(1);
    expect(() => scan(root, { entries: [], permanent: [{ rule: 'color', file: 'app/a.tsx', text: 'x' }] })).toThrow(/reason/);
  });

  it('flags deep imports of ui-business internals', () => {
    expect(rules('components/business/x.tsx', "import { ActionNotice } from '@/components/ui-business/ActionNotice';")).toEqual(['deep']);
    expect(rules('components/business/x.tsx', "import { ActionNotice } from '@/components/ui-business';")).toEqual([]);
  });
});
