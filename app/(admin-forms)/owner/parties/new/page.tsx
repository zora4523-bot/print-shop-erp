import { readSupplementContext, supplementReturnHref } from '@/lib/form-drafts/return-context';
import { SupplementOwnership } from '@/components/business/form-drafts/FormDraftControls';
import { PartyType } from '@/generated/prisma/enums';
import { createPartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { FormPage } from '@/app/_components/FormPage';
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
  // 返回客户/供应商列表由面包屑父级承担；只有回到别的录入（原录入、新建采购单）才保留页头返回。
  const back = supplement
    ? { href: supplementReturnHref(supplement), label: '返回原录入' }
    : returnTo
      ? { href: returnTo, label: '返回新建采购单' }
      : undefined;

  return (
    <FormPage>
      <SupplementOwnership actorId={actor.id} context={supplement} />
      <PageHeader
        title="新建客户/供应商"
        back={back}
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
    </FormPage>
  );
}
