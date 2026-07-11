import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listCrafts } from '@/lib/craft';
import { CraftsTable } from '@/components/business/craft/CraftsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '工艺字典 · 红包印刷 ERP',
};

export default async function CraftsListPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('dict:craft:manage');
  const crafts = await listCrafts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="工艺字典"
        subtitle="管理工艺清单（SPEC §6.1）。外协工艺不生成内部生产任务，只进外协单。停用只影响新录工单，历史工单记录保留。"
        actions={
          <Link href="/owner/crafts/new" className={buttonVariants()}>
            新建工艺
          </Link>
        }
      />
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <CraftsTable crafts={crafts} />
      </div>
    </div>
  );
}
