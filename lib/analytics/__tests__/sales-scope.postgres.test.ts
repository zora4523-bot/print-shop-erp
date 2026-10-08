import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { db } from '@/lib/db';
import { parseAnalyticsFilters } from '../filters';
import { analyticsCsv } from '../export';
import { getAnalyticsOverview } from '../overview';
import { getAnalyticsReport } from '../service';
import { getAnalyticsSales, getAnalyticsTrend } from '../queries';

const url = process.env.DATABASE_URL;
const isolated = !!url && url === process.env.E2E_DATABASE_URL &&
  new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE &&
  /_e2e_/.test(new URL(url).pathname);
const pg = isolated ? describe : describe.skip;
const prefix = `analytics_${randomUUID()}`;
const admin = { id: `${prefix}_admin`, role: 'ADMIN' as const };
const sales = `${prefix}_sales`;
const other = `${prefix}_other`;
const day = new Date('2026-06-15T04:00:00Z');
const filters = parseAnalyticsFilters({ view: 'orders', from: '2026-06-15', to: '2026-06-15', sales });

// 所有记录使用本测试前缀，数据库必须是显式确认的独立测试库。
pg('analytics sales attribution · real PostgreSQL', () => {
  beforeAll(async () => {
    await db.user.createMany({ data: [
      { id: admin.id, username: admin.id, displayName: '代建管理员', role: 'ADMIN', password: 'not-a-login-hash' },
      { id: sales, username: sales, displayName: '原单销售', role: 'SALES', password: 'not-a-login-hash' },
      { id: other, username: other, displayName: '其他销售', role: 'SALES', password: 'not-a-login-hash' },
    ] });
    const original = await db.order.create({ data: {
      orderNo: `${prefix}_original`, customName: `${prefix}_原单`, submitterId: sales,
      createdById: admin.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES',
      submittedAt: day, completedAt: day, status: 'COMPLETED', processingAmount: '100', totalAmount: '100',
    } });
    await db.order.create({ data: {
      orderNo: `${prefix}_rework`, customName: `${prefix}_免费重做`, submitterId: admin.id,
      createdById: admin.id, submitterRole: 'ADMIN', sourceOrderId: original.id, kind: 'REWORK',
      settlementType: 'NO_CHARGE', billingMode: 'NO_CHARGE', submittedAt: day,
      completedAt: day, status: 'COMPLETED', processingAmount: '0',
    } });
    await db.order.create({ data: {
      orderNo: `${prefix}_other`, customName: `${prefix}_其他销售工单`, submitterId: other,
      createdById: admin.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES',
      submittedAt: day, completedAt: day, status: 'COMPLETED', processingAmount: '999', totalAmount: '999',
    } });
    await db.order.createMany({ data: [
      {
        orderNo: `${prefix}_cancelled`, customName: `${prefix}_已取消重做`, submitterId: admin.id,
        createdById: admin.id, submitterRole: 'ADMIN', sourceOrderId: original.id, kind: 'REWORK',
        settlementType: 'NO_CHARGE', billingMode: 'NO_CHARGE', status: 'CANCELLED',
        submittedAt: day, completedAt: day,
      },
      {
        orderNo: `${prefix}_later`, customName: `${prefix}_跨日重做`, submitterId: admin.id,
        createdById: admin.id, submitterRole: 'ADMIN', sourceOrderId: original.id, kind: 'REWORK',
        settlementType: 'NO_CHARGE', billingMode: 'NO_CHARGE', status: 'COMPLETED',
        submittedAt: new Date('2026-06-16T04:00:00Z'), completedAt: new Date('2026-06-17T04:00:00Z'),
      },
    ] });
  });

  it('includes administrator-created free reworks in detail, overview, trend and export', async () => {
    const report = await getAnalyticsReport(admin, filters, true);
    expect(report.total).toBe(2);
    expect(report.details.rows.map(row => row[1].value)).toEqual(['原单销售', '原单销售']);
    expect(report.metrics[1].value).toBe('100.00');
    const csv = analyticsCsv(report, filters);
    expect(csv).toContain(`${prefix}_免费重做`);
    expect(csv).not.toContain(`${prefix}_其他销售工单`);
    expect(csv).not.toContain(`${prefix}_已取消重做`);
    const overview = await getAnalyticsOverview(admin, { ...filters, view: 'overview' });
    expect(overview.metrics[0].value).toBe('2');
    expect(overview.metrics[3].value).toBe('1');
    expect(overview.ranking).toMatchObject([{ name: '原单销售', count: 1 }]);
    expect(await getAnalyticsTrend(admin, filters)).toEqual([{ day: '2026-06-15', count: 2, submitted: 2 }]);
  });

  it('intersects keyword and sales filters and does not interpret SQL-like sales text', async () => {
    const selected = await getAnalyticsReport(admin, { ...filters, q: '免费重做' });
    expect(selected.total).toBe(1);
    const injected = { ...filters, sales: `${sales}' OR TRUE --` };
    expect((await getAnalyticsReport(admin, injected)).total).toBe(0);
    expect((await getAnalyticsOverview(admin, injected)).metrics[0].value).toBe('0');
    expect(await getAnalyticsTrend(admin, injected)).toEqual([{ day: '2026-06-15', count: 0, submitted: 0 }]);
  });

  it('rejects a sales actor before reading analytics', async () => {
    await expect(getAnalyticsReport({ id: sales, role: 'SALES' }, filters)).rejects.toThrow('无权');
  });

  it('销售选项包含销售账号并排除代建管理员', async () => {
    const options = await getAnalyticsSales(admin);
    expect(options.map(option => option.id)).toEqual(expect.arrayContaining([sales, other]));
    expect(options.map(option => option.id)).not.toContain(admin.id);
  });

  it('uses each rework event date even when its source order was submitted outside the range', async () => {
    const submitted = { ...filters, from: '2026-06-16', to: '2026-06-16' };
    const completed = { ...filters, from: '2026-06-17', to: '2026-06-17' };
    expect((await getAnalyticsReport(admin, submitted)).total).toBe(1);
    expect((await getAnalyticsOverview(admin, submitted)).metrics[0].value).toBe('1');
    expect(await getAnalyticsTrend(admin, submitted)).toEqual([{ day: '2026-06-16', count: 0, submitted: 1 }]);
    expect((await getAnalyticsReport(admin, completed)).total).toBe(0);
    expect(await getAnalyticsTrend(admin, completed)).toEqual([{ day: '2026-06-17', count: 1, submitted: 0 }]);
  });
});
