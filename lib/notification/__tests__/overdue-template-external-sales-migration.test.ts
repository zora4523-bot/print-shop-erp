import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260927100000_order_overdue_template_external_sales/migration.sql',
  ),
  'utf8',
);
const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');

// 客户自 2026-09-13 起不再录入：交期逾期默认模板改为外部销售（DECISIONS 2026-09-27）。
describe('order overdue template external salesperson migration', () => {
  it('rewrites only the exact historical default and preserves custom templates', () => {
    expect(migration).toContain(`"eventType" = 'ORDER_OVERDUE'`);
    expect(migration).toContain(
      `"messageTemplate" = E'🚚 **交期逾期**\\n工单：{orderNo}\\n客户：{customerRef}`,
    );
    expect(migration).not.toMatch(/WHERE\s+"eventType"\s*=\s*'ORDER_OVERDUE'\s*;/u);
  });

  it('points the default at the external salesperson, matching the seed', () => {
    expect(migration).toContain('外部销售：{externalSalesName}');
    expect(seed).toContain(
      "'🚚 **交期逾期**\\n工单：{orderNo}\\n外部销售：{externalSalesName}\\n承诺交期：{promisedDate}\\n已逾期：{daysOverdue} 天\\n当前状态：{status}'",
    );
    expect(seed).not.toContain('客户：{customerRef}');
  });
});
