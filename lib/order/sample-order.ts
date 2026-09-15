import Decimal from 'decimal.js';
import { db } from '../db';
import type { Prisma } from '../../generated/prisma/client';
import { OrderQuotedFeeCompleteness } from '../../generated/prisma/enums';
import { createOrderSchema, type CreateOrderInput } from '../auth/schemas';
import { calculateExternalOrderCharges } from '../price/external-order-charges';
import { readPublishedCreateOrderPriceSnapshot } from './create-order-published-rule-adapter';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { buildCreateOrderQuoteInputFromCatalog } from './create-order-quote-facts-adapter';
import { isNewOrderPricingRoute } from './pricing-route';
import { isSampleOrder } from './purpose';

export class SampleOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SampleOrderError';
  }
}
export class SampleQuoteChangedError extends SampleOrderError {
  constructor(public readonly quote: SampleOrderQuote) {
    super('费用已更新，请核对后重新提交');
  }
}
export const PROOF_TOTAL_BUSINESS_KEY = 'ORDER:PROOF:TOTAL';

export type SampleQuoteFacts = {
  purpose: 'SAMPLE_SHIPMENT' | 'PROOF';
  samplePackagingRuleCode?: string | null;
  isSfCollect: boolean;
  shipments: Array<{
    shipmentKey: string;
    province: string | null;
    quantity: number;
    weightKg?: string | null;
  }>;
};
export type SampleOrderQuote = {
  total: string | null;
  knownTotal: string;
  quoteToken: string;
  shippingAmount: string | null;
  packagingAmount: string | null;
  packagingOptions: Array<{ code: string; label: string; amount: string }>;
  errors: string[];
};

export function sampleQuoteFacts(input: CreateOrderInput): SampleQuoteFacts {
  if (!isSampleOrder(input.purpose))
    throw new SampleOrderError('请选择寄样品或打样');
  const extra = input.additionalShipments.map((shipment, index) => ({
    shipmentKey: String(index + 2),
    province: shipment.destinationProvince,
    weightKg: null,
    quantity: shipment.itemQuantities.reduce((sum, n) => sum + n, 0),
  }));
  return {
    purpose: input.purpose as SampleQuoteFacts['purpose'],
    samplePackagingRuleCode: input.samplePackagingRuleCode,
    isSfCollect: input.isSfCollect,
    shipments: [
      {
        shipmentKey: '1',
        province: input.destinationProvince,
        weightKg: null,
        quantity:
          input.items.reduce((sum, item) => sum + item.quantity, 0) -
          extra.reduce((sum, row) => sum + row.quantity, 0),
      },
      ...extra,
    ],
  };
}

async function calculateSampleQuote(
  tx: Prisma.TransactionClient,
  facts: SampleQuoteFacts,
  now: Date,
) {
  const snapshot = await readPublishedCreateOrderPriceSnapshot(tx, { now });
  if (
    facts.purpose === 'SAMPLE_SHIPMENT' &&
    facts.samplePackagingRuleCode &&
    !snapshot.orderCharges.rules.some(
      (rule) =>
        rule.kind === 'PACKAGING' &&
        rule.code === facts.samplePackagingRuleCode,
    )
  ) {
    throw new SampleOrderError('所选包装已不可用，请重新选择包装规格');
  }
  const logistics =
    facts.purpose === 'PROOF'
      ? null
      : calculateExternalOrderCharges(
          {
            isSfCollect: facts.isSfCollect,
            samplePackaging: {
              ruleCode: facts.samplePackagingRuleCode ?? null,
            },
            shipments: facts.shipments.map((shipment) => ({
              shipmentKey: shipment.shipmentKey,
              province: shipment.province,
              itemQuantity: shipment.quantity,
              billableWeightKg: shipment.weightKg ?? null,
              requiresActualWeight: true,
            })),
          },
          snapshot.orderCharges.rules,
          snapshot.orderCharges.logisticsPolicy,
        );
  const total = logistics?.suggestedTotal ?? null;
  const knownTotal =
    logistics?.snapshot.components
      .reduce((sum, line) => sum.plus(line.amount ?? 0), new Decimal(0))
      .toFixed(2) ?? '0.00';
  const result: SampleOrderQuote = {
    total,
    knownTotal,
    shippingAmount: logistics?.suggestedShippingTotal ?? null,
    packagingAmount: logistics?.suggestedPackagingTotal ?? null,
    packagingOptions: snapshot.orderCharges.rules
      .filter((rule) => rule.kind === 'PACKAGING')
      .sort((a, b) => a.maxQty - b.maxQty)
      .map((rule) => ({
        code: rule.code,
        label: `纸箱（${rule.minQty}–${rule.maxQty} 个）`,
        amount: rule.amount,
      })),
    errors: logistics?.errors ?? [],
    quoteToken: createExternalOrderQuoteToken({
      items: [],
      packagingGroups: [],
      logistics: { isSfCollect: facts.isSfCollect, shipments: facts.shipments },
      priceVersion: snapshot.priceVersion,
      result: {
        items: [facts.purpose],
        packaging: facts.samplePackagingRuleCode ?? null,
        logistics,
      },
    }),
  };
  return { result, snapshot, logistics };
}

