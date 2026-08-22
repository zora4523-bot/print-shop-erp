import { notFound } from 'next/navigation';
import {
  createMaterialTransactionAction,
  updateMaterialAction,
} from '@/actions/owner-materials';
import { MaterialForm } from '@/components/business/material/MaterialForm';
import { StockTransactionForm } from '@/components/business/material/StockTransactionForm';
import { ToggleMaterialActiveButton } from '@/components/business/material/ToggleMaterialActiveButton';
import { PageHeader, StatusBadge } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getMaterialSummary,
  listMaterialLocationStocks,
  MATERIAL_CATEGORY_LABELS,
} from '@/lib/material';
import { listActiveWarehouseLocationOptions } from '@/lib/warehouse';

type PageProps = { params: Promise<{ id: string }> };

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '-';
  return String(value);
}

function decimalInput(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const material = await getMaterialSummary(id);
  return {
    title: material ? `编辑 ${material.name} · 物料库存` : '物料不存在',
  };
}

export default async function EditForemanMaterialPage({ params }: PageProps) {
  await requirePermission('material:manage');
  const { id } = await params;
  const [material, locationOptions, locationStocks] = await Promise.all([
    getMaterialSummary(id),
    listActiveWarehouseLocationOptions(),
    listMaterialLocationStocks(id),
  ]);
  if (!material) notFound();

  const boundUpdate = updateMaterialAction.bind(null, id);
  const boundTransaction = createMaterialTransactionAction.bind(null, id);
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
      <PageHeader
        title={`编辑物料：${material.name}`}
        subtitle={`${MATERIAL_CATEGORY_LABELS[material.category]} · 当前库存 ${decimal(material.currentStock)} ${material.unit}`}
        actions={
          <StatusBadge tone={material.isActive ? 'success' : 'neutral'}>
            {material.isActive ? '启用' : '停用'}
          </StatusBadge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <MaterialForm
          key={`${material.id}-${material.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          routeBase="/foreman/materials"
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">库存出入库</h2>
        {/* 不要给这个表单加含 currentStock 的 key：提交成功后库存必变，
            key 跟着变会重挂载组件，把 useActionState 里的成功提示一起
            丢掉。表单字段的重置改由组件内部在 success 后 reset()。 */}
        <StockTransactionForm
          action={boundTransaction}
          unit={material.unit}
          locationOptions={locationOptions}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">库位库存</h2>
        {locationStocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无库位库存记录</p>
        ) : (
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="物料库位库存"
            tabIndex={0}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">仓库</th>
                  <th className="py-2 pr-3">库位</th>
                  <th className="py-2 pr-3 text-right">库存</th>
                </tr>
              </thead>
              <tbody>
                {locationStocks.map((stock) => (
                  <tr key={stock.id} className="border-b last:border-0">
                    <td className="py-3 pr-3">{stock.warehouse.name}</td>
                    <td className="py-3 pr-3">{stock.location.name}</td>
                    <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                      {decimal(stock.currentStock)} {material.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        />
      </section>
    </div>
  );
}
