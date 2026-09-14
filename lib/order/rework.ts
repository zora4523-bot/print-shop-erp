import { isValidPackagingUnitsPerBag, MAX_PACKAGING_UNITS_PER_BAG } from './packaging-units';
import { isMixedPackaging, packagingModeWithStyleCount, packagingBoxType } from './packaging-mode';
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
import { getSetting } from '../settings';

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

export const REWORK_PACKAGING_FACT_SOURCES = {
  SOURCE_GROUP: 'SOURCE_GROUP',
  SOURCE_ITEM_PACK: 'SOURCE_ITEM_PACK',
  ADMIN_INPUT: 'ADMIN_INPUT',
} as const;

export type ReworkPackagingFactSource =
  (typeof REWORK_PACKAGING_FACT_SOURCES)[keyof typeof REWORK_PACKAGING_FACT_SOURCES];

/**
 * The admin form only asks for missing per-style legacy evidence. One
 * structured membership is canonical; duplicate memberships fail closed in
 * the domain and therefore must not expose an override field either.
 */
export function reworkItemRequiresUnitsPerBagInput(
  structuredPackagingMembershipCount: number,
  sourceItemPack: number | null | undefined,
): boolean {
  return (
    structuredPackagingMembershipCount === 0 &&
    !isValidPackagingUnitsPerBag(sourceItemPack)
  );
}

