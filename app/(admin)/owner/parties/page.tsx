import { readSupplementContext, supplementParams, supplementReturnHref, supplementCreateHref } from '@/lib/form-drafts/return-context';
import { SupplementOwnership } from '@/components/business/form-drafts/FormDraftControls';
import Link from 'next/link';
import { PartyType } from '../../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import { PartiesTable } from '@/components/business/party/PartiesTable';
import { PageHeader } from '@/components/ui-business';
import {
  buildTableHref,
  firstSearchParam,
  parsePositiveInt,
  parseSortDirection,
  parseSortKey,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listPartiesPage,
  PARTY_LIST_SORT_KEYS,
  PARTY_TYPE_LABELS,
} from '@/lib/party';

export const metadata = {
  title: '客户/供应商',
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const OWNER_PARTIES_PATH = '/owner/parties';

function parsePartyType(value: string): PartyType | 'suppliers' | null {
  if (value === 'suppliers') return value;
  return Object.values(PartyType).includes(value as PartyType)
    ? (value as PartyType)
    : null;
}

export default async function OwnerPartiesPage({ searchParams }: PageProps) {
  const actor = await requirePermission('party:manage');
  const sp = await searchParams;
  const rawContext = readSupplementContext(sp);
  const supplement = rawContext?.entityType === 'SUPPLIER' ? rawContext : null;
  if (supplement) await requirePermission('purchase:manage');
  const contextParams = supplement ? supplementParams(supplement) : {};
  const q = firstSearchParam(sp.q).trim();
  const type = parsePartyType(firstSearchParam(sp.type));
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const sort = parseSortKey(sp.sort, PARTY_LIST_SORT_KEYS, 'default');
  const direction = parseSortDirection(sp.dir);
  const partyPage = await listPartiesPage({
    q,
    type,
    page,
    pageSize,
    sort,
    direction,
  });
  const queryParams: TableHrefParams = {
    ...contextParams,
    q: q || undefined,
    type: type ?? undefined,
    page: partyPage.page,
    pageSize,
    sort: sort === 'default' ? undefined : sort,
    dir: sort === 'default' ? undefined : direction,
  };

  return (
    <div className="space-y-6">
      <SupplementOwnership actorId={actor.id} context={supplement} />
      <PageHeader
        title="客户/供应商"
        back={supplement ? { href: supplementReturnHref(supplement), label: '返回原录入' } : undefined}
        actions={
          <Link href={supplement ? supplementCreateHref(supplement) : '/owner/parties/new'} className={buttonVariants()}>
            新建客户/供应商
          </Link>
        }
      />

      <AdminListToolbar
        action={OWNER_PARTIES_PATH}
        query={q}
        placeholder="搜索编码、名称、联系人、电话、地址、拼音"
        clearHref={buildTableHref(OWNER_PARTIES_PATH, { type, ...contextParams }, {})}
        hiddenParams={{
          ...contextParams,
          pageSize,
          sort: sort === 'default' ? undefined : sort,
          dir: sort === 'default' ? undefined : direction,
        }}
        filters={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">类型</span>
            <select
              name="type"
              defaultValue={type ?? ''}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">全部</option>
              <option value="suppliers">供应商（含客户/供应商）</option>
              {Object.values(PartyType).map((option) => (
                <option key={option} value={option}>
                  {PARTY_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <AdminTableCard
        isEmpty={partyPage.rows.length === 0}
        emptyTitle="暂无客户/供应商"
        emptyDescription={q ? '没有匹配当前搜索条件的客户或供应商。' : undefined}
        footer={
          <AdminPagination
            basePath={OWNER_PARTIES_PATH}
            page={partyPage.page}
            pageCount={partyPage.pageCount}
            total={partyPage.total}
            pageSize={partyPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <PartiesTable
          supplement={supplement}
          parties={partyPage.rows}
          tableBase={OWNER_PARTIES_PATH}
          queryParams={queryParams}
          sort={sort}
          direction={direction}
        />
      </AdminTableCard>
    </div>
  );
}
