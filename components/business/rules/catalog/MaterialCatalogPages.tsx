import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  createMaterialAction,
  createNonPaperMaterialAction,
  createMaterialTransactionAction,
  createPaperAction,
  createPaperTransactionAction,
  setPaperActiveAction,
  updateMaterialAction,
  updatePaperAction,
} from '@/actions/owner-materials';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  MaterialForm,
  type MaterialRouteBase,
} from '@/components/business/material/MaterialForm';
import { MaterialsTable } from '@/components/business/material/MaterialsTable';
import { StockTransactionForm } from '@/components/business/material/StockTransactionForm';
import { ToggleMaterialActiveButton } from '@/components/business/material/ToggleMaterialActiveButton';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader, StatusBadge, TableEmptyState, TableScrollArea } from '@/components/ui-business';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { RulePaperWorkspace } from '@/components/business/rules/catalog/RulePaperWorkspace';
import { MaterialCategory } from '@/generated/prisma/enums';
import {
  firstSearchParam,
  parsePositiveInt,
  parseSortDirection,
  parseSortKey,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import {
  getMaterialSummary,
  listMaterialLocationStocks,
  listMaterialsPage,
  MATERIAL_CATEGORY_LABELS,
  MATERIAL_LIST_SORT_KEYS,
} from '@/lib/material';
import { listActiveWarehouseLocationOptions } from '@/lib/warehouse';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type MaterialListRouteBase = '/owner/materials' | '/owner/rules/papers';

export type MaterialCatalogListProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
  }>;
  routeBase: MaterialListRouteBase;
  category?: MaterialCategory;
  excludeCategory?: MaterialCategory;
};

export type MaterialCatalogDetailProps = {
  params: Promise<{ id: string }>;
  routeBase: MaterialRouteBase;
  categoryScope?: MaterialCategory;
  redirectCategory?: MaterialCategory;
  redirectBase?: MaterialRouteBase;
};

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '-';
  return String(value);
}

