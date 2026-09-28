import { readSupplementContext, supplementReturnHref } from '@/lib/form-drafts/return-context';
import { SupplementOwnership } from '@/components/business/form-drafts/FormDraftControls';
import Link from 'next/link';
import { PartyType } from '@/generated/prisma/enums';
import { createPartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建客户/供应商',
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PURCHASE_RETURN_TO = '/owner/purchases/new' as const;

function parseInitialType(value: string): PartyType {
  return Object.values(PartyType).includes(value as PartyType)
    ? (value as PartyType)
    : PartyType.CUSTOMER;
}

export default async function NewOwnerPartyPage({ searchParams }: PageProps) {
  const actor = await requirePermission('party:manage');
  const query = await searchParams;
  const rawContext = readSupplementContext(query);
  const supplement = rawContext?.entityType === 'SUPPLIER' ? rawContext : null;
  if (supplement) await requirePermission('purchase:manage');
  const initialType = parseInitialType(firstSearchParam(query.type));
  const returnTo =
    firstSearchParam(query.returnTo) === PURCHASE_RETURN_TO
      ? PURCHASE_RETURN_TO
      : undefined;
  const backHref = supplement ? supplementReturnHref(supplement) : returnTo ?? '/owner/parties';

  return (
    <div className="space-y-6">
      <SupplementOwnership actorId={actor.id} context={supplement} />
      <PageHeader
        title="新建客户/供应商"
        actions={
          <Link
            href={backHref}
            className={buttonVariants({ variant: 'outline' })}
          >
            {supplement ? '返回原录入' : returnTo ? '返回采购单' : '返回列表'}
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PartyForm
          mode="create"
          action={createPartyAction}
          initialType={initialType}
          returnTo={returnTo}
          supplement={supplement}
        />
      </section>
    </div>
  );
}
