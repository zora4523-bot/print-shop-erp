import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import { StartCsPeriodForm } from '@/components/business/salary/StartCsPeriodForm';

export const metadata = { title: '新建客服周期' };

export default async function NewCsPeriodPage() {
  const csUsers = await db.user.findMany({
    where: { role: Role.CUSTOMER_SERVICE, isActive: true },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, username: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">新建客服周期</h1>
        <p className="text-sm text-muted-foreground">
          新客服开户同时创建首个周期；历史导入（SPEC §5.5）时填&ldquo;期初业绩&rdquo;把已累计金额塞入。
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <StartCsPeriodForm csUsers={csUsers} />
      </div>
    </div>
  );
}
