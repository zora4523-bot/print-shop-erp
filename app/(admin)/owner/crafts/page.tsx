import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listCrafts } from '@/lib/craft';
import { CraftsTable } from '@/components/business/craft/CraftsTable';

export const metadata = {
  title: '工艺字典 · 红包印刷 ERP',
};

export default async function CraftsListPage() {
  const crafts = await listCrafts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">工艺字典</h1>
          <p className="text-sm text-muted-foreground">
            管理工艺清单（SPEC §6.1）。外协工艺不生成内部生产任务，只进外协单。
            停用只影响新录工单，历史工单记录保留。
          </p>
        </div>
        <Link href="/owner/crafts/new" className={buttonVariants()}>
          新建工艺
        </Link>
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <CraftsTable crafts={crafts} />
      </div>
    </div>
  );
}
