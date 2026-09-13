import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { createOrderSchema } from '@/lib/auth/schemas';
import { calculatePackagingBagCount } from '@/lib/order/packaging-bag-count';
import { orderCascadeLockKey } from '@/lib/order/locks';
import {
  ExternalOrderQuoteChangedError,
  finalizeExternalOrderQuoteInTx,
} from '@/lib/order/submit-external-order';

export const DASHBOARD_ORDER_ID = /^e2e-dash-([a-f0-9]{16})-sub-(1|2|3-urgent)$/;
export const completionInclude = {
  _count: { select: {
    reworkOrders: true,
    items: true,
    packagingGroups: true,
    shipments: true,
    outsourceOrders: true,
    logs: true,
    billItems: true,
    changeRequests: true,
    costEntries: true,
    customerCharges: true,
    csSalesEntries: true,
    pricingRevisions: true,
    productionOperations: true,
    productionProgressSteps: true,
    productionWorkOrderProgress: true,
    productionScanClaims: true,
    stars: true,
    printJobs: true,
    workflowDecisions: true,
    exportSelections: true,
  } },
  submitter: { select: { id: true, role: true, username: true, isActive: true } },
  agentMonthlyBillItem: { select: { id: true } },
} satisfies Prisma.OrderInclude;
export type CompletionOrder = Prisma.OrderGetPayload<{ include: typeof completionInclude }>;

export function assertLocalFixtureDatabase(databaseUrl: string, environment?: string) {
  const url = new URL(databaseUrl);
  if (
    environment === 'production' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    /prod/i.test(decodeURIComponent(url.pathname)) ||
    ['host', 'hostaddr', 'service'].some((key) => url.searchParams.has(key))
  ) throw new Error('仅允许本机非生产测试数据库');
}

/** Fail closed: only untouched dashboard shells, never existing business history. */
export function completionSkipReason(order: CompletionOrder): string | null {
  const match = DASHBOARD_ORDER_ID.exec(order.id);
  if (!match || order.orderNo !== `E2E-DASH-${match[1]}-SUB-${match[2].toUpperCase()}`) {
    return '不属于指定的工作台测试工单';
  }
  const ownerId = `e2e-dash-${match[1]}-sales`;
  if (order.submitterId !== ownerId || order.createdById !== ownerId ||
    order.submitter.id !== ownerId || order.submitter.role !== 'SALES' ||
    order.submitter.isActive || order.submitter.username !== ownerId ||
    order.submitterRole !== 'SALES' || order.settlementType !== 'EXTERNAL_SALES') {
    return '测试账号或归属不符合预期';
  }
  if (order.status !== 'SUBMITTED' || order.kind !== 'NORMAL' || order.billingMode !== 'CHARGE' ||
    order.sourceOrderId || order.customerPartyId || order.agentMonthlyBillItem ||
    order.pricingConfirmedAt || order.pricingConfirmedById || order.settlementContractVersion ||
    order.scheduledAt || order.completedAt || order.shippedAt || order.finishedAt || order.settledAt ||
    order.trackingNo || order.requiresOutsource || order.revision !== 1 || order.workOrderVersion !== 1 ||
    order.nextItemFig !== 1 || order.clientSubmissionId !== null) {
    return '已有业务流转或客户关联';
  }
  if (Object.entries(order._count).some(([key, count]) => !['logs', 'stars'].includes(key) && count > 0)) {
    return '已有关联明细或历史记录';
  }
  if ([order.totalAmount, order.processingAmount, order.packagingAmount].some((amount) => !amount.isZero()) ||
    order.quotedFee !== null || order.confirmedFee !== null || order.settledFee !== null ||
    order.quotedPricingRevisionId !== null || order.quotedFeeCompleteness !== null || order.priceRevision !== 1) {
    return '已有金额或价格快照';
  }
  if (order.receiverName || order.receiverPhone || order.receiverAddress || order.expressCode || order.isSfCollect) {
    return '已填写配送资料，需要人工核对';
  }
  return null;
}

