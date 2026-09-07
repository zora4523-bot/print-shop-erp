import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('admin business copy contract', () => {
  it('Dashboard 不展示原始状态和重复入口名', () => {
    const dashboard = source('app/(admin)/owner/page.tsx');
    const charts = source(
      'components/business/dashboard/DashboardChartsContent.tsx',
    );

    expect(dashboard).not.toContain('label="建单产品"');
    expect(dashboard).not.toContain('建单产品 / 规格');
    expect(dashboard).not.toContain('periodEnd ·');
    expect(charts).not.toContain('COMPLETED / SHIPPED / FINISHED');
    expect(charts).not.toContain('SALES 蓝色');
  });

  it('账单和工资页使用业务名称而非原始枚举或人员 ID', () => {
    const bills = source('app/(admin)/owner/agent-bills/page.tsx');
    const billDetail = source(
      'app/(admin)/owner/agent-bills/[id]/page.tsx',
    );
    const salary = source('app/(admin)/owner/salary/page.tsx');
    const hourly = source('app/(admin)/owner/salary/hourly/page.tsx');

    expect(bills).not.toContain('销售 / 客服 id');
    expect(bills).not.toContain('ISSUED / PARTIAL_PAID / FULLY_PAID');
    expect(billDetail).toContain('仅展示入账时快照；确认后不重算、不覆写。');
    expect(billDetail).not.toContain('该金额用于解释');
    expect(salary).not.toContain('hint="每位客服一条 IN_PROGRESS"');
    expect(salary).not.toContain('hint="periodEnd 已过"');
    expect(hourly).not.toContain('师傅 id（选填）');
    expect(hourly).not.toContain('PACKER / CLEANER / COOK');
  });

  it('采购取消确认直接陈述业务前置条件', () => {
    const cancelPurchase = source(
      'components/business/purchase/CancelPurchaseOrderButton.tsx',
    );

    expect(cancelPurchase).toContain('已有收货明细时不可取消');
    expect(cancelPurchase).not.toContain('若服务器发现');
  });

  it('通知页只展示业务事件名和测试后果', () => {
    const page = source('app/(admin)/owner/notifications/page.tsx');
    const testButton = source(
      'components/business/notification/TestChannelButton.tsx',
    );
    const actions = source('actions/owner-notifications.ts');

    expect(page).toContain('notificationEventLabel(r.eventType)');
    expect(page).toContain('notificationEventLabel(log.eventType)');
    expect(page).not.toContain('<th className="px-3 py-2 text-left">channelKey</th>');
    expect(page).not.toContain('NotificationLog 仍然记录');
    expect(testButton).not.toContain('未发起真实 HTTP 请求');
    expect(actions).not.toContain('该 channelKey 已被占用');
    expect(actions).not.toContain('isActive=false');
    expect(actions).not.toContain('err.invalidIds.join');
    expect(actions).not.toContain('err.inactiveIds.join');
  });

  it('考勤与师傅任务不回显未知岗位或机型标识', () => {
    const attendance = source('app/(admin)/foreman/attendance/page.tsx');
    const workerTasks = source('app/(worker)/worker/tasks/page.tsx');
    const workerTaskDetail = source(
      'app/(worker)/worker/tasks/[id]/page.tsx',
    );

    expect(attendance).toContain('workerTypeLabel(selectedWorker.workerType)');
    expect(attendance).toContain('workerTypeLabel(w.workerType)');
    expect(attendance).not.toContain('?? w.workerType');
    expect(workerTasks).toContain('OPERATION_LABELS[operation.operationType]');
    expect(workerTasks).toContain('step.craftName');
    expect(workerTasks).not.toContain('task.workerType');
    expect(workerTasks).not.toContain('task.machineType');
    expect(workerTaskDetail).toContain('此记录来自旧派工流程，仅供查阅');
    expect(workerTaskDetail).not.toContain('task.machineType');
  });
});
