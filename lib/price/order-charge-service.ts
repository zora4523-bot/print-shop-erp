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
  type ExternalOrderChargeQuote,
  type ExternalOrderChargeRule,
  type ExternalOrderPackagingRule,
  type ExternalOrderShippingRule,
} from './external-order-charges';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';
import { db } from '../db';

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
  rules: ExternalOrderChargeRule[];
  ruleRowsByCode: Map<string, PriceBookRuleRow>;
  categoryIdByCode: Map<string, string>;
};

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

function sourceFromRule(rule: PriceBookRuleRow) {
  if (
    !rule.sourceName ||
    !rule.sourceSha256 ||
    !rule.sourceSheet ||
    !rule.sourceRange
  ) {
    throw new OrderCustomerChargeError(
      `物流价目簿规则 ${String(rule.code)} 缺少来源文件快照`,
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
      `物流价目簿规则 ${String(rule.code)} 的地区条件非法`,
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
      `物流价目簿规则 ${String(rule.code)} 的承运商或省份非法`,
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

function packagingRule(rule: PriceBookRuleRow): ExternalOrderPackagingRule {
  if (
    !Number.isSafeInteger(rule.minQty) ||
    !Number.isSafeInteger(rule.maxQty) ||
    (rule.minQty ?? 0) < 1 ||
    (rule.maxQty ?? 0) < (rule.minQty ?? 0) ||
    !rule.blocksAutomaticQuote
  ) {
    throw new OrderCustomerChargeError(
      `物流价目簿规则 ${String(rule.code)} 的耗材数量区间非法`,
    );
  }
  return {
    kind: 'PACKAGING',
    code: String(rule.code),
    minQty: rule.minQty as number,
    maxQty: rule.maxQty as number,
    amount: requiredDecimal(rule.amount, '耗材参考金额'),
    advisory: true,
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
  const rows = book.rules as PriceBookRuleRow[];
  const ruleRowsByCode = new Map<string, PriceBookRuleRow>();
  const categoryIdByCode = new Map<string, string>();
  const rules: ExternalOrderChargeRule[] = [];
  for (const row of rows) {
    const code = String(row.code);
    const categoryCode = String(row.category.code);
    if (ruleRowsByCode.has(code)) {
      throw new OrderCustomerChargeError(`物流价目簿规则代码重复：${code}`);
    }
    ruleRowsByCode.set(code, row);
    categoryIdByCode.set(categoryCode, row.category.id);
    if (categoryCode === 'SHIPPING_FEE') {
      rules.push(shippingRule(row));
    } else if (categoryCode === 'PACKING_MATERIAL') {
      rules.push(packagingRule(row));
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

/**
 * Read-only logistics preview for the order creation screen.
 *
 * The browser sends shipment facts only. Every call opens a short transaction,
 * takes the shared price-rule snapshot lock, and loads the currently-effective
 * LOGISTICS book. There is deliberately no fallback to the engine's bundled
 * reference rules: a missing or malformed database book must fail closed.
 */
export async function quoteExternalOrderChargesPreview(
  input: ExternalOrderChargeInput,
  now: Date = new Date(),
): Promise<ExternalOrderChargeQuote> {
  return db.$transaction(async (client) => {
    const book = await loadLogisticsPriceBook(client, now);
    return calculateExternalOrderCharges(input, book.rules);
  });
}

function resolveAmount(params: {
  line: ExternalOrderChargeLine;
  submitted: string | null;
  overrideReason: string | null;
  label: string;
  requireExplicitConfirmation: boolean;
}): { amount: string; suggestedAmount: string | null; overrideReason: string | null } {
  const suggested = params.line.amount === null
    ? null
    : new Decimal(params.line.amount);
  const submitted = parseSubmittedAmount(params.submitted, params.label);
  if (params.line.waived) {
    if (submitted && !submitted.isZero()) {
      throw new OrderCustomerChargeError('顺丰到付的快递费必须为 0');
    }
    return {
      amount: '0.00',
      suggestedAmount: '0.00',
      overrideReason: null,
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
    overrideReason: differs || !params.line.complete
      ? params.overrideReason?.trim() ?? null
      : null,
  };
}

export async function resolveExternalOrderChargesForCreation(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    shipments: SubmittedShipmentCustomerCharges[];
  },
  now: Date,
  options: { snapshotLockHeld?: boolean } = {},
): Promise<{
  priceBook: Omit<LoadedLogisticsPriceBook, 'rules' | 'ruleRowsByCode' | 'categoryIdByCode'>;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
}> {
  return resolveExternalOrderCharges(
    client,
    input,
    now,
    undefined,
    options.snapshotLockHeld ?? false,
  );
}

export async function resolveExternalOrderChargesForFinalization(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    shipments: SubmittedShipmentCustomerCharges[];
  },
  priceBookId: string,
  now: Date,
): Promise<{
  priceBook: Omit<LoadedLogisticsPriceBook, 'rules' | 'ruleRowsByCode' | 'categoryIdByCode'>;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
}> {
  return resolveExternalOrderCharges(client, input, now, priceBookId);
}

async function resolveExternalOrderCharges(
  client: Prisma.TransactionClient,
  input: {
    isSfCollect: boolean;
    shipments: SubmittedShipmentCustomerCharges[];
  },
  now: Date,
  priceBookId?: string,
  snapshotLockHeld = false,
): Promise<{
  priceBook: Omit<LoadedLogisticsPriceBook, 'rules' | 'ruleRowsByCode' | 'categoryIdByCode'>;
  charges: ResolvedOrderCustomerCharge[];
  totalAmount: string;
}> {
  const book = await loadLogisticsPriceBook(
    client,
    now,
    priceBookId,
    snapshotLockHeld,
  );
  const quoteInput: ExternalOrderChargeInput = {
    isSfCollect: input.isSfCollect,
    shipments: input.shipments.map((shipment) => ({
      shipmentKey: shipment.shipmentKey,
      province: shipment.province,
      billableWeightKg: shipment.billableWeightKg,
      itemQuantity: shipment.itemQuantity,
    })),
  };
  const quote = calculateExternalOrderCharges(quoteInput, book.rules);
  const submittedByKey = new Map(
    input.shipments.map((shipment) => [shipment.shipmentKey, shipment]),
  );
  const charges: ResolvedOrderCustomerCharge[] = [];

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
    });
    const packaging = resolveAmount({
      line: shipmentQuote.packaging,
      submitted: submitted.packingMaterialFee,
      overrideReason: submitted.overrideReason,
      label: `地址 ${shipmentQuote.shipmentKey} 打包耗材费`,
      requireExplicitConfirmation: true,
    });

    for (const [categoryCode, line, resolved] of [
      ['SHIPPING_FEE', shipmentQuote.shipping, shipping],
      ['PACKING_MATERIAL', shipmentQuote.packaging, packaging],
    ] as const) {
      const sourceRule = line.ruleCode
        ? book.ruleRowsByCode.get(line.ruleCode) ?? null
        : null;
      const categoryId = book.categoryIdByCode.get(categoryCode);
      if (!categoryId) {
        throw new OrderCustomerChargeError(`物流价目簿缺少收费类目 ${categoryCode}`);
      }
      const isShipping = categoryCode === 'SHIPPING_FEE';
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
          ? submitted.billableWeightKg
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
          },
          quote: line as unknown as Prisma.InputJsonObject,
          actual: {
            amount: resolved.amount,
            overrideReason: resolved.overrideReason,
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
    },
    charges,
    totalAmount: charges
      .reduce((sum, charge) => sum.plus(charge.amount), new Decimal(0))
      .toFixed(2),
  };
}
