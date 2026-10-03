import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { OrderStatus, Role, ShipmentStatus } from '@/generated/prisma/enums';
import { OrderInvariantError, assertShipOrderReadinessInTx, shipOrder } from '@/lib/order';
import { settleFactoryOrder } from './admin-workflow';
import { orderCascadeLockKey } from './locks';
import { lockSettlementCutoffShared } from '@/lib/finance/settlement-cutoff-lock';
import { shipmentRegistrationSchema, type ShipmentRegistrationInput } from './shipment-registration-schema';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { dispatchProductionCompletionNotification, type ProductionCompletionNotification } from '@/lib/production-completion';
import { completePlannedProductionInTx, PlannedCompletionError } from '@/lib/production/planned-completion';
import { prepareOrderForProductionInTx } from './production-readiness';

export const SHIPMENT_IMAGE_LIMIT = 512 * 1024;
export async function normalizeShipmentImage(bytes: Uint8Array): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > SHIPMENT_IMAGE_LIMIT) throw new OrderInvariantError('图片过大，请压缩至 512 KB 以内');
  try {
    const decoder = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await decoder.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('format');
    const image = await decoder.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    if (image.length > SHIPMENT_IMAGE_LIMIT) throw new Error('size');
    return new Uint8Array(image);
  } catch {
    throw new OrderInvariantError('图片无法读取，请换用 JPG、PNG 或 WebP 图片');
  }
}

