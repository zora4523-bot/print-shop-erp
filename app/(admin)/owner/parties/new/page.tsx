import Link from 'next/link';
import { createPartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建客户/供应商 · 红包印刷 ERP',
};

export default async function NewOwnerPartyPage() {
  await requirePermission('party:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建客户/供应商"
        subtitle="编码用于搜索和工单客户代号；联系人和默认地址会在新建工单时自动带入快照字段。"
        actions={
          <Link
            href="/owner/parties"
            className={buttonVariants({ variant: 'outline' })}
          >
            返回列表
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PartyForm mode="create" action={createPartyAction} />
      </section>
    </div>
  );
}
