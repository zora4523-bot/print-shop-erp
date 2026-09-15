import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderCustomerChargeStatus,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeInput,
  type ExternalOrderChargeLine,
  type ExternalOrderChargeRule,
  type ExternalOrderChargeWeightItem,
  type ExternalOrderEstimateLogisticsPolicy,
  type ExternalOrderLegacyLogisticsPolicy,
  type ExternalOrderLogisticsPolicy,
  type ExternalOrderPackagingRule,
  type ExternalOrderShippingRule,
} from './external-order-charges';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

export class OrderCustomerChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderCustomerChargeError';
  }
}

export type SubmittedShipmentCustomerCharges = {
  shipmentKey: string;
  province: string | null;
  billableWeightKg: string | null;
  weightItems?: readonly ExternalOrderChargeWeightItem[];
  requiresActualWeight?: boolean;
  itemQuantity: number;
  shippingFee: string | null;
  packingMaterialFee: string | null;
  overrideReason: string | null;
};

export type ResolvedOrderCustomerCharge = {
  shipmentKey: string;
  categoryCode: 'SHIPPING_FEE' | 'PACKING_MATERIAL';
  categoryId: string;
  priceBookId: string;
  sourceRuleId: string | null;
  businessKey: string;
  status: OrderCustomerChargeStatus;
  description: string;
  quantity: string | null;
  unit: string | null;
  suggestedAmount: string | null;
  amount: string;
  pricingSnapshot: Prisma.InputJsonObject;
  overrideReason: string | null;
};

type PriceBookRuleRow = {
  id: string;
  code: unknown;
  amount: unknown;
  includedUnits: unknown;
  incrementUnits: unknown;
  incrementAmount: unknown;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  sourceSheet: string | null;
  sourceRange: string | null;
  sourceName: string | null;
  sourceSha256: string | null;
  blocksAutomaticQuote: boolean;
  category: { id: string; code: unknown };
};

type LoadedLogisticsPriceBook = {
  id: string;
  code: string;
  name: string;
  version: number;
  sourceName: string;
  sourceSha256: string;
  policy: ExternalOrderLogisticsPolicy;
  rules: ExternalOrderChargeRule[];
  ruleRowsByCode: Map<string, PriceBookRuleRow>;
  categoryIdByCode: Map<string, string>;
};

export type ExternalOrderChargePriceBookSnapshot = Omit<
  LoadedLogisticsPriceBook,
  'rules' | 'ruleRowsByCode' | 'categoryIdByCode'
>;

function requiredDecimal(value: unknown, label: string): string {
  if (value === null || value === undefined) {
    throw new OrderCustomerChargeError(`物流价目簿规则缺少${label}`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    throw new OrderCustomerChargeError(`物流价目簿规则${label}格式非法`);
  }
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new OrderCustomerChargeError(`物流价目簿规则${label}格式非法`);
  }
  return parsed.toString();
}