export async function registerShipment(raw: ShipmentRegistrationInput, actor: { id: string; role: Role }, rawPhoto?: Uint8Array) {
  if (actor.role !== Role.ADMIN) throw new OrderInvariantError('只有管理员可以登记发货');
  const input = shipmentRegistrationSchema.parse(raw);
  const photo = rawPhoto ? await normalizeShipmentImage(rawPhoto) : undefined;
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).update(photo ?? new Uint8Array()).digest('hex');
  const result = await db.$transaction(async (tx) => {
    // Same lock order as monthly billing and the settlement writer.
    await lockSettlementCutoffShared(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    let order = await tx.order.findUnique({ where: { id: input.orderId }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
    const shipment = order?.shipments.find((row) => row.id === input.shipmentId);
    if (!order || !shipment) throw new OrderInvariantError('找不到发货地址，请刷新工单');
    const replay = await tx.orderLog.findFirst({ where: { orderId: order.id, action: 'SHIPMENT_REGISTERED', changedFields: { path: ['requestId'], equals: input.idempotencyKey } } });
    if (replay) {
      const fields = replay.changedFields as { fingerprint?: string };
      if (fields.fingerprint !== fingerprint) throw new OrderInvariantError('提交内容已变化，请刷新后重试');
      return { completed: false, replay: true, orderNo: order.orderNo };
    }
    if (shipment.registrationVersion !== input.expectedVersion || order.revision !== input.expectedRevision || order.editVersion !== input.expectedEditVersion || order.workOrderVersion !== input.expectedWorkOrderVersion || order.priceRevision !== input.expectedPriceRevision) {
      throw new OrderInvariantError('工单已被修改，请刷新后重新登记');
    }
    if ([OrderStatus.CANCELLED, OrderStatus.FINISHED].includes(order.status as 'CANCELLED' | 'FINISHED')) throw new OrderInvariantError('该工单已关闭，不能登记发货');
    const now = new Date();
    let productionNotification: ProductionCompletionNotification | undefined;
    if (input.confirm) {
      if (shipment.status === ShipmentStatus.SHIPPED) throw new OrderInvariantError('该地址已发货，请刷新查看');
      if (order.purpose === 'SAMPLE_SHIPMENT' && ['CONFIRMED', 'PENDING_FACTORY', 'SUBMITTED'].includes(order.status)) {
        const prepared = await prepareOrderForProductionInTx(tx, order.id, actor, now);
        if (!prepared.ready) throw new OrderInvariantError(prepared.issues.join('；'));
        order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
      }
      // 业主 2026-10-01：单人流程填物流单号确认发货即证明已按工单数量生产完成，
      // 先代师傅按计划数量登记并计提成；任何一步失败整体回滚。
      if (order.simpleProduction && (order.status === OrderStatus.RELEASED || order.status === OrderStatus.FOILING)) {
        try {
          productionNotification = (await completePlannedProductionInTx(tx, order.id, actor, 'SHIPMENT_AUTO')).notification;
        } catch (error) {
          if (error instanceof PlannedCompletionError) throw new OrderInvariantError(`确认发货前需登记生产完成：${error.message}`);
          throw error;
        }
        order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
        // Production is registered but the order is still held (e.g. outsourcing): surface the specific reason.
        if (order.status !== OrderStatus.PACKING && order.status !== OrderStatus.COMPLETED) {
          await assertShipOrderReadinessInTx(tx, { orderId: order.id, workOrderVersion: order.workOrderVersion, settlementType: order.settlementType, isVersionedCommand: true, hasSubmittedShipmentDetails: true, simpleProduction: order.simpleProduction, requiresOutsource: order.requiresOutsource });
        }
      }
      if (order.status !== OrderStatus.PACKING && order.status !== OrderStatus.COMPLETED) throw new OrderInvariantError('工单尚未完工，请完工后确认发货');
      if (order.confirmedFee === null || !['ADMIN_CONFIRMED', 'AUTO_CONFIRMED', 'LEGACY_CONFIRMED'].includes(order.pricingStatus)) throw new OrderInvariantError('费用尚未确认，请先核价');
      if (order.isSfCollect && input.carrierCode !== 'SF') throw new OrderInvariantError('本单为顺丰到付，请选择顺丰或先更正物流费用');
      await assertShipOrderReadinessInTx(tx, { orderId: order.id, workOrderVersion: order.workOrderVersion, settlementType: order.settlementType, isVersionedCommand: true, hasSubmittedShipmentDetails: true, simpleProduction: order.simpleProduction, requiresOutsource: order.requiresOutsource });
    }
    // Do not clear previously registered logistics when saving corrections after shipment.
    if (shipment.status === ShipmentStatus.SHIPPED && (!input.trackingNo || !input.carrierCode || (input.carrierCode === 'OTHER' && !input.carrierName))) throw new OrderInvariantError('已发货地址须保留完整物流资料');
    const updated = await tx.orderShipment.update({ where: { id: shipment.id }, data: {
      trackingNo: input.trackingNo || null, carrierCode: input.carrierCode || null,
      carrierName: input.carrierCode === 'OTHER' ? input.carrierName || null : null,
      registrationVersion: { increment: 1 },
      ...(input.confirm ? { status: ShipmentStatus.SHIPPED, shippedAt: now } : {}),
    } });
    if (photo) await tx.orderShipmentLabel.create({ data: { shipmentId: shipment.id, image: new Uint8Array(photo), createdById: actor.id } });
    const all = order.shipments.map((row) => row.id === shipment.id ? updated : row);
    const completed = input.confirm && all.every((row) => row.status === ShipmentStatus.SHIPPED);
    if (completed) {
      await shipOrder(order.id, actor, {
        expectedRevision: order.revision, expectedEditVersion: order.editVersion,
        expectedWorkOrderVersion: order.workOrderVersion, expectedPriceRevision: order.priceRevision,
        idempotencyKey: input.idempotencyKey, trackingNo: all[0]?.trackingNo ?? null,
        shipments: all.map((row) => ({ shipmentId: row.id, trackingNo: row.trackingNo, weightKg: row.weightKg?.toString() ?? null })),
      }, now, tx);
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { revision: true, workOrderVersion: true, confirmedFee: true } });
      if (!current.confirmedFee?.equals(order.confirmedFee!)) throw new OrderInvariantError('物流费用有变化，请先确认物流费用，再登记发货');
      await settleFactoryOrder({ orderId: order.id, expectedRevision: current.revision, expectedWorkOrderVersion: current.workOrderVersion }, actor, tx);
    } else {
      await tx.order.update({ where: { id: order.id }, data: { revision: { increment: 1 }, ...(shipment.sequence === 1 ? { trackingNo: updated.trackingNo } : {}) } });
    }
    await tx.orderLog.create({ data: {
      orderId: order.id, operatorId: actor.id, action: 'SHIPMENT_REGISTERED',
      remark: input.confirm ? `地址 ${shipment.sequence} 已发货${completed ? '，已确认应收' : ''}` : `保存地址 ${shipment.sequence} 物流资料`,
      changedFields: { requestId: input.idempotencyKey, fingerprint,
        trackingNo: { before: shipment.trackingNo, after: updated.trackingNo },
        carrierCode: { before: shipment.carrierCode, after: updated.carrierCode },
        carrierName: { before: shipment.carrierName, after: updated.carrierName },
        shipmentStatus: { before: shipment.status, after: updated.status },
        labelAdded: Boolean(photo) },
    } });
    return { completed, replay: false, orderNo: order.orderNo, productionNotification };
  }, { timeout: 30_000 });
  if ('productionNotification' in result && result.productionNotification) await dispatchProductionCompletionNotification(result.productionNotification);
  if (result.completed && backgroundJobsMode() !== 'durable') {
    await dispatchNotification('ORDER_SHIPPED', { orderId: input.orderId, orderNo: result.orderNo, trackingNo: input.trackingNo }, { dedupeKey: `notification:ORDER_SHIPPED:${input.orderId}` });
  }
  return result;
}