type ReworkPackagingPlan = {
  sequence: number;
  name: string | null;
  mode: OrderPackagingMode;
  actualBagCount: number;
  factSource: ReworkPackagingFactSource;
  sourcePackagingGroupId: string | null;
  members: Array<{
    requestedIndex: number;
    sourceOrderItemId: string;
    unitsPerBag: number;
    bagCount: number;
  }>;
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

type ReworkNotificationPayload = {
  id: string;
  orderNo: string;
  customerRef: string | null;
  isUrgent: boolean;
  submitter: { displayName: string };
};

async function enqueueReworkNotificationsInTx(
  tx: EnqueueClient,
  payload: ReworkNotificationPayload,
  submittedEnabled: boolean,
): Promise<{ submittedQueued: boolean; urgentQueued: boolean }> {
  const submittedQueued = submittedEnabled
    ? await enqueueNotificationInTransaction(
        tx,
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          urgentMark: payload.isUrgent ? '🚨 急单' : '',
          summary: '重做工单已提交，待工厂确认',
          deepLink: `/orders#wo=${encodeURIComponent(payload.orderNo)}`,
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
      )
    : true;
  const urgentQueued = payload.isUrgent
    ? await enqueueNotificationInTransaction(
        tx,
        'URGENT_ORDER',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
      )
    : true;
  return { submittedQueued, urgentQueued };
}

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

  const submittedNotificationEnabled = await getSetting(
    'notify_order_submitted_enabled',
  )
    .then((setting) => setting.enabled)
    .catch(() => true);
  const { created, notificationState } = await db.$transaction(async (tx) => {
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
      if (
        item.unitsPerBag !== undefined &&
        !isValidPackagingUnitsPerBag(item.unitsPerBag)
      ) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”的每袋数量必须是 1 至 ${MAX_PACKAGING_UNITS_PER_BAG} 的整数`,
        );
      }
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
    const activeCrafts =
      requestedCraftIds.size === 0
        ? []
        : await tx.craft.findMany({
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

    type SourcePackagingMembership = {
      sourceGroupId: string;
      sourceGroupSequence: number;
      sourceGroupName: string | null;
      unitsPerBag: number;
    };
    const packagingMemberships = new Map<
      string,
      SourcePackagingMembership[]
    >();
    const sourcePackagingGroupById = new Map<
      string,
      (typeof source.packagingGroups)[number]
    >();
    const duplicateSourcePackagingGroupIds = new Set<string>();
    for (const group of source.packagingGroups) {
      if (sourcePackagingGroupById.has(group.id)) {
        duplicateSourcePackagingGroupIds.add(group.id);
      }
      sourcePackagingGroupById.set(group.id, group);
      for (const line of group.lines) {
        const memberships = packagingMemberships.get(line.orderItemId) ?? [];
        memberships.push({
          sourceGroupId: group.id,
          sourceGroupSequence: group.sequence,
          sourceGroupName: group.name,
          unitsPerBag: line.unitsPerBag,
        });
        packagingMemberships.set(line.orderItemId, memberships);
      }
    }

    const validatedSourceGroupIds = new Set<string>();
    const validateRelevantSourceGroup = (
      group: (typeof source.packagingGroups)[number],
    ) => {
      if (validatedSourceGroupIds.has(group.id)) return;
      if (duplicateSourcePackagingGroupIds.has(group.id)) {
        throw new ReworkOrderError(
          `原单包装组 ${group.id} 重复，请先修复原单包装事实`,
        );
      }
      if (
        !Number.isSafeInteger(group.actualBagCount) ||
        (group.mode === OrderPackagingMode.UNPACKED ? group.actualBagCount !== 0 : group.actualBagCount <= 0)
      ) {
        throw new ReworkOrderError(
          `原包装组 #${group.sequence} 的实际袋数非法，请先修复原单包装事实`,
        );
      }
      if (group.lines.length === 0) {
        throw new ReworkOrderError(
          `原包装组 #${group.sequence} 没有款式明细，请先修复原单包装事实`,
        );
      }
      if (
        (group.mode !== OrderPackagingMode.UNPACKED && !isMixedPackaging(group.mode) &&
          group.lines.length !== 1) ||
        (isMixedPackaging(group.mode) &&
          group.lines.length < 2)
      ) {
        throw new ReworkOrderError(
          `原包装组 #${group.sequence} 的包装方式与款式明细不一致，请先修复原单包装事实`,
        );
      }
      const itemIdsInGroup = new Set<string>();
      for (const line of group.lines) {
        const sourceItem = sourceItemById.get(line.orderItemId);
        if (!sourceItem) {
          throw new ReworkOrderError(
            `原包装组 #${group.sequence} 引用了不属于原单的款式，请先修复原单包装事实`,
          );
        }
        if (itemIdsInGroup.has(sourceItem.id)) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”在原包装组 #${group.sequence} 重复，请先修复原单包装事实`,
          );
        }
        itemIdsInGroup.add(sourceItem.id);
        if (
          !isValidPackagingUnitsPerBag(line.unitsPerBag) ||
          (group.mode !== OrderPackagingMode.UNPACKED && !packagingBoxType(group.mode) && Math.ceil(sourceItem.quantity / line.unitsPerBag) !== group.actualBagCount)
        ) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”的原单每袋数与实际袋数不一致，请先修复原单包装事实`,
          );
        }
      }
      validatedSourceGroupIds.add(group.id);
    };

    const packagingPlanBySourceGroupId = new Map<
      string,
      {
        sourceSequence: number;
        sourceName: string | null;
        firstRequestedIndex: number;
        members: ReworkPackagingPlan['members'];
      }
    >();
    const fallbackPlans: Array<
      ReworkPackagingPlan & { firstRequestedIndex: number }
    > = [];
    for (const [requestedIndex, requested] of input.items.entries()) {
      const sourceItem = sourceItemById.get(requested.sourceOrderItemId)!;
      const memberships = packagingMemberships.get(sourceItem.id) ?? [];
      if (memberships.length > 1) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”在原单同时属于 ${memberships.length} 个包装组，拒绝猜测重做包装口径`,
        );
      }
      const membership = memberships[0];
      if (!membership) {
        const usesSourceItemPack = isValidPackagingUnitsPerBag(sourceItem.pack);
        const unitsPerBag = usesSourceItemPack
          ? sourceItem.pack
          : requested.unitsPerBag;
        if (!isValidPackagingUnitsPerBag(unitsPerBag)) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”的原单未记录每袋数量，请由管理员显式填写“每袋数量（原单未记录）”`,
          );
        }
        const bagCount = Math.ceil(requested.quantity / unitsPerBag);
        fallbackPlans.push({
          sequence: 0,
          name: `重做 · ${sourceItem.name}`,
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: bagCount,
          factSource: usesSourceItemPack
            ? REWORK_PACKAGING_FACT_SOURCES.SOURCE_ITEM_PACK
            : REWORK_PACKAGING_FACT_SOURCES.ADMIN_INPUT,
          sourcePackagingGroupId: null,
          firstRequestedIndex: requestedIndex,
          members: [
            {
              requestedIndex,
              sourceOrderItemId: sourceItem.id,
              unitsPerBag,
              bagCount,
            },
          ],
        });
        continue;
      }

      const sourceGroup = sourcePackagingGroupById.get(
        membership.sourceGroupId,
      );
      if (!sourceGroup) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”的原单包装组不存在，请先修复原单包装事实`,
        );
      }
      validateRelevantSourceGroup(sourceGroup);
      const bagCount = Math.ceil(requested.quantity / membership.unitsPerBag);
      const plan = packagingPlanBySourceGroupId.get(membership.sourceGroupId) ?? {
        sourceSequence: membership.sourceGroupSequence,
        sourceName: membership.sourceGroupName,
        firstRequestedIndex: requestedIndex,
        members: [],
      };
      plan.firstRequestedIndex = Math.min(
        plan.firstRequestedIndex,
        requestedIndex,
      );
      plan.members.push({
        requestedIndex,
        sourceOrderItemId: sourceItem.id,
        unitsPerBag: membership.unitsPerBag,
        bagCount,
      });
      packagingPlanBySourceGroupId.set(membership.sourceGroupId, plan);
    }

    const canonicalPlans = [...packagingPlanBySourceGroupId.entries()].map(
      ([sourcePackagingGroupId, plan]) => {
        const bagCounts = [
          ...new Set(plan.members.map((member) => member.bagCount)),
        ];
        if (sourcePackagingGroupById.get(sourcePackagingGroupId)!.mode !== OrderPackagingMode.UNPACKED && bagCounts.length !== 1) {
          throw new ReworkOrderError(
            `原包装组 #${plan.sourceSequence} 的重做数量无法沿用同一混装袋数，请调整重做数量或先拆分原单包装事实`,
          );
        }
        return {
          sequence: 0,
          name: plan.sourceName,
          mode: packagingModeWithStyleCount(sourcePackagingGroupById.get(sourcePackagingGroupId)!.mode, plan.members.length),
          actualBagCount: sourcePackagingGroupById.get(sourcePackagingGroupId)!.mode === OrderPackagingMode.UNPACKED ? 0 : bagCounts[0]!,
          factSource: REWORK_PACKAGING_FACT_SOURCES.SOURCE_GROUP,
          sourcePackagingGroupId,
          firstRequestedIndex: plan.firstRequestedIndex,
          members: plan.members,
        };
      },
    );
    const packagingPlans: ReworkPackagingPlan[] = [
      ...canonicalPlans,
      ...fallbackPlans,
    ]
      .sort(
        (left, right) => left.firstRequestedIndex - right.firstRequestedIndex,
      )
      .map((plan, index) => ({
        sequence: index + 1,
        name: plan.name,
        mode: plan.mode,
        actualBagCount: plan.actualBagCount,
        factSource: plan.factSource,
        sourcePackagingGroupId: plan.sourcePackagingGroupId,
        members: plan.members,
      }));
    const unitsPerBagBySourceItemId = new Map(
      packagingPlans.flatMap((plan) =>
        plan.members.map(
          (member) =>
            [member.sourceOrderItemId, member.unitsPerBag] as const,
        ),
      ),
    );
    const packagingFactSourceBySourceItemId = new Map(
      packagingPlans.flatMap((plan) =>
        plan.members.map(
          (member) => [member.sourceOrderItemId, plan.factSource] as const,
        ),
      ),
    );
    const packagingFactEvidence = packagingPlans.map((plan) => ({
      sequence: plan.sequence,
      source: plan.factSource,
      sourcePackagingGroupId: plan.sourcePackagingGroupId,
      members: plan.members.map((member) => ({
        sourceOrderItemId: member.sourceOrderItemId,
        unitsPerBag: member.unitsPerBag,
        bagCount: member.bagCount,
      })),
    }));

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
        quotedFee: null,
        confirmedFee: '0.00',
        settledFee: null,
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
                packagingFactSource:
                  packagingFactSourceBySourceItemId.get(sourceItem.id),
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
              packagingFactSources: {
                before: null,
                after: packagingFactEvidence,
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
      packagingFactSource: ReworkPackagingFactSource;
      sourcePackagingGroupId: string | null;
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
            packagingFactSource: plan.factSource,
            sourcePackagingGroupId: plan.sourcePackagingGroupId,
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
        packagingFactSource: plan.factSource,
        sourcePackagingGroupId: plan.sourcePackagingGroupId,
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
            quotedFee: null,
            confirmedFee: '0.00',
            settledFee: null,
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
                packagingFactSource:
                  packagingFactSourceBySourceItemId.get(sourceItem.id),
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
          packagingFactSources: {
            before: null,
            after: packagingFactEvidence,
          },
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
          isUrgent: true,
          submitter: { select: { displayName: true } },
        },
      });
      return {
        created: createdOrder,
        notificationState: await enqueueReworkNotificationsInTx(
          tx as unknown as EnqueueClient,
          payload,
          submittedNotificationEnabled,
        ),
      };
    }

    return {
      created: createdOrder,
      notificationState: {
        submittedQueued: !submittedNotificationEnabled,
        urgentQueued: false,
      },
    };
  });

  const {
    submittedQueued: submittedNotificationQueued,
    urgentQueued: urgentNotificationQueued,
  } = notificationState;

  const payload =
    submittedNotificationQueued && urgentNotificationQueued
      ? null
      : await db.order.findUnique({
          where: { id: created.id },
          select: {
            id: true,
            orderNo: true,
            customerRef: true,
            isUrgent: true,
            submitter: { select: { displayName: true } },
          },
        });
  if (payload) {
    if (submittedNotificationEnabled && !submittedNotificationQueued) {
      await dispatchNotification(
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          urgentMark: payload.isUrgent ? '🚨 急单' : '',
          summary: '重做工单已提交，待工厂确认',
          deepLink: `/orders#wo=${encodeURIComponent(payload.orderNo)}`,
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
      );
    }
    if (payload.isUrgent && !urgentNotificationQueued) {
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
