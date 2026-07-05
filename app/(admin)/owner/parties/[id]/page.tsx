import { notFound } from 'next/navigation';
import { updatePartyAction } from '@/actions/owner-parties';
import { PartyForm } from '@/components/business/party/PartyForm';
import { TogglePartyActiveButton } from '@/components/business/party/TogglePartyActiveButton';
import { PageHeader, StatusBadge } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getPartySummary,
  PARTY_TYPE_LABELS,
} from '@/lib/party';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const party = await getPartySummary(id);
  return {
    title: party ? `编辑 ${party.name} · 客户/供应商` : '客户/供应商不存在',
  };
}

export default async function EditOwnerPartyPage({ params }: PageProps) {
  await requirePermission('party:manage');
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑客户/供应商：${party.name}`}
        subtitle={`${PARTY_TYPE_LABELS[party.type]} · 编码 ${party.code}`}
        actions={
          <StatusBadge tone={party.isActive ? 'success' : 'neutral'}>
            {party.isActive ? '启用' : '停用'}
          </StatusBadge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PartyForm
          key={`${party.id}-${party.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {party.isActive ? '停用客户/供应商' : '启用客户/供应商'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {party.isActive
            ? '停用后不会出现在新建工单客户选择中；历史工单快照和已有链接仍保留。'
            : '启用后客户类型和客户/供应商类型会重新进入新建工单客户选择。'}
        </p>
        <TogglePartyActiveButton
          partyId={party.id}
          currentlyActive={party.isActive}
        />
      </section>
    </div>
  );
}