function requiredPositiveDecimal(value: unknown, label: string): string {
  const parsed = requiredDecimal(value, label);
  if (!new Decimal(parsed).gt(0)) {
    throw new OrderCustomerChargeError(`物流价目簿规则${label}必须大于 0`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function logisticsPolicyFromNotes(
  notes: unknown,
  options: { allowLegacyCarrierConfirmed: boolean },
): ExternalOrderLogisticsPolicy {
  if (!isRecord(notes) || !isRecord(notes.shipping)) {
    throw new OrderCustomerChargeError('物流价目簿缺少版本化重量策略');
  }
  const ruleVersion =
    typeof notes.ruleVersion === 'string' ? notes.ruleVersion.trim() : '';
  if (!ruleVersion) {
    throw new OrderCustomerChargeError('物流价目簿缺少规则版本');
  }

  const shipping = notes.shipping;
  const billableWeightInput = shipping.billableWeightInput;
  if (billableWeightInput === 'CARRIER_CONFIRMED') {
    if (!options.allowLegacyCarrierConfirmed) {
      throw new OrderCustomerChargeError(
        '当前物流价目簿不支持服务端重量估算',
      );
    }
    const maximum =
      shipping.maxOrderQuantity ?? shipping.ztoMaximumOrderQuantity;
    if (!Number.isSafeInteger(maximum) || Number(maximum) < 1) {
      throw new OrderCustomerChargeError('历史物流价目簿的数量边界无效');
    }
    if (
      shipping.weightResolutionOrder !== undefined &&
      (!Array.isArray(shipping.weightResolutionOrder) ||
        shipping.weightResolutionOrder.length !== 1 ||
        shipping.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT')
    ) {
      throw new OrderCustomerChargeError('历史物流价目簿的重量决议顺序无效');
    }
    return {
      ruleVersion,
      billableWeightInput: 'CARRIER_CONFIRMED',
      weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT'],
      maxOrderQuantity: Number(maximum),
    } satisfies ExternalOrderLegacyLogisticsPolicy;
  }

  if (billableWeightInput !== 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE') {
    throw new OrderCustomerChargeError('物流价目簿的重量来源策略无效');
  }
  if (
    !Array.isArray(shipping.weightResolutionOrder) ||
    shipping.weightResolutionOrder.length !== 2 ||
    shipping.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT' ||
    shipping.weightResolutionOrder[1] !== 'SERVER_ESTIMATE'
  ) {
    throw new OrderCustomerChargeError('物流价目簿的重量决议顺序无效');
  }
  if (
    !Number.isSafeInteger(shipping.maxOrderQuantity) ||
    Number(shipping.maxOrderQuantity) < 1
  ) {
    throw new OrderCustomerChargeError('物流价目簿的数量边界无效');
  }
  if (shipping.billableWeightRounding !== 'CEIL_KG') {
    throw new OrderCustomerChargeError('物流价目簿的重量进位策略无效');
  }

  const gramsByPaperWeight = shipping.gramsPerItemByPaperWeightGsm;
  if (!isRecord(gramsByPaperWeight) || Object.keys(gramsByPaperWeight).length === 0) {
    throw new OrderCustomerChargeError('物流价目簿缺少纸张单重策略');
  }
  const normalizedGramsByPaperWeight: Record<string, string> = {};
  for (const [paperWeightGsm, gramsPerItem] of Object.entries(
    gramsByPaperWeight,
  )) {
    if (
      !/^[1-9]\d*$/.test(paperWeightGsm) ||
      !Number.isSafeInteger(Number(paperWeightGsm))
    ) {
      throw new OrderCustomerChargeError('物流价目簿的纸张克重键无效');
    }
    normalizedGramsByPaperWeight[paperWeightGsm] = requiredPositiveDecimal(
      gramsPerItem,
      `${paperWeightGsm}g 纸张单重`,
    );
  }

  return {
    ruleVersion,
    billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
    weightResolutionOrder: [
      'ACTUAL_FULFILLMENT_WEIGHT',
      'SERVER_ESTIMATE',
    ],
    maxOrderQuantity: Number(shipping.maxOrderQuantity),
    billableWeightRounding: 'CEIL_KG',
    minimumBillableWeightKg: requiredPositiveDecimal(
      shipping.minimumBillableWeightKg,
      '最低计费重量',
    ),
    gramsPerItemByPaperWeightGsm: normalizedGramsByPaperWeight,
    tenThousandEnvelopeGramsPerItem: requiredPositiveDecimal(
      shipping.tenThousandEnvelopeGramsPerItem,
      '万元封单个重量',
    ),
  } satisfies ExternalOrderEstimateLogisticsPolicy;
}

const HISTORICAL_EXTERNAL_LOGISTICS_BOOK = {
  id: 'cpb_external_sales_logistics_202608_v1',
  code: 'EXTERNAL_SALES_LOGISTICS_202608',
  version: 1,
  sourceSha256:
    '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
} as const;

function isHistoricalExternalLogisticsBook(book: {
  id: string;
  code: unknown;
  version: number;
  sourceSha256: string;
}): boolean {
  return (
    book.id === HISTORICAL_EXTERNAL_LOGISTICS_BOOK.id &&
    String(book.code) === HISTORICAL_EXTERNAL_LOGISTICS_BOOK.code &&
    book.version === HISTORICAL_EXTERNAL_LOGISTICS_BOOK.version &&
    book.sourceSha256 === HISTORICAL_EXTERNAL_LOGISTICS_BOOK.sourceSha256
  );
}

function logisticsPolicyForBook(
  book: {
    id: string;
    code: unknown;
    version: number;
    sourceSha256: string;
    notes: unknown;
  },
  options: { allowLegacyCarrierConfirmed: boolean },
): ExternalOrderLogisticsPolicy {
  if (
    options.allowLegacyCarrierConfirmed &&
    isHistoricalExternalLogisticsBook(book)
  ) {
    return {
      ruleVersion: `historical:${HISTORICAL_EXTERNAL_LOGISTICS_BOOK.code}:v1`,
      billableWeightInput: 'CARRIER_CONFIRMED',
      weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT'],
      maxOrderQuantity: 2_000,
    } satisfies ExternalOrderLegacyLogisticsPolicy;
  }
  return logisticsPolicyFromNotes(book.notes, options);
}

function sourceFromRule(rule: PriceBookRuleRow) {
  if (
    !rule.sourceName ||
    !rule.sourceSha256 ||
    !rule.sourceSheet ||
    !rule.sourceRange
  ) {
    throw new OrderCustomerChargeError(
      '物流价目簿中的一条收费规则缺少来源文件快照',
    );
  }
  return {
    fileName: rule.sourceName,
    sha256: rule.sourceSha256,
    sheetName: rule.sourceSheet,
    sourceRange: rule.sourceRange,
  };
}

function shippingRule(rule: PriceBookRuleRow): ExternalOrderShippingRule {
  const condition = rule.triggerCondition;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new OrderCustomerChargeError(
      '快递费规则的地区条件设置无效',
    );
  }
  const rawProvinces = (condition as Record<string, unknown>).provinces;
  const carrierCode = (condition as Record<string, unknown>).carrierCode;
  if (
    carrierCode !== 'ZTO' ||
    !Array.isArray(rawProvinces) ||
    rawProvinces.length === 0 ||
    rawProvinces.some(
      (province) => typeof province !== 'string' || province.trim() === '',
    )
  ) {
    throw new OrderCustomerChargeError(
      '快递费规则的承运商或省份设置无效',
    );
  }
  return {
    kind: 'SHIPPING',
    code: String(rule.code),
    provinces: rawProvinces as string[],
    firstFee: requiredDecimal(rule.amount, '首重金额'),
    firstWeightKg: requiredPositiveDecimal(rule.includedUnits, '首重重量'),
    additionalUnitKg: requiredPositiveDecimal(rule.incrementUnits, '续重单位'),
    additionalUnitFee: requiredDecimal(rule.incrementAmount, '续重金额'),
    source: sourceFromRule(rule),
  };
}

function packagingRule(
  rule: PriceBookRuleRow,
  options: { allowLegacyBlockedRule?: boolean } = {},
): ExternalOrderPackagingRule {
  if (
    !Number.isSafeInteger(rule.minQty) ||
    !Number.isSafeInteger(rule.maxQty) ||
    (rule.minQty ?? 0) < 1 ||
    (rule.maxQty ?? 0) < (rule.minQty ?? 0) ||
    (rule.blocksAutomaticQuote && !options.allowLegacyBlockedRule)
  ) {
    throw new OrderCustomerChargeError(
      '纸箱费规则必须是可自动计算的连续数量档',
    );
  }
  return {
    kind: 'PACKAGING',
    code: String(rule.code),
    minQty: rule.minQty as number,
    maxQty: rule.maxQty as number,
    amount: requiredDecimal(rule.amount, '纸箱费金额'),
    advisory: false,
    source: sourceFromRule(rule),
  };
}

async function loadLogisticsPriceBook(
  client: Prisma.TransactionClient,
  now: Date,
  priceBookId?: string,
  snapshotLockHeld = false,
): Promise<LoadedLogisticsPriceBook> {
  if (!snapshotLockHeld) {
    await acquirePriceRuleSnapshotReadLock(client);
  }

  const books = await client.customerPriceBook.findMany({
    where: {
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      purpose: CustomerPriceBookPurpose.LOGISTICS,
      ...(priceBookId
        ? { id: priceBookId }
        : {
            isActive: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          }),
    },
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      sourceName: true,
      sourceSha256: true,
      notes: true,
      rules: {
        where: {
          isActive: true,
          category: {
            isActive: true,
            code: { in: ['SHIPPING_FEE', 'PACKING_MATERIAL'] },
          },
        },
        select: {
          id: true,
          code: true,
          amount: true,
          includedUnits: true,
          incrementUnits: true,
          incrementAmount: true,
          minQty: true,
          maxQty: true,
          triggerCondition: true,
          sourceSheet: true,
          sourceRange: true,
          sourceName: true,
          sourceSha256: true,
          blocksAutomaticQuote: true,
          category: { select: { id: true, code: true } },
        },
        orderBy: [{ category: { sortOrder: 'asc' } }, { code: 'asc' }],
      },
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    take: 2,
  });
  if (books.length === 0) {
    throw new OrderCustomerChargeError(
      priceBookId
        ? '工单引用的快递/耗材价目簿已丢失，请联系管理员'
        : '当前没有生效的外部销售快递/耗材价目簿，请联系管理员',
    );
  }
  if (books.length > 1) {
    throw new OrderCustomerChargeError(
      '同时存在多个生效的外部销售快递/耗材价目簿，请管理员修正有效期',
    );
  }

  const book = books[0]!;
  const policy = logisticsPolicyForBook(book, {
    allowLegacyCarrierConfirmed: priceBookId !== undefined,
  });
  const isExplicitHistoricalBook =
    priceBookId !== undefined && isHistoricalExternalLogisticsBook(book);
  const rows = book.rules as PriceBookRuleRow[];
  const ruleRowsByCode = new Map<string, PriceBookRuleRow>();
  const categoryIdByCode = new Map<string, string>();
  const rules: ExternalOrderChargeRule[] = [];
  for (const row of rows) {
    const code = String(row.code);
    const categoryCode = String(row.category.code);
    if (ruleRowsByCode.has(code)) {
      throw new OrderCustomerChargeError('物流价目簿中存在重复的收费规则');
    }
    ruleRowsByCode.set(code, row);
    categoryIdByCode.set(categoryCode, row.category.id);
    if (categoryCode === 'SHIPPING_FEE') {
      rules.push(shippingRule(row));
    } else if (categoryCode === 'PACKING_MATERIAL') {
      rules.push(
        packagingRule(row, {
          allowLegacyBlockedRule: isExplicitHistoricalBook,
        }),
      );
    }
  }
  if (
    !categoryIdByCode.has('SHIPPING_FEE') ||
    !categoryIdByCode.has('PACKING_MATERIAL')
  ) {
    throw new OrderCustomerChargeError('物流价目簿缺少快递费或打包耗材费规则');
  }

  return {
    id: book.id,
    code: String(book.code),
    name: book.name,
    version: book.version,
    sourceName: book.sourceName,
    sourceSha256: book.sourceSha256,
    policy,
    rules,
    ruleRowsByCode,
    categoryIdByCode,
  };
}

function parseSubmittedAmount(value: string | null, label: string): Decimal | null {
  if (value === null) return null;
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new OrderCustomerChargeError(`${label}格式非法`);
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 2 ||
    amount.gt('9999999999.99')
  ) {
    throw new OrderCustomerChargeError(`${label}超出系统允许范围`);
  }
  return amount;
}

function resolveAmount(params: {
  line: ExternalOrderChargeLine;
  submitted: string | null;
  overrideReason: string | null;
  label: string;
  requireExplicitConfirmation: boolean;
  allowPending: boolean;
}): {
  amount: string;
  suggestedAmount: string | null;
  overrideReason: string | null;
  requiresAdminConfirmation: boolean;
} {
  const suggested = params.line.amount === null
    ? null
    : new Decimal(params.line.amount);
  if (params.line.waived) {
    const submitted = parseSubmittedAmount(params.submitted, params.label);
    if (submitted && !submitted.isZero()) {
      throw new OrderCustomerChargeError('顺丰到付的快递费必须为 0');
    }
    return {
      amount: '0.00',
      suggestedAmount: '0.00',
      overrideReason: null,
      requiresAdminConfirmation: false,
    };
  }
  const submitted = parseSubmittedAmount(params.submitted, params.label);
  if (params.allowPending) {
    const amount = submitted ?? suggested ?? new Decimal(0);
    const differs = suggested === null || !amount.equals(suggested);
    return {
      amount: amount.toFixed(2),
      suggestedAmount: suggested?.toFixed(2) ?? null,
      overrideReason:
        (differs || !params.line.complete || params.line.advisory) &&
        params.overrideReason?.trim()
          ? params.overrideReason.trim()
          : null,
      requiresAdminConfirmation:
        params.line.advisory || !params.line.complete || differs,
    };
  }
  if (params.requireExplicitConfirmation && submitted === null) {
    throw new OrderCustomerChargeError(
      `${params.label}是报价表参考值，请先确认并填写本票实际收费`,
    );
  }
  if (!params.line.complete && submitted === null) {
    throw new OrderCustomerChargeError(
      `${params.label}无法自动报价，请填写实际收费和调整说明`,
    );
  }
  const amount = submitted ?? suggested;
  if (!amount) {
    throw new OrderCustomerChargeError(`${params.label}缺少收费金额`);
  }
  const differs = suggested === null || !amount.equals(suggested);
  if ((differs || !params.line.complete) && !params.overrideReason?.trim()) {
    throw new OrderCustomerChargeError(
      `${params.label}与报价表建议不同或规则不完整，请填写收费调整说明`,
    );
  }
  return {
    amount: amount.toFixed(2),
    suggestedAmount: suggested?.toFixed(2) ?? null,
    // An explicit final amount is an administrator-confirmed business fact.
    // Keep any accompanying note for the audit trail even when the amount
    // happens to equal the automatic suggestion.
    overrideReason: submitted !== null
      ? params.overrideReason?.trim() || null
      : null,
    requiresAdminConfirmation: false,
  };
}

/**
 * Creation-time resolver for external sales. Missing or advisory prices are
 * persisted as provisional (suggestion when available, otherwise zero) so the
 * sales user can create a DRAFT; only the ADMIN finalization path may turn the
 * order into a confirmed price revision.
 */
export async function resolveExternalOrderChargesForProvisionalCreation(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    samplePackaging?: { ruleCode: string | null };
    shipments: SubmittedShipmentCustomerCharges[];
  },
  now: Date,
  options: { snapshotLockHeld?: boolean } = {},
): Promise<{
  priceBook: ExternalOrderChargePriceBookSnapshot;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
  requiresAdminConfirmation: boolean;
}> {
  return resolveExternalOrderCharges(
    client,
    input,
    now,
    undefined,
    options.snapshotLockHeld ?? false,
    true,
  );
}

export async function resolveExternalOrderChargesForFinalization(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    samplePackaging?: { ruleCode: string | null };
    shipments: SubmittedShipmentCustomerCharges[];
  },
  priceBookId: string,
  now: Date,
  options: {
    /** Only for an unshipped order reverting from SF collect to prepaid freight. */
    allowPending?: boolean;
  } = {},
): Promise<{
  priceBook: Omit<LoadedLogisticsPriceBook, 'rules' | 'ruleRowsByCode' | 'categoryIdByCode'>;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
  requiresAdminConfirmation: boolean;
}> {
  return resolveExternalOrderCharges(
    client,
    input,
    now,
    priceBookId,
    false,
    options.allowPending ?? false,
  );
}