export function buildCompletionInput(order: Pick<CompletionOrder, 'id' | 'customName' | 'customerRef' | 'remark' | 'packageRequirement' | 'promisedDate' | 'isUrgent'>) {
  const match = DASHBOARD_ORDER_ID.exec(order.id);
  if (!match) throw new Error('无效的测试工单编号');
  // The current logistics policy requires manual freight above 2,000 per order.
  const quantities = match[2] === '1' ? [1000] : match[2] === '2' ? [1000, 1000] : [500, 500, 500, 500];
  const names = ['春日平安', '祥云纳福', '花开富贵', '金玉满堂'];
  const items = quantities.map((quantity, i) => ({
    fig: i + 1, name: `${names[i]} · 测试款`,
    productId: 'prd_v2_39953dbc7b8d18bb4d5b0cd7',
    pricingRoute: 'STOCK_BLANK', productStructure: 'STANDARD_ENVELOPE',
    specification: '大号封90×165', paperType: '160g珠光艳闪', paperWeightGsm: 160,
    actualWidthMm: 90, actualHeightMm: 165, quantity, pack: i % 2 === 0 ? 10 : 12,
    crafts: ['craft_flat_foil_partial'], frontFoilColors: ['亚金'], backFoilColors: [],
    foilColors: ['亚金'], foilTechnique: 'FLAT', hasLocalFoil: true,
    lamination: 'NONE', printColors: [], isDoubleSided: false, isDoubleColor: false,
    remark: '界面与计价演示样稿；未提供 CDR 生产原稿。',
  }));
  const packagingGroups = items.map((item, i) => {
    const itemUnitsPerBag = items.map((_, j) => i === j ? item.pack : 0);
    const count = calculatePackagingBagCount({ mode: 'SINGLE_STYLE', itemQuantities: quantities, itemUnitsPerBag });
    if (!count.complete) throw new Error(count.errors.join('；'));
    return { name: `${names[i]}单款装`, mode: 'SINGLE_STYLE', actualBagCount: count.bagCount, itemUnitsPerBag };
  });
  // Far-future date keeps demonstration fixtures out of real overdue reminders.
  return createOrderSchema.parse({
    customName: order.customName?.trim() || `测试 · ${items.length}款红包${order.isUrgent ? '（急单）' : ''}`,
    customerRef: order.customerRef?.trim() || '演示客户',
    receiverName: '测试收货人', receiverPhone: '00000000000',
    receiverAddress: '广东省广州市测试区测试路1号（演示地址，请勿发货）',
    expressCode: null, destinationProvince: '广东省', isSfCollect: false,
    packageRequirement: order.packageRequirement || '按款分袋，外袋标明款式及数量。',
    remark: order.remark || '开发测试工单，仅用于界面、分袋和自动计价验证；请勿实际生产或发货，CDR 原稿待上传。',
    promisedDate: order.promisedDate || new Date('2099-12-31T00:00:00.000Z'),
    isUrgent: order.isUrgent, nextItemFig: items.length + 1, items, packagingGroups,
  });
}

