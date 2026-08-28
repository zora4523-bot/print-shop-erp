import {
  OrderBillingMode,
  OrderCraft,
  OrderFoilTechnique,
  OrderKind,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
  ShipmentStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import type { CreateReworkOrderInput } from '../auth/schemas';
import {
  nextOrderNumber,
  type OrderSeqTxClient,
} from './order-number';
import { orderCascadeLockKey } from './locks';
import { dispatchNotification } from '../notification/dispatch';
import { enqueueNotificationInTransaction } from '../notification/transactional-outbox';
import type { EnqueueClient } from '../background-jobs/repository';
import { backgroundJobsMode } from '../background-jobs/mode';
import { ORDER_PRICING_STATUS } from './pricing-status';
import { deriveLegacyOrderItemFoilFacts } from './pricing-route';
import {
  activateProductionOperationsInTx,
  ProductionOperationMaterializationError,
} from '../production/operation-materialization-service';

export class ReworkOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReworkOrderError';
  }
}

export type ReworkCraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
};

type ReworkPricingRevisionTxClient = {
  order: {
    create: (args: {
      data: unknown;
      select: unknown;
    }) => Promise<{
      id: string;
      orderNo: string;
      items: Array<{ id: string; sequence: number }>;
    }>;
  };
  orderPricingRevision: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export async function getReworkCraftOptions(
  craftIds: string[],
): Promise<ReworkCraftOption[]> {
  const ids = [...new Set(craftIds)];
  if (ids.length === 0) return [];
  return db.craft.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, isOutsource: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createReworkOrder(
  input: CreateReworkOrderInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; orderNo: string }> {
  if (actor.role !== Role.ADMIN) {
    throw new ReworkOrderError('只有管理员可以创建重做工单');
  }

  let notificationQueued = false;
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.sourceOrderId,
    )}))`;
    const source = await tx.order.findUnique({
      where: { id: input.sourceOrderId },
      include: {
        items: {
          orderBy: { sequence: 'asc' },
          include: {
            designs: { orderBy: { uploadedAt: 'asc' } },
          },
        },
        shipments: {
          orderBy: { sequence: 'asc' },
        },
        packagingGroups: {
          orderBy: { sequence: 'asc' },
          include: {
            lines: { orderBy: { orderItemId: 'asc' } },
          },
        },
      },
    });
    if (!source) throw new ReworkOrderError('原工单不存在');
    if (source.kind === OrderKind.REWORK) {
      throw new ReworkOrderError(
        '重做工单不能再次发起重做，请返回原工单创建新的重做单',
      );
    }
    if (
      source.status !== OrderStatus.SHIPPED &&
      source.status !== OrderStatus.FINISHED
    ) {
      throw new ReworkOrderError('只有已发货或已完成工单可以发起重做');
    }

    const primarySourceShipment = source.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    // 历史数据可能只有工单或主发货记录的一边有地址。
    // 以实际履约的主发货地址优先，另一边作为可验证回退，
    // 并把同一值同时写入新工单和新主发货记录。
    const receiverAddress =
      primarySourceShipment?.receiverAddress?.trim() ||
      source.receiverAddress?.trim();
    if (!receiverAddress) {
      throw new ReworkOrderError(
        '原工单和主发货记录均缺少收货地址，请先补全原工单地址再创建重做单',
      );
    }

    const selectedIds = input.items.map((item) => item.sourceOrderItemId);
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new ReworkOrderError('同一款式不能重复加入重做单');
    }
    const sourceItemById = new Map(source.items.map((item) => [item.id, item]));
    const requestedCraftIds = new Set<string>();
    for (const item of input.items) {
      const sourceItem = sourceItemById.get(item.sourceOrderItemId);
      if (!sourceItem) throw new ReworkOrderError('所选款式不属于原工单');
      if (item.quantity > sourceItem.quantity) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”重做数量不能超过原数量 ${sourceItem.quantity}`,
        );
      }
      const sourceCrafts = new Set(sourceItem.crafts);
      for (const craftId of item.craftIds) {
        if (!sourceCrafts.has(craftId)) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”不包含所选重做工艺`,
          );
        }
        requestedCraftIds.add(craftId);
      }
    }
    const activeCrafts = await tx.craft.findMany({
      where: { id: { in: [...requestedCraftIds] }, isActive: true },
      select: { id: true, code: true },
    });
    if (activeCrafts.length !== requestedCraftIds.size) {
      throw new ReworkOrderError('所选重做工艺不存在或已停用');
    }

    const craftCodeById = new Map(
      activeCrafts.map((craft) => [craft.id, craft.code]),
    );
    const partialFoilCodes = new Set(['FLAT_FOIL_PARTIAL', 'STOCK_FOIL']);
    const fullFoilCodes = new Set([
      'FLAT_FOIL_SINGLE',
      'FLAT_FOIL_DOUBLE',
      'FLAT_FOIL_TRIPLE',
    ]);
    const printFoilCodes = new Set([
      'COATED_COLOR_PRINT_FOIL',
      'COLOR_PRINT_FOIL',
    ]);
    const productionFactsBySourceItemId = new Map<
      string,
      ReturnType<typeof deriveLegacyOrderItemFoilFacts> & {
        craft: OrderCraft;
        hasLocalFoil: boolean;
        foilTechnique: (typeof source.items)[number]['foilTechnique'];
      }
    >();
    for (const requested of input.items) {
      const sourceItem = sourceItemById.get(requested.sourceOrderItemId)!;
      const foilFacts = deriveLegacyOrderItemFoilFacts(sourceItem);
      const selectedFoilCodes = requested.craftIds.flatMap((craftId) => {
        const code = craftCodeById.get(craftId);
        return code &&
          (partialFoilCodes.has(code) ||
            fullFoilCodes.has(code) ||
            printFoilCodes.has(code))
          ? [code]
          : [];
      });
      if (selectedFoilCodes.length > 1) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”同时选中多个烫金主工艺，无法唯一确定重做计件口径`,
        );
      }
      const selectedFoilCode = selectedFoilCodes[0] ?? null;
      let reworkCraft: OrderCraft = OrderCraft.PRINT;
      let reworkHasLocalFoil = false;
      if (selectedFoilCode && partialFoilCodes.has(selectedFoilCode)) {
        reworkCraft = OrderCraft.PARTIAL;
        reworkHasLocalFoil = true;
      } else if (selectedFoilCode && fullFoilCodes.has(selectedFoilCode)) {
        reworkCraft = OrderCraft.FULL;
      } else if (selectedFoilCode && printFoilCodes.has(selectedFoilCode)) {
        if (sourceItem.hasLocalFoil === null) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”的彩印叠加烫金未标明局部或专版，不能猜测重做工序`,
          );
        }
        reworkCraft = sourceItem.hasLocalFoil
          ? OrderCraft.PARTIAL
          : OrderCraft.FULL;
        reworkHasLocalFoil = sourceItem.hasLocalFoil;
      }
      if (
        reworkCraft === OrderCraft.PARTIAL &&
        foilFacts.frontFoilColors.length + foilFacts.backFoilColors.length === 0
      ) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”缺少局部烫金正反面颜色次数，不能猜测重做计件数`,
        );
      }
      productionFactsBySourceItemId.set(
        sourceItem.id,
        selectedFoilCode
          ? {
              ...foilFacts,
              craft: reworkCraft,
              hasLocalFoil: reworkHasLocalFoil,
              foilTechnique: sourceItem.foilTechnique,
            }
          : {
              frontFoilColors: [],
              backFoilColors: [],
              foilColors: [],
              isDoubleSided: false,
              isDoubleColor: false,
              craft: OrderCraft.PRINT,
              hasLocalFoil: false,
              foilTechnique: OrderFoilTechnique.NONE,
            },
      );
    }

    const packagingMemberships = new Map<
      string,
      Array<{
        sourceGroupId: string;
        sourceGroupSequence: number;
        sourceGroupName: string | null;
        sourceGroupActualBagCount: number;
        unitsPerBag: number;
      }>
    >();
    for (const group of source.packagingGroups) {
      for (const line of group.lines) {
        const memberships = packagingMemberships.get(line.orderItemId) ?? [];
        memberships.push({
          sourceGroupId: group.id,
          sourceGroupSequence: group.sequence,
          sourceGroupName: group.name,
          sourceGroupActualBagCount: group.actualBagCount,
          unitsPerBag: line.unitsPerBag,
        });
        packagingMemberships.set(line.orderItemId, memberships);
      }
    }

    const packagingPlanBySourceGroupId = new Map<
      string,
      {
        sourceSequence: number;
        sourceName: string | null;
        members: Array<{
          requestedIndex: number;
          sourceOrderItemId: string;
          unitsPerBag: number;
          bagCount: number;
        }>;
      }
    >();
    for (const [requestedIndex, requested] of input.items.entries()) {
      const sourceItem = sourceItemById.get(requested.sourceOrderItemId)!;
      const memberships = packagingMemberships.get(sourceItem.id) ?? [];
      if (memberships.length !== 1) {
        throw new ReworkOrderError(
          memberships.length === 0
            ? `款式“${sourceItem.name}”在原单没有唯一包装组，无法确定重做入袋数`
            : `款式“${sourceItem.name}”在原单同时属于 ${memberships.length} 个包装组，拒绝猜测重做包装口径`,
        );
      }
      const membership = memberships[0]!;
      if (
        !Number.isSafeInteger(membership.unitsPerBag) ||
        membership.unitsPerBag <= 0 ||
        !Number.isSafeInteger(membership.sourceGroupActualBagCount) ||
        membership.sourceGroupActualBagCount <= 0 ||
        Math.ceil(sourceItem.quantity / membership.unitsPerBag) !==
          membership.sourceGroupActualBagCount
      ) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”的原单每袋数与实际袋数不一致，请先修复原单包装事实`,
        );
      }
      const bagCount = Math.ceil(requested.quantity / membership.unitsPerBag);
      const plan = packagingPlanBySourceGroupId.get(
        membership.sourceGroupId,
      ) ?? {
        sourceSequence: membership.sourceGroupSequence,
        sourceName: membership.sourceGroupName,
        members: [],
      };
      plan.members.push({
        requestedIndex,
        sourceOrderItemId: sourceItem.id,
        unitsPerBag: membership.unitsPerBag,
        bagCount,
      });
      packagingPlanBySourceGroupId.set(membership.sourceGroupId, plan);
    }
    const packagingPlans = [...packagingPlanBySourceGroupId.values()]
      .sort((left, right) => left.sourceSequence - right.sourceSequence)
      .map((plan, index) => {
        const bagCounts = [...new Set(plan.members.map((member) => member.bagCount))];
        if (bagCounts.length !== 1) {
          throw new ReworkOrderError(
            `原包装组 #${plan.sourceSequence} 的重做数量无法沿用同一混装袋数，请调整重做数量或先拆分原单包装事实`,
          );
        }
        return {
          sequence: index + 1,
          name: plan.sourceName,
          mode:
            plan.members.length === 1
              ? OrderPackagingMode.SINGLE_STYLE
              : OrderPackagingMode.MIXED_STYLE,
          actualBagCount: bagCounts[0]!,
          members: plan.members,
        };
      });
    const unitsPerBagBySourceItemId = new Map(
      packagingPlans.flatMap((plan) =>
        plan.members.map(
          (member) =>
            [member.sourceOrderItemId, member.unitsPerBag] as const,
        ),
      ),
    );

    const orderNo = await nextOrderNumber(
      tx as unknown as OrderSeqTxClient,
      now,
    );
    const pricingTx = tx as unknown as ReworkPricingRevisionTxClient;
    const createdOrder = await pricingTx.order.create({
      data: {
        orderNo,
        submitterId: actor.id,
        submitterRole: actor.role,
        createdById: actor.id,
        customerPartyId: source.customerPartyId,
        status: OrderStatus.SUBMITTED,
        kind: OrderKind.REWORK,
        billingMode: OrderBillingMode.NO_CHARGE,
        settlementType: OrderSettlementType.NO_CHARGE,
        pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
        priceRevision: 1,
        pricingConfirmedAt: now,
        pricingConfirmedById: null,
        sourceOrderId: source.id,
        reworkCause: input.cause,
        reworkReason: input.reason,
        isUrgent: source.isUrgent,
        isSfCollect: source.isSfCollect,
        customName: `重做 · ${source.customName ?? source.orderNo}`,
        customerRef: source.customerRef,
        receiverName: source.receiverName,
        receiverPhone: source.receiverPhone,
        receiverAddress,
        expressCode: source.expressCode,
        packageRequirement: source.packageRequirement,
        remark: `原单 ${source.orderNo}；重做原因：${input.reason}`,
        promisedDate: null,
        processingAmount: '0.00',
        totalAmount: '0.00',
        submittedAt: now,
        items: {
          create: input.items.map((requested, index) => {
            const sourceItem = sourceItemById.get(
              requested.sourceOrderItemId,
            )!;
            const productionFacts = productionFactsBySourceItemId.get(
              sourceItem.id,
            )!;
            return {
              sequence: index + 1,
              name: sourceItem.name,
              productId: sourceItem.productId,
              pricingRoute: sourceItem.pricingRoute,
              craft: productionFacts.craft,
              productStructure: sourceItem.productStructure,
              artworkVersion: sourceItem.artworkVersion,
              plateGroupId: sourceItem.plateGroupId,
              pricingGroup: sourceItem.pricingGroup,
              manualQuoteReason: sourceItem.manualQuoteReason,
              specification: sourceItem.specification,
              actualWidthMm: sourceItem.actualWidthMm,
              actualHeightMm: sourceItem.actualHeightMm,
              paperType: sourceItem.paperType,
              paperWeightGsm: sourceItem.paperWeightGsm,
              quantity: requested.quantity,
              pack: unitsPerBagBySourceItemId.get(sourceItem.id),
              crafts: requested.craftIds,
              frontFoilColors: productionFacts.frontFoilColors,
              backFoilColors: productionFacts.backFoilColors,
              foilColors: productionFacts.foilColors,
              foilTechnique: productionFacts.foilTechnique,
              hasLocalFoil: productionFacts.hasLocalFoil,
              lamination: sourceItem.lamination,
              printColors: sourceItem.printColors,
              printColorsKnown: sourceItem.printColorsKnown,
              isDoubleSided: productionFacts.isDoubleSided,
              isDoubleColor: productionFacts.isDoubleColor,
              unitPrice: '0',
              fixedFee: '0',
              subtotal: '0',
              suggestedSubtotal: null,
              pricingSnapshot: {
                version: 1,
                source: 'FREE_REWORK',
                sourceOrderId: source.id,
                sourceOrderItemId: sourceItem.id,
              },
              priceOverrideReason: '免费重做，不计加工费',
              remark: sourceItem.remark,
              designs: {
                create: sourceItem.designs.map((design) => ({
                  fileType: design.fileType,
                  fileUrl: design.fileUrl,
                  fileName: design.fileName,
                  fileSize: design.fileSize,
                  thumbnailUrl: design.thumbnailUrl,
                  uploadedBy: design.uploadedBy,
                  uploadedAt: design.uploadedAt,
                })),
              },
            };
          }),
        },
        logs: {
          create: {
            operatorId: actor.id,
            action: 'CREATE_REWORK',
            changedFields: {
              sourceOrderId: { before: null, after: source.id },
              billingMode: {
                before: null,
                after: OrderBillingMode.NO_CHARGE,
              },
            },
            remark: `由原工单 ${source.orderNo} 创建重做单：${input.reason}`,
          },
        },
      },
      select: {
        id: true,
        orderNo: true,
        items: { select: { id: true, sequence: true } },
      },
    });

    const shipment = await tx.orderShipment.create({
      data: {
        orderId: createdOrder.id,
        sequence: 1,
        receiverName:
          primarySourceShipment?.receiverName ?? source.receiverName,
        receiverPhone:
          primarySourceShipment?.receiverPhone ?? source.receiverPhone,
        receiverAddress,
        expressCode: primarySourceShipment?.expressCode ?? source.expressCode,
        status: ShipmentStatus.PLANNED,
      },
      select: { id: true },
    });
    const createdItemIdBySequence = new Map(
      createdOrder.items.map((item) => [item.sequence, item.id]),
    );
    await tx.orderShipmentLine.createMany({
      data: input.items.map((item, index) => {
        const orderItemId = createdItemIdBySequence.get(index + 1);
        if (!orderItemId) {
          throw new ReworkOrderError(
            `重做单缺少款式 #${index + 1} 的持久化记录`,
          );
        }
        return {
          shipmentId: shipment.id,
          orderItemId,
          quantity: item.quantity,
        };
      }),
    });
    const persistedPackagingGroups: Array<{
      sequence: number;
      name: string | null;
      mode: OrderPackagingMode;
      actualBagCount: number;
      itemUnitsPerBag: Array<{ orderItemId: string; unitsPerBag: number }>;
    }> = [];
    for (const plan of packagingPlans) {
      const createdGroup = await tx.orderPackagingGroup.create({
        data: {
          orderId: createdOrder.id,
          sequence: plan.sequence,
          name: plan.name,
          mode: plan.mode,
          actualBagCount: plan.actualBagCount,
          unitPrice: '0',
          subtotal: '0',
          suggestedSubtotal: null,
          pricingSnapshot: {
            version: 1,
            source: 'FREE_REWORK',
            sourceOrderId: source.id,
            actualBagCount: plan.actualBagCount,
          },
          priceOverrideReason: '免费重做，不计入客户收费',
        },
        select: { id: true },
      });
      const lines = plan.members.map((member) => {
        const orderItemId = createdItemIdBySequence.get(
          member.requestedIndex + 1,
        );
        if (!orderItemId) {
          throw new ReworkOrderError(
            `重做包装组 #${plan.sequence} 找不到对应款式`,
          );
        }
        return {
          orderId: createdOrder.id,
          packagingGroupId: createdGroup.id,
          orderItemId,
          unitsPerBag: member.unitsPerBag,
        };
      });
      await tx.orderPackagingGroupLine.createMany({ data: lines });
      persistedPackagingGroups.push({
        sequence: plan.sequence,
        name: plan.name,
        mode: plan.mode,
        actualBagCount: plan.actualBagCount,
        itemUnitsPerBag: lines.map((line) => ({
          orderItemId: line.orderItemId,
          unitsPerBag: line.unitsPerBag,
        })),
      });
    }
    await pricingTx.orderPricingRevision.create({
      data: {
        orderId: createdOrder.id,
        revision: 1,
        status: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
        source: 'REWORK_ORDER_CREATED_NO_CHARGE',
        createdById: actor.id,
        createdAt: now,
        snapshot: {
          version: 1,
          source: 'REWORK_ORDER_CREATED_NO_CHARGE',
          pricedAt: now.toISOString(),
          order: {
            id: createdOrder.id,
            orderNo: createdOrder.orderNo,
            settlementType: OrderSettlementType.NO_CHARGE,
            pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
            priceRevision: 1,
            processingAmount: '0.00',
            totalAmount: '0.00',
          },
          items: input.items.map((requested, index) => {
            const sourceItem = sourceItemById.get(
              requested.sourceOrderItemId,
            )!;
            return {
              id: createdItemIdBySequence.get(index + 1) ?? null,
              sequence: index + 1,
              name: sourceItem.name,
              quantity: requested.quantity,
              unitPrice: '0',
              fixedFee: '0',
              subtotal: '0',
              suggestedSubtotal: null,
              priceOverrideReason: '免费重做，不计加工费',
              requiresAdminConfirmation: false,
              pricingSnapshot: {
                version: 1,
                source: 'FREE_REWORK',
                sourceOrderId: source.id,
                sourceOrderItemId: sourceItem.id,
              },
            };
          }),
          packagingGroups: persistedPackagingGroups.map((group) => ({
            ...group,
            unitPrice: '0',
            subtotal: '0',
            suggestedSubtotal: null,
            priceOverrideReason: '免费重做，不计入客户收费',
            requiresAdminConfirmation: false,
          })),
          customerCharges: [],
        },
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: source.id,
        operatorId: actor.id,
        action: 'CREATE_REWORK',
        changedFields: {
          reworkOrderId: { before: null, after: createdOrder.id },
        },
        remark: `创建重做工单 ${createdOrder.orderNo}：${input.reason}`,
      },
    });
    try {
      await activateProductionOperationsInTx(
        tx,
        createdOrder.id,
        actor,
        now,
      );
    } catch (error) {
      if (error instanceof ProductionOperationMaterializationError) {
        throw new ReworkOrderError(`重做单无法投产：${error.message}`);
      }
      throw error;
    }

    if (backgroundJobsMode() === 'durable') {
      const payload = await tx.order.findUniqueOrThrow({
        where: { id: createdOrder.id },
        select: {
          id: true,
          orderNo: true,
          customerRef: true,
          totalAmount: true,
          isUrgent: true,
          submitter: { select: { displayName: true } },
        },
      });
      notificationQueued = await enqueueNotificationInTransaction(
        tx as unknown as EnqueueClient,
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          totalAmount: String(payload.totalAmount),
          urgentMark: payload.isUrgent ? '🚨 急单' : '',
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
      );
      if (payload.isUrgent) {
        const urgentQueued = await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'URGENT_ORDER',
          {
            orderId: payload.id,
            orderNo: payload.orderNo,
            submitterName: payload.submitter.displayName,
            customerRef: payload.customerRef,
          },
          { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
        );
        notificationQueued = notificationQueued && urgentQueued;
      }
    }

    return createdOrder;
  });

  const payload = notificationQueued ? null : await db.order.findUnique({
    where: { id: created.id },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      totalAmount: true,
      isUrgent: true,
      submitter: { select: { displayName: true } },
    },
  });
  if (payload) {
    await dispatchNotification(
      'ORDER_SUBMITTED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        submitterName: payload.submitter.displayName,
        customerRef: payload.customerRef,
        totalAmount: String(payload.totalAmount),
        urgentMark: payload.isUrgent ? '🚨 急单' : '',
      },
      { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
    );
    if (payload.isUrgent) {
      await dispatchNotification(
        'URGENT_ORDER',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
      );
    }
  }

  return { id: created.id, orderNo: created.orderNo };
}