async function resolveExternalOrderCharges(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    samplePackaging?: { ruleCode: string | null };
    shipments: SubmittedShipmentCustomerCharges[];
  },
  now: Date,
  priceBookId?: string,
  snapshotLockHeld = false,
  allowPending = false,
): Promise<{
  priceBook: Omit<LoadedLogisticsPriceBook, 'rules' | 'ruleRowsByCode' | 'categoryIdByCode'>;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
  requiresAdminConfirmation: boolean;
}> {
  const book = await loadLogisticsPriceBook(
    client,
    now,
    priceBookId,
    snapshotLockHeld,
  );
  const quoteInput: ExternalOrderChargeInput = {
    samplePackaging: input.samplePackaging,
    isSfCollect: input.isSfCollect,
    shipments: input.shipments.map((shipment) => ({
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      billableWeightKg: shipment.billableWeightKg,
      weightItems: shipment.weightItems,
      requiresActualWeight: shipment.requiresActualWeight,
      itemQuantity: shipment.itemQuantity,
    })),
  };
  const quote = calculateExternalOrderCharges(
    quoteInput,
    book.rules,
    book.policy,
  );
  const submittedByKey = new Map(
    input.shipments.map((shipment) => [shipment.shipmentKey, shipment]),
  );
  const charges: ResolvedOrderCustomerCharge[] = [];
  let requiresAdminConfirmation = false;

  for (const shipmentQuote of quote.shipments) {
    const submitted = submittedByKey.get(shipmentQuote.shipmentKey);
    if (!submitted) {
      throw new OrderCustomerChargeError('物流报价与发货地址不一致，请刷新后重试');
    }
    const shipping = resolveAmount({
      line: shipmentQuote.shipping,
      submitted: submitted.shippingFee,
      overrideReason: submitted.overrideReason,
      label: `地址 ${shipmentQuote.shipmentKey} 快递费`,
      requireExplicitConfirmation: false,
      allowPending,
    });
    const packaging = resolveAmount({
      line: shipmentQuote.packaging,
      submitted: submitted.packingMaterialFee,
      overrideReason: submitted.overrideReason,
      label: `地址 ${shipmentQuote.shipmentKey} 纸箱费`,
      requireExplicitConfirmation: false,
      allowPending,
    });

    for (const [categoryCode, line, resolved] of [
      ['SHIPPING_FEE', shipmentQuote.shipping, shipping],
      ['PACKING_MATERIAL', shipmentQuote.packaging, packaging],
    ] as const) {
      const sourceRule = line.ruleCode
        ? book.ruleRowsByCode.get(line.ruleCode) ?? null
        : null;
      const isShipping = categoryCode === 'SHIPPING_FEE';
      const resolvedBillableWeightKg =
        typeof line.basis.billableWeightKg === 'string'
          ? line.basis.billableWeightKg
          : submitted.billableWeightKg;
      const categoryId = book.categoryIdByCode.get(categoryCode);
      if (!categoryId) {
        throw new OrderCustomerChargeError(
          isShipping
            ? '物流价目簿缺少快递费收费类目'
            : '物流价目簿缺少打包耗材费收费类目',
        );
      }
      requiresAdminConfirmation ||= resolved.requiresAdminConfirmation;
      charges.push({
        shipmentKey: shipmentQuote.shipmentKey,
        categoryCode,
        categoryId,
        priceBookId: book.id,
        sourceRuleId: sourceRule?.id ?? null,
        businessKey: `SHIPMENT:${shipmentQuote.shipmentKey}:${categoryCode}`,
        status: line.waived
          ? OrderCustomerChargeStatus.WAIVED
          : OrderCustomerChargeStatus.ESTIMATED,
        description: line.name,
        quantity: isShipping
          ? resolvedBillableWeightKg
          : String(submitted.itemQuantity),
        unit: isShipping ? 'kg' : '个',
        suggestedAmount: resolved.suggestedAmount,
        amount: resolved.amount,
        pricingSnapshot: {
          version: 1,
          quotedAt: now.toISOString(),
          priceBook: {
            id: book.id,
            code: book.code,
            name: book.name,
            version: book.version,
            sourceName: book.sourceName,
            sourceSha256: book.sourceSha256,
            policy: book.policy,
          },
          quote: line as unknown as Prisma.InputJsonObject,
          actual: {
            amount: resolved.amount,
            overrideReason: resolved.overrideReason,
            provisional: allowPending && resolved.requiresAdminConfirmation,
            requiresAdminConfirmation: resolved.requiresAdminConfirmation,
          },
        },
        overrideReason: resolved.overrideReason,
      });
    }
  }

  return {
    priceBook: {
      id: book.id,
      code: book.code,
      name: book.name,
      version: book.version,
      sourceName: book.sourceName,
      sourceSha256: book.sourceSha256,
      policy: book.policy,
    },
    charges,
    totalAmount: charges
      .reduce((sum, charge) => sum.plus(charge.amount), new Decimal(0))
      .toFixed(2),
    requiresAdminConfirmation,
  };
}
