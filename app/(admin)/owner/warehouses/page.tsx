import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui-business';
import { WarehouseForms } from '@/components/business/warehouse/WarehouseForms';
import { requirePermission } from '@/lib/auth/permissions';
import { listWarehouses } from '@/lib/warehouse';

export const metadata = {
  title: '仓库/库位 · 红包印刷 ERP',
};

export default async function OwnerWarehousesPage() {
  await requirePermission('warehouse:manage');
  const warehouses = await listWarehouses();

  return (
    <div className="space-y-6">
      <PageHeader
        title="仓库/库位"
        subtitle="维护库存移动可选择的仓库和库位；历史库存已回填到默认仓库/默认库位。"
      />

      <WarehouseForms
        warehouses={warehouses.map((warehouse) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          isActive: warehouse.isActive,
        }))}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">仓库列表</h2>
        <div className="space-y-4">
          {warehouses.map((warehouse) => (
            <div key={warehouse.id} className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{warehouse.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {warehouse.code}
                  </div>
                </div>
                <div className="flex gap-2">
                  {warehouse.isDefault ? <Badge variant="outline">默认</Badge> : null}
                  <Badge variant={warehouse.isActive ? 'outline' : 'secondary'}>
                    {warehouse.isActive ? '启用' : '停用'}
                  </Badge>
                </div>
              </div>
              {warehouse.locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无库位。</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {warehouse.locations.map((location) => (
                    <div
                      key={location.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <div>
                        <div>{location.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {location.code}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {location.isDefault ? (
                          <Badge variant="outline">默认</Badge>
                        ) : null}
                        <Badge variant={location.isActive ? 'outline' : 'secondary'}>
                          {location.isActive ? '启用' : '停用'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
