import { z } from 'zod';
import { createWarehouseSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { writeAuditLogInTx } from '@/lib/audit-log';
import { acquireWarehouseConfigurationLock, requireWarehouseActor, rethrowWarehouseWriteError, WarehouseInvariantError } from '@/lib/warehouse-coordination';

export const warehouseMaintenanceSchema = z.object({
  kind: z.enum(['warehouse', 'location']),
  id: z.string().trim().min(1, '请选择仓库或库位'),
  expectedUpdatedAt: z.iso.datetime({ message: '页面信息不完整，请刷新后重试' }),
  operation: z.enum(['rename', 'disable', 'restore']),
  name: createWarehouseSchema.shape.name.optional(),
}).refine((data) => data.operation !== 'rename' || data.name, { path: ['name'], message: '请填写名称' });
export type WarehouseMaintenanceInput = z.infer<typeof warehouseMaintenanceSchema>;

export async function maintainWarehouse(raw: WarehouseMaintenanceInput, actorId: string) {
  const parsed = warehouseMaintenanceSchema.safeParse(raw);
  if (!parsed.success) throw new WarehouseInvariantError(parsed.error.issues[0]?.message ?? '维护信息不完整');
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    await acquireWarehouseConfigurationLock(tx);
    const actor = await requireWarehouseActor(tx, actorId);
    const before = input.kind === 'warehouse'
      ? await tx.warehouse.findUnique({ where: { id: input.id } })
      : await tx.warehouseLocation.findUnique({ where: { id: input.id } });
    if (!before) throw new WarehouseInvariantError(input.kind === 'warehouse' ? '仓库不存在' : '库位不存在');
    if (input.operation === 'restore' && 'warehouseId' in before && typeof before.warehouseId === 'string') {
      const parent = await tx.warehouse.findUnique({ where: { id: before.warehouseId }, select: { isActive: true } });
      if (!parent?.isActive) throw new WarehouseInvariantError('请先启用所属仓库，再启用库位');
    }
    const name = input.operation === 'rename' ? input.name! : before.name;
    const isActive = input.operation === 'rename' ? before.isActive : input.operation === 'restore';
    // An identical request may be safely replayed, but never overwrite a newer value.
    if (name === before.name && isActive === before.isActive) return before;
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new WarehouseInvariantError('这项资料已被修改，请刷新后重新核对');
    }
    if (!isActive) {
      if (before.isDefault) throw new WarehouseInvariantError('默认仓库或默认库位不能停用');
      const stock = await tx.materialLocationStock.findFirst({ where: {
        ...(input.kind === 'warehouse' ? { warehouseId: input.id } : { locationId: input.id }),
        currentStock: { not: 0 },
      }, select: { id: true } });
      if (stock) throw new WarehouseInvariantError('仍有库存，请先调拨或出库至零后再停用');
    }
    const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const data = { name, isActive, updatedAt };
    const where = { id: input.id, updatedAt: before.updatedAt };
    const after = input.kind === 'warehouse'
      ? await tx.warehouse.update({ where, data })
      : await tx.warehouseLocation.update({ where, data });
    await writeAuditLogInTx(tx, {
      actor, action: 'WAREHOUSE_MAINTAINED', entityType: input.kind === 'warehouse' ? 'Warehouse' : 'WarehouseLocation',
      entityId: input.id, before: { name: before.name, isActive: before.isActive }, after: { name, isActive },
      requestMetadata: { operation: input.operation, expectedUpdatedAt: input.expectedUpdatedAt },
    });
    return after;
  }).catch(rethrowWarehouseWriteError);
}
