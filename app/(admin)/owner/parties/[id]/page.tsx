import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { readSupplementContext, supplementReturnHref } from '@/lib/form-drafts/return-context';
import { SupplementOwnership } from '@/components/business/form-drafts/FormDraftControls';
import { notFound } from 'next/navigation';
import { updatePartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { TogglePartyActiveButton } from '@/components/business/party/TogglePartyActiveButton';
import { PageHeader, ReceiptNotice } from '@/components/ui-business';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import { FormPage } from '@/app/_components/FormPage';
import { readReceipt } from '@/lib/admin/receipt';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getPartySummary,
  PARTY_TYPE_LABELS,
} from '@/lib/party';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const party = await getPartySummary(id);
  return {
    title: party ? `编辑 ${party.name} · 客户/供应商` : '客户/供应商不存在',
  };
}

export default async function EditOwnerPartyPage({ params, searchParams }: PageProps) {
  const actor = await requirePermission('party:manage');
  const query = await searchParams;
  const rawContext = readSupplementContext(query ?? {});
  const supplement = rawContext?.entityType === 'SUPPLIER' ? rawContext : null;
  if (supplement) await requirePermission('purchase:manage');
  const { id } = await params;
  const party = await getPartySummary(id);
  if (!party) notFound();

  const boundUpdate = updatePartyAction.bind(null, id);
  const formInitial = {
    type: party.type,
    code: party.code,
    name: party.name,
    shortName: party.shortName,
    primaryContactName: party.primaryContact?.name ?? null,
    primaryContactPhone: party.primaryContact?.phone ?? null,
    primaryContactWechat: party.primaryContact?.wechat ?? null,
    defaultReceiverName: party.defaultAddress?.receiverName ?? null,
    defaultReceiverPhone: party.defaultAddress?.receiverPhone ?? null,
    defaultProvince: party.defaultAddress?.province ?? null,
    defaultCity: party.defaultAddress?.city ?? null,
    defaultDistrict: party.defaultAddress?.district ?? null,
    defaultAddressDetail: party.defaultAddress?.detail ?? null,
  };

  const receipt = readReceipt(query);

  return (
    <FormPage>
      <SupplementOwnership actorId={actor.id} context={supplement} />
      <ReceiptNotice receipt={receipt} noun="往来单位" />
      <PageHeader
        title={`编辑客户/供应商：${party.name}`}
        subtitle={`${PARTY_TYPE_LABELS[party.type]} · 编码 ${party.code}`}
        back={supplement ? { href: supplementReturnHref(supplement), label: '返回原录入' } : undefined}
        status={<ActiveStatusBadge active={party.isActive} />}
        actions={supplement && party.isActive && party.type !== 'CUSTOMER' ? <Link href={supplementReturnHref(supplement, party.id)} className={buttonVariants()}>选用该供应商并返回</Link> : undefined}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PartyForm
          key={`${party.id}-${party.updatedAt.toISOString()}`}
          mode="edit"
          supplement={supplement}
          action={boundUpdate}
          initial={formInitial}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {party.isActive ? '停用客户/供应商' : '启用客户/供应商'}
        </h2>
        <TogglePartyActiveButton
          partyId={party.id}
          currentlyActive={party.isActive}
        />
      </section>
    </FormPage>
  );
}