export async function quoteSampleOrder(raw: unknown) {
  const input = createOrderSchema.parse(raw);
  return db.$transaction(
    async (tx) =>
      (await calculateSampleQuote(tx, sampleQuoteFacts(input), new Date()))
        .result,
  );
}

/** Used inside the existing submit transaction, under its ownership gate. */
export async function finalizeSampleOrderInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
  now: Date,
  expectedQuoteToken: string | null,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: true,
      packagingGroups: true,
      shipments: { include: { lines: true }, orderBy: { sequence: 'asc' } },
    },
  });
  if (!isSampleOrder(order.purpose))
    throw new SampleOrderError('工单类型不适用');
  if (!['DRAFT', 'REJECTED'].includes(order.status))
    throw new SampleOrderError('请刷新工单后重试');
  if (!order.items.length || !order.shipments.length)
    throw new SampleOrderError('请补全样品与收件信息');
  if (order.purpose === 'PROOF') {
    await buildCreateOrderQuoteInputFromCatalog(tx, {
      isSfCollect: order.isSfCollect,
      packagingGroups: [],
      shipments: order.shipments.map((shipment) => ({
        shipmentKey: String(shipment.sequence),
        province: shipment.destinationProvince,
        itemQuantities: Object.fromEntries(
          shipment.lines.map((line) => [line.orderItemId, line.quantity]),
        ),
      })),
      items: order.items.map((item) => {
        if (!isNewOrderPricingRoute(item.pricingRoute))
          throw new SampleOrderError('打样请选择有效生产工艺');
        return {
          ...item,
          itemKey: item.id,
          fig: item.fig ?? item.sequence,
          pricingRoute: item.pricingRoute,
        };
      }),
    });
    const missing = await tx.orderItem.findFirst({
      where: { orderId, designs: { none: { fileType: 'IMAGE' } } },
      select: { id: true },
    });
    if (missing) throw new SampleOrderError('请为打样款式上传设计图片后再提交');
  }
  const facts: SampleQuoteFacts = {
    purpose: order.purpose as SampleQuoteFacts['purpose'],
    samplePackagingRuleCode: order.samplePackagingRuleCode,
    isSfCollect: order.isSfCollect,
    shipments: order.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      quantity: shipment.lines.reduce((sum, line) => sum + line.quantity, 0),
      weightKg: shipment.weightKg?.toString() ?? null,
    })),
  };
  const { result, snapshot, logistics } = await calculateSampleQuote(
    tx,
    facts,
    now,
  );
  if (result.quoteToken !== expectedQuoteToken)
    throw new SampleQuoteChangedError(result);
  // All production facts remain, but their customer price is included in the
  // order charge. Zero rows are explicit, not unresolved manual item prices.
  await tx.orderItem.updateMany({
    where: { orderId },
    data: {
      unitPrice: 0,
      fixedFee: 0,
      subtotal: 0,
      suggestedSubtotal: '0.00',
      quoteDisposition: 'PRICED',
      quotedAmount: 0,
      pricingSnapshot: {
        version: 1,
        source: 'SAMPLE_ORDER_INCLUDED',
        complete: true,
        suggestedSubtotal: '0.00',
      },
    },
  });
  await tx.orderPackagingGroup.updateMany({
    where: { orderId },
    data: {
      unitPrice: 0,
      subtotal: 0,
      suggestedSubtotal: '0.00',
      pricingSnapshot: {
        version: 1,
        source: 'SAMPLE_ORDER_INCLUDED',
        complete: true,
        suggestedSubtotal: '0.00',
      },
    },
  });
  const lines =
    order.purpose === 'PROOF'
      ? [
          {
            key: PROOF_TOTAL_BUSINESS_KEY,
            category: 'SAMPLE_FEE',
            description: '打样整单总价',
            amount: null,
            shipmentId: null,
            ruleCode: null,
            evidence: { purpose: 'PROOF' },
          },
        ]
      : (logistics?.snapshot.components ?? []).map((line) => ({
          key: `SHIPMENT:${line.shipmentKey}:${line.categoryCode === 'SHIPPING' ? 'SHIPPING_FEE' : 'PACKING_MATERIAL'}`,
          category:
            line.categoryCode === 'SHIPPING'
              ? 'SHIPPING_FEE'
              : 'PACKING_MATERIAL',
          description: line.name,
          amount: line.amount,
          shipmentId: order.shipments.find(
            (shipment) => String(shipment.sequence) === line.shipmentKey,
          )!.id,
          ruleCode: line.ruleCode,
          evidence: line,
        }));
  for (const line of lines) {
    const category = await tx.customerChargeCategory.findUnique({
      where: { code: line.category },
      select: { id: true, isActive: true },
    });
    if (!category?.isActive)
      throw new SampleOrderError(`请先启用${line.description}收费配置`);
    const rule = line.ruleCode
      ? await tx.customerPriceRule.findFirst({
          where: {
            priceBookId: snapshot.priceVersion.logistics.id,
            code: line.ruleCode,
          },
          select: { id: true },
        })
      : null;
    const data = {
      categoryId: category.id,
      description: line.description,
      amount: line.amount,
      suggestedAmount: line.amount,
      shipmentId: line.shipmentId,
      status:
        line.amount === null
          ? ('PENDING_AMOUNT' as const)
          : ('ESTIMATED' as const),
      priceBookId:
        order.purpose === 'PROOF' ? null : snapshot.priceVersion.logistics.id,
      sourceRuleId: rule?.id ?? null,
      pricingSnapshot: JSON.parse(
        JSON.stringify({
          version: 1,
          source: 'SAMPLE_ORDER_QUOTE',
          priceVersion: snapshot.priceVersion,
          line: line.evidence,
        }),
      ) as Prisma.InputJsonObject,
    };
    await tx.orderCustomerCharge.upsert({
      where: { orderId_businessKey: { orderId, businessKey: line.key } },
      create: { ...data, orderId, businessKey: line.key, createdById: actorId },
      update: data,
    });
  }
  const pricingStatus =
    result.total === null
      ? ('PENDING_ADMIN_CONFIRMATION' as const)
      : ('AUTO_CONFIRMED' as const);
  await tx.order.update({
    where: { id: orderId },
    data: {
      processingAmount: 0,
      packagingAmount: 0,
      totalAmount: result.knownTotal,
      confirmedFee: null,
    },
  });
  const revision = await appendOrderPricingRevisionInTx(tx, {
    orderId,
    actorId,
    now,
    source: 'SAMPLE_ORDER_SUBMIT',
    status: pricingStatus,
    expectedPriceRevision: order.priceRevision,
    orderFeeSnapshot: {
      quotedFee: result.knownTotal,
      confirmedFee: null,
      settledFee: null,
    },
    metadata: { purpose: order.purpose, priceVersion: snapshot.priceVersion },
  });
  await tx.orderPriceVersionLock.createMany({
    data: (['processing', 'logistics'] as const).map((key) => ({
      pricingRevisionId: revision.pricingRevisionId,
      purpose:
        key === 'processing' ? ('PROCESSING' as const) : ('LOGISTICS' as const),
      priceBookId: snapshot.priceVersion[key].id,
      priceBookVersion: snapshot.priceVersion[key].version,
      sourceSha256: snapshot.priceVersion[key].sourceSha256,
      createdAt: now,
    })),
  });
  const completeness =
    result.total === null
      ? OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
      : OrderQuotedFeeCompleteness.COMPLETE;
  await tx.order.update({
    where: { id: orderId },
    data: {
      quotedFee: result.knownTotal,
      quotedFeeCompleteness: completeness,
      quotedPricingRevisionId: revision.pricingRevisionId,
    },
  });
  return { quotedFee: result.knownTotal, quotedFeeCompleteness: completeness };
}
