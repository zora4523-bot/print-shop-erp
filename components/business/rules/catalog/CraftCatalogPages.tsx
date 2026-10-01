import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createRuleCenterCraftAction,
  updateCraftAction,
} from '@/actions/owner-crafts';
import {
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  CraftForm,
  type CraftRouteBase,
} from '@/components/business/craft/CraftForm';
import { CraftsTable } from '@/components/business/craft/CraftsTable';
import { ToggleActiveButton } from '@/components/business/craft/ToggleActiveButton';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge, ReceiptNotice, FormPageContainer } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { parsePositiveInt, type TableHrefParams } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getCraftSummary, isRetiredCraft, listCraftsPage } from '@/lib/craft';
import { FormPendingScope } from '@/components/business/form/FormPendingScope';

export type CraftCatalogListProps = {
  searchParams: Promise<{
    page?: string | string[];
    pageSize?: string | string[];
  }>;
  routeBase: CraftRouteBase;
};

export type CraftCatalogDetailProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  routeBase: CraftRouteBase;
};

export async function getCraftCatalogMetadata({
  params,
  titleScope = '建单工艺目录',
}: Pick<CraftCatalogDetailProps, 'params'> & { titleScope?: string }) {
  const session = await getSession();
  if (!session || !hasPermission('dict:craft:manage', session.user.role)) {
    return { title: titleScope };
  }

  const { id } = await params;
  const craft = await getCraftSummary(id);
  return {
    title: craft
      ? `编辑 ${craft.name} · ${titleScope}`
      : `${titleScope}不存在`,
  };
}

export async function CraftCatalogList({
  searchParams,
  routeBase,
}: CraftCatalogListProps) {
  await requirePermission('dict:craft:manage');
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const craftPage = await listCraftsPage({ page, pageSize });
  const queryParams: TableHrefParams = {
    page: craftPage.page,
    pageSize,
  };
  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="建单工艺目录"
        effect="immediate"
        actions={
          <Link
            href={`${routeBase}/new`}
            prefetch={false}
            className={buttonVariants()}
          >
            新建工艺
          </Link>
        }
      />
      <AdminTableCard
        isEmpty={craftPage.rows.length === 0}
        emptyTitle="暂无工艺"
        footer={
          <AdminPagination
            basePath={routeBase}
            page={craftPage.page}
            pageCount={craftPage.pageCount}
            total={craftPage.total}
            pageSize={craftPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <CraftsTable crafts={craftPage.rows} editBase={routeBase} />
      </AdminTableCard>
    </div>
  );
}

export async function NewCraftCatalogItem({
  routeBase,
}: Pick<CraftCatalogListProps, 'routeBase'>) {
  await requirePermission('dict:craft:manage');
  return (
    <FormPendingScope>
    <FormPageContainer>
      <RuleCenterPageHeader
        lockBackWhilePending
        title="新建工艺"
        effect="immediate"
        back={{ href: routeBase, label: '返回工艺' }}
      />
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <CraftForm
          mode="create"
          action={createRuleCenterCraftAction}
          routeBase={routeBase}
        />
      </div>
    </FormPageContainer>
    </FormPendingScope>
  );
}

export async function EditCraftCatalogItem({
  params,
  searchParams,
  routeBase,
}: CraftCatalogDetailProps) {
  await requirePermission('dict:craft:manage');
  const { id } = await params;
  const receipt = readReceipt(await searchParams);
  const craft = await getCraftSummary(id);
  if (!craft) notFound();
  const isRetired = isRetiredCraft(craft);
  const boundUpdate = updateCraftAction.bind(null, id);

  return (
    <FormPendingScope>
    <div className="space-y-6">
      <ReceiptNotice receipt={receipt} noun="工艺" />
      <RuleCenterPageHeader
        lockBackWhilePending
        title={`编辑工艺：${craft.name}`}
        effect="immediate"
        back={{ href: routeBase, label: '返回工艺' }}
        status={
          <>
            <ActiveStatusBadge active={craft.isActive} />
            {isRetired ? <StatusBadge tone="warning">历史 / 已退役</StatusBadge> : null}
          </>
        }
        subtitle={craft.isOutsource ? '外协工艺' : undefined}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <CraftForm
          key={`${craft.id}-${craft.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={craft}
          routeBase={routeBase}
        />
      </section>

      {craft.isActive || !isRetired ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-2 text-base font-semibold">
            {craft.isActive ? '停用工艺' : '启用工艺'}
          </h2>
          <ToggleActiveButton
            craftId={craft.id}
            currentlyActive={craft.isActive}
          />
        </section>
      ) : null}
    </div>
    </FormPendingScope>
  );
}
