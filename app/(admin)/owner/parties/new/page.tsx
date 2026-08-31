import Link from 'next/link';
import { PartyType } from '@/generated/prisma/enums';
import { createPartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建客户/供应商 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    type?: string | string[];
    returnTo?: string | string[];
  }>;
};

const PURCHASE_RETURN_TO = '/owner/purchases/new' as const;

function parseInitialType(value: string): PartyType {
  return Object.values(PartyType).includes(value as PartyType)
    ? (value as PartyType)
    : PartyType.CUSTOMER;
}

export default async function NewOwnerPartyPage({ searchParams }: PageProps) {
  await requirePermission('party:manage');
  const query = await searchParams;
  const initialType = parseInitialType(firstSearchParam(query.type));
  const returnTo =
    firstSearchParam(query.returnTo) === PURCHASE_RETURN_TO
      ? PURCHASE_RETURN_TO
      : undefined;
  const backHref = returnTo ?? '/owner/parties';

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建客户/供应商"
        actions={
          <Link
            href={backHref}
            className={buttonVariants({ variant: 'outline' })}
          >
            {returnTo ? '返回采购单' : '返回列表'}
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PartyForm
          mode="create"
          action={createPartyAction}
          initialType={initialType}
          returnTo={returnTo}
        />
      </section>
    </div>
  );
}