function decimalInput(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function getMaterialCatalogMetadata({
  params,
  titleScope = '纸张',
}: Pick<MaterialCatalogDetailProps, 'params'> & { titleScope?: string }) {
  const session = await getSession();
  if (!session || !hasPermission('material:manage', session.user.role)) {
    return { title: titleScope };
  }

  const { id } = await params;
  const material = await getMaterialSummary(id);
  return {
    title: material
      ? `编辑 ${
          externalPriceBusinessText(material.name) || `未命名${titleScope}`
        } · ${titleScope}`
      : `${titleScope}不存在`,
  };
}

export async function MaterialCatalogList({
  searchParams,
  routeBase,
  category,
  excludeCategory,
}: MaterialCatalogListProps) {
  await requirePermission('material:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const sort = parseSortKey(sp.sort, MATERIAL_LIST_SORT_KEYS, 'default');
  const direction = parseSortDirection(sp.dir);
  const materialPage = await listMaterialsPage({
    q,
    category,
    excludeCategory,
    page,
    pageSize,
    sort,
    direction,
  });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: materialPage.page,
    pageSize,
    sort: sort === 'default' ? undefined : sort,
    dir: sort === 'default' ? undefined : direction,
  };
  const paperOnly = category === MaterialCategory.PAPER;

  return (
    <div className="space-y-6">
      {paperOnly ? (
        <RuleCenterPageHeader
          title="纸张"
          subtitle="维护建单可选纸张与库存运营状态；历史工单引用保留。"
          actions={
            <Link href={`${routeBase}/new`} className={buttonVariants()}>
              新建纸张
            </Link>
          }
        />
      ) : (
        <PageHeader
          title="物料字典"
          actions={
          <>
            <Link
              href="/owner/materials/count"
              className={buttonVariants({ variant: 'outline' })}
            >
              库存盘点
            </Link>
            <Link href={`${routeBase}/new`} className={buttonVariants()}>
              新建物料
            </Link>
          </>
          }
        />
      )}

      {paperOnly ? (
        <RulePaperWorkspace
          papers={materialPage.rows}
          routeBase={routeBase}
          query={q}
          hiddenSearchParams={{
            pageSize,
            sort: sort === 'default' ? undefined : sort,
            dir: sort === 'default' ? undefined : direction,
          }}
          pagination={{
            page: materialPage.page,
            pageCount: materialPage.pageCount,
            total: materialPage.total,
            pageSize: materialPage.pageSize,
            queryParams,
          }}
        />
      ) : (
        <>
          <AdminListToolbar
            action={routeBase}
            query={q}
            placeholder="搜索物料编码、名称、规格、单位、拼音"
            clearHref={routeBase}
            hiddenParams={{
              pageSize,
              sort: sort === 'default' ? undefined : sort,
              dir: sort === 'default' ? undefined : direction,
            }}
          />

          <AdminTableCard
            isEmpty={materialPage.rows.length === 0}
            emptyTitle="暂无物料"
            emptyDescription={
              q ? '没有匹配当前搜索条件的记录。' : undefined
            }
            footer={
              <AdminPagination
                basePath={routeBase}
                page={materialPage.page}
                pageCount={materialPage.pageCount}
                total={materialPage.total}
                pageSize={materialPage.pageSize}
                queryParams={queryParams}
              />
            }
          >
            <MaterialsTable
              materials={materialPage.rows}
              editBase={routeBase}
              tableBase={routeBase}
              queryParams={queryParams}
              sort={sort}
              direction={direction}
            />
          </AdminTableCard>
        </>
      )}
    </div>
  );
}

export async function NewMaterialCatalogItem({
  routeBase,
  categoryScope,
  excludedCategories,
}: Pick<MaterialCatalogDetailProps, 'routeBase' | 'categoryScope'> & {
  excludedCategories?: readonly MaterialCategory[];
}) {
  await requirePermission('material:manage');
  const paperOnly = categoryScope === MaterialCategory.PAPER;
  const excludesPaper = excludedCategories?.includes(MaterialCategory.PAPER);

  return (
    <div className="space-y-6">
      {paperOnly ? (
        <RuleCenterPageHeader
          title="新建纸张"
          effect="immediate"
          subtitle="默认启用；库存通过出入库维护。"
          actions={
            <Link
              href={routeBase}
              className={buttonVariants({ variant: 'outline' })}
            >
              返回列表
            </Link>
          }
        />
      ) : (
        <PageHeader
          title="新建物料"
          subtitle="默认启用；库存通过出入库维护。"
          actions={
          <Link
            href={routeBase}
            className={buttonVariants({ variant: 'outline' })}
          >
            返回列表
          </Link>
          }
        />
      )}

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <MaterialForm
          mode="create"
          action={
            paperOnly
              ? createPaperAction
              : excludesPaper
                ? createNonPaperMaterialAction
                : createMaterialAction
          }
          routeBase={routeBase}
          categoryScope={categoryScope}
          excludedCategories={excludedCategories}
        />
      </section>
    </div>
  );
}

export async function EditMaterialCatalogItem({
  params,
  routeBase,
  categoryScope,
  redirectCategory,
  redirectBase,
}: MaterialCatalogDetailProps) {
  await requirePermission('material:manage');
  const { id } = await params;
  const material = await getMaterialSummary(id);
  if (
    material &&
    redirectCategory &&
    redirectBase &&
    material.category === redirectCategory
  ) {
    redirect(`${redirectBase}/${id}`);
  }
  if (!material || (categoryScope && material.category !== categoryScope)) {
    notFound();
  }
  const [locationOptions, locationStocks] = await Promise.all([
    listActiveWarehouseLocationOptions(),
    listMaterialLocationStocks(id),
  ]);

  const paperOnly = categoryScope === MaterialCategory.PAPER;
  const boundUpdate = (paperOnly ? updatePaperAction : updateMaterialAction).bind(
    null,
    id,
  );
  const boundTransaction = (
    paperOnly
      ? createPaperTransactionAction
      : createMaterialTransactionAction
  ).bind(null, id);
  const formInitial = {
    code: material.code,
    name: material.name,
    category: material.category,
    specification: material.specification,
    unit: material.unit,
    safetyStock: decimalInput(material.safetyStock),
    averageCost: decimalInput(material.averageCost),
  };

  return (
    <div className="space-y-6">
      {paperOnly ? (
        <RuleCenterPageHeader
          title={`编辑纸张：${
            externalPriceBusinessText(material.name) || '未命名纸张'
          }`}
          effect="immediate"
          subtitle={`${MATERIAL_CATEGORY_LABELS[material.category]} · 当前库存 ${decimal(material.currentStock)} ${material.unit}`}
          actions={
            <StatusBadge tone={material.isActive ? 'success' : 'neutral'}>
              {material.isActive ? '启用' : '停用'}
            </StatusBadge>
          }
        />
      ) : (
        <PageHeader
          title={`编辑物料：${
          externalPriceBusinessText(material.name) ||
          '未命名物料'
        }`}
        subtitle={`${MATERIAL_CATEGORY_LABELS[material.category]} · 当前库存 ${decimal(material.currentStock)} ${material.unit}`}
        actions={
          <StatusBadge tone={material.isActive ? 'success' : 'neutral'}>
            {material.isActive ? '启用' : '停用'}
          </StatusBadge>
        }
        />
      )}

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <MaterialForm
          key={`${material.id}-${material.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          routeBase={routeBase}
          categoryScope={categoryScope}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">库存出入库</h2>
        <StockTransactionForm
          action={boundTransaction}
          unit={material.unit}
          locationOptions={locationOptions}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">库位库存</h2>
        <TableScrollArea label="物料库位库存">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">仓库</th>
                <th className="py-2 pr-3">库位</th>
                <th className="py-2 pr-3 text-right">库存</th>
              </tr>
            </thead>
            <tbody>
              {locationStocks.length === 0 ? (
                <TableEmptyState
                  colSpan={3}
                  title="暂无库位库存记录"
                  description="完成首次入库后，各库位库存会显示在这里。"
                />
              ) : (
                locationStocks.map((stock) => (
                  <tr key={stock.id} className="border-b last:border-0">
                    <td className="py-3 pr-3">{stock.warehouse.name}</td>
                    <td className="py-3 pr-3">{stock.location.name}</td>
                    <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                      {decimal(stock.currentStock)} {material.unit}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScrollArea>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {material.isActive ? '停用物料' : '启用物料'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {material.isActive
            ? '停用后该物料不再作为新业务默认选择；历史库存流水保留。'
            : '启用后该物料会重新进入可维护物料清单。'}
        </p>
        <ToggleMaterialActiveButton
          materialId={material.id}
          currentlyActive={material.isActive}
          action={paperOnly ? setPaperActiveAction : undefined}
        />
      </section>
    </div>
  );
}