function artwork(fig: number) {
  // A genuine, self-contained SVG preview, explicitly not a fabricated CDR.
  const colors = ['#a61125', '#b52130', '#9c2034', '#a53125'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="660" viewBox="0 0 360 660"><rect width="360" height="660" rx="12" fill="${colors[(fig - 1) % colors.length]}"/><rect x="24" y="24" width="312" height="612" rx="8" fill="none" stroke="#e9c674" stroke-width="3"/><path d="M24 84L180 150L336 84" fill="none" stroke="#e9c674" stroke-width="2"/><circle cx="180" cy="320" r="96" fill="none" stroke="#e9c674" stroke-width="4"/><text x="180" y="345" text-anchor="middle" fill="#e9c674" font-size="68" font-family="serif">福</text><text x="180" y="520" text-anchor="middle" fill="#ffeac0" font-size="22">测试样稿 ${fig}</text><text x="180" y="570" text-anchor="middle" fill="#ffeac0" font-size="16">仅供演示 · 不可生产</text></svg>`;
  return { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, bytes: BigInt(Buffer.byteLength(svg)) };
}

export async function completeDashboardOrderInTx(tx: Prisma.TransactionClient, orderId: string, actorId: string, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
  const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: completionInclude });
  const reason = completionSkipReason(before);
  if (reason) throw new Error(`${orderId}: ${reason}`);
  const input = buildCompletionInput(before);
  await tx.order.update({ where: { id: orderId, editVersion: before.editVersion }, data: {
    // This transient state is invisible outside this atomic fixture transaction.
    status: 'DRAFT', customName: input.customName, customerRef: input.customerRef,
    receiverName: input.receiverName, receiverPhone: input.receiverPhone, receiverAddress: input.receiverAddress,
    packageRequirement: input.packageRequirement, remark: input.remark,
    promisedDate: input.promisedDate, nextItemFig: input.nextItemFig, editVersion: { increment: 1 },
  } });
  const itemIds: string[] = [];
  for (const [i, item] of input.items.entries()) {
    const preview = artwork(i + 1);
    const created = await tx.orderItem.create({ data: {
      orderId, sequence: i + 1, fig: item.fig, name: item.name, productId: item.productId,
      pricingRoute: item.pricingRoute, productStructure: item.productStructure, craft: 'PARTIAL',
      specification: item.specification, paperType: item.paperType, paperWeightGsm: item.paperWeightGsm,
      actualWidthMm: item.actualWidthMm, actualHeightMm: item.actualHeightMm,
      quantity: item.quantity, pack: item.pack, crafts: item.crafts,
      frontFoilColors: item.frontFoilColors, backFoilColors: item.backFoilColors, foilColors: item.foilColors,
      foilTechnique: item.foilTechnique, hasLocalFoil: item.hasLocalFoil,
      lamination: item.lamination, printColors: item.printColors, printColorsKnown: true,
      isDoubleSided: item.isDoubleSided, isDoubleColor: item.isDoubleColor, remark: item.remark,
      designs: { create: { fileType: 'IMAGE', fileUrl: preview.url, thumbnailUrl: preview.url,
        fileName: `测试样稿-${i + 1}.svg`, fileSize: preview.bytes, uploadedBy: actorId } },
    }, select: { id: true } });
    itemIds.push(created.id);
  }
  for (const [i, group] of input.packagingGroups.entries()) {
    const created = await tx.orderPackagingGroup.create({ data: {
      orderId, sequence: i + 1, name: group.name, mode: group.mode, actualBagCount: group.actualBagCount,
    }, select: { id: true } });
    await tx.orderPackagingGroupLine.createMany({ data: group.itemUnitsPerBag.flatMap((unitsPerBag, index) => unitsPerBag > 0
      ? [{ orderId, packagingGroupId: created.id, orderItemId: itemIds[index]!, unitsPerBag }] : []) });
  }
  await tx.orderShipment.create({ data: {
    orderId, sequence: 1, receiverName: input.receiverName, receiverPhone: input.receiverPhone,
    receiverAddress: input.receiverAddress, carrierCode: 'ZTO', destinationProvince: input.destinationProvince,
    lines: { create: input.items.map((item, i) => ({ orderItemId: itemIds[i]!, quantity: item.quantity })) },
  } });
  let token: string;
  try {
    await finalizeExternalOrderQuoteInTx(tx, orderId, actorId, now);
    throw new Error('未报价的测试工单意外复用了历史报价');
  } catch (error) {
    if (!(error instanceof ExternalOrderQuoteChangedError)) throw error;
    token = error.quoteToken;
  }
  const quote = await finalizeExternalOrderQuoteInTx(tx, orderId, actorId, now, token);
  if (quote.quotedFeeCompleteness !== 'COMPLETE' || quote.manualItemIds.length ||
    !new Decimal(quote.quotedFee).greaterThan(0)) {
    throw new Error(`${orderId} 的测试报价不完整，事务已回滚；请检查当前发布的加工、包装和物流规则`);
  }
  await tx.order.update({ where: { id: orderId }, data: { status: before.status } });
  await tx.orderLog.create({ data: {
    orderId, operatorId: actorId, action: 'UPDATE',
    remark: '补齐工作台测试工单：款式、演示图、分袋、配送及当前规则报价；保留原编号、归属和状态，未上传 CDR 原稿。',
    changedFields: {
      source: 'COMPLETE_DASHBOARD_FIXTURE_V1',
      items: { before: 0, after: itemIds.length },
      shipments: { before: 0, after: 1 },
      quotedFee: { before: null, after: quote.quotedFee },
      pricingRevisionId: quote.pricingRevisionId,
    },
  } });
  return { id: orderId, orderNo: before.orderNo, items: itemIds.length,
    quantity: input.items.reduce((sum, item) => sum + item.quantity, 0),
    bags: input.packagingGroups.reduce((sum, group) => sum + group.actualBagCount, 0),
    quotedFee: quote.quotedFee, processing: quote.processingAmount, packaging: quote.packagingAmount,
    logistics: quote.logisticsAmount, pricingRevisionId: quote.pricingRevisionId };
}
