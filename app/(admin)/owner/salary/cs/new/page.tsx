import { listActiveCsUsers } from '@/lib/salary/cs';
import { StartCsPeriodForm } from '@/components/business/salary/StartCsPeriodForm';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = { title: '新建客服周期' };

export default async function NewCsPeriodPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:rule:manage');
  const csUsers = await listActiveCsUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">新建客服周期</h1>
        <p className="text-sm text-muted-foreground">
          新客服开户时同时创建首个周期；导入历史数据时，可在&ldquo;期初业绩&rdquo;填写已累计金额。
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <StartCsPeriodForm csUsers={csUsers} />
      </div>
    </div>
  );
}
