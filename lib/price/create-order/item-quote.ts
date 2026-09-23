import Decimal from 'decimal.js';
import {
  decimalValue,
  safeMoney,
  safeUnitPrice,
  sumMoney,
  sumMoneySafely,
  unitPrice,
} from './money';
import {
  resolvePrintTierQuantity,
  selectFullUnitPrice,
  selectPartialUnitPrice,
  selectPrintPerOrderPrice,
} from './selectors';
import { CREATE_ORDER_PRINT_FOIL_PRICING_POLICY } from './types';
import type {
  CreateOrderItemQuote,
  CreateOrderManualReason,
  CreateOrderPriceSnapshot,
  CreateOrderQuoteItemInput,
  CreateOrderQuoteLine,
  PrintPerOrderPrice,
} from './types';

function quotedItemLine(args: {
  itemKey: string;
  code: string;
  label: string;
  amount: string;
  basis: CreateOrderQuoteLine['basis'];
}): CreateOrderQuoteLine {
  return {
    layer: 'ITEM',
    itemKey: args.itemKey,
    groupKey: null,
    code: args.code,
    label: args.label,
    status: 'QUOTED',
    amount: args.amount,
    includedInKnownTotal: true,
    basis: args.basis,
    errors: [],
  };
}

function excludedManualLines(
  lines: readonly CreateOrderQuoteLine[],
): CreateOrderQuoteLine[] {
  return lines.map((line) => ({
    ...line,
    status: 'EXCLUDED_MANUAL',
    includedInKnownTotal: false,
  }));
}

function manualReason(
  code: CreateOrderManualReason['code'],
  message: string,
): CreateOrderManualReason {
  return { code, message };
}

function printFoilValidationErrors(
  item: CreateOrderQuoteItemInput,
): string[] {
  if (item.craft !== 'PRINT') return [];
  const errors: string[] = [];
  const foilMode = item.printFoilMode ?? 'NONE';
  const foilPassCount = item.frontColors.length + item.backColors.length;
  if (foilMode === 'FULL' && item.backColors.length > 0) {
    errors.push('彩印叠加专版烫金只能使用正面');
  }
  if (foilMode === 'NONE' && foilPassCount > 0) {
    errors.push('彩印未叠加烫金时不能携带烫金颜色');
  }
  if (foilMode !== 'NONE' && foilPassCount === 0) {
    errors.push('彩印叠加烫金时必须选择至少一种烫金颜色');
  }
  return errors;
}

function appendPrintFoilManualPricePolicy(
  item: CreateOrderQuoteItemInput,
  reasons: readonly CreateOrderManualReason[],
): CreateOrderManualReason[] {
  const hasPrintFoilFacts =
    item.craft === 'PRINT' &&
    item.frontColors.length + item.backColors.length > 0;
  if (
    !hasPrintFoilFacts ||
    reasons.some(
      (reason) => reason.code === 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
    )
  ) {
    return [...reasons];
  }
  return [
    ...reasons,
    manualReason(
      'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
      '彩印烫金款的人工整款价必须包含制烫金版费，不再另收独立制版费',
    ),
  ];
}

function validateItem(item: CreateOrderQuoteItemInput): string[] {
  const errors: string[] = [];
  if (!item.itemKey.trim()) errors.push('款式标识不能为空');
  if (!Number.isSafeInteger(item.fig) || item.fig < 1) {
    errors.push('fig 必须是正整数');
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
    errors.push('数量必须是正整数');
  }
  if (!item.paperType.trim()) errors.push('纸张类型不能为空');
  if (!item.specification.trim()) errors.push('规格不能为空');
  if (
    item.paperWeightGsm === null ||
    !Number.isSafeInteger(item.paperWeightGsm) ||
    item.paperWeightGsm <= 0
  ) {
    errors.push('纸张克重必须是正数');
  }
  if (
    (item.craft === 'PARTIAL' || item.craft === 'FULL') &&
    item.frontColors.length === 0
  ) {
    errors.push('烫金款必须选择正面烫金颜色');
  }
  if (item.craft === 'FULL' && item.backColors.length > 0) {
    errors.push('专版烫金只能使用正面');
  }
  errors.push(...printFoilValidationErrors(item));
  return errors;
}

function commonManualReasons(
  item: CreateOrderQuoteItemInput,
): CreateOrderManualReason[] {
  return [
    ...(item.configuration.paper === 'CUSTOM'
      ? [manualReason('CUSTOM_PAPER', '自定义纸张需人工核价')]
      : []),
    ...(item.configuration.craft === 'CUSTOM'
      ? [manualReason('CUSTOM_CRAFT', '配置外工艺需人工核价')]
      : []),
    ...(item.configuration.paperWeight === 'MANUAL'
      ? [manualReason('MANUAL_PAPER_WEIGHT', '手动输入克重需人工核价')]
      : []),
    ...(item.configuration.specification === 'RESIZED'
      ? [manualReason('RESIZED', '改尺寸需人工核价')]
      : []),
  ];
}

function quotePartialProcessing(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): {
  lines: CreateOrderQuoteLine[];
  amount: string | null;
  unitPrice: string | null;
  manualReasons: CreateOrderManualReason[];
  errors: string[];
} {
  if (item.productStructure === 'TEN_THOUSAND_ENVELOPE') {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PARTIAL_TEN_THOUSAND_ENVELOPE',
          '万元封局部烫金未纳入当前结构化规格表',
        ),
      ],
      errors: [],
    };
  }
  const selected = selectPartialUnitPrice(item, snapshot.partial);
  const currentRate = selected?.unitPrice == null ? null : decimalValue(selected.unitPrice);
  const historicalPrice = !currentRate?.gt(0) ? item.historicalBlankPrice : undefined;
  if (!selected && !historicalPrice) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PARTIAL_BLANK_PRICE_NOT_FOUND',
          '局部烫金空白封组合没有配置价格',
        ),
      ],
      errors: [],
    };
  }
  const blankRate = historicalPrice
    ? decimalValue(historicalPrice.unitPrice)
    : currentRate;
  const fixedPerPass = decimalValue(
    snapshot.partial.machineFee.fixedFeePerPass,
  );
  const perPiecePerPass = decimalValue(
    snapshot.partial.machineFee.perPiecePerPass,
  );
  if (!blankRate) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PARTIAL_BLANK_PRICE_NOT_FOUND',
          '局部烫金空白封组合已配置为无报价',
        ),
      ],
      errors: [],
    };
  }
  if (!fixedPerPass || !perPiecePerPass) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['局部烫金价表金额配置无效'],
    };
  }
  const passCount = item.frontColors.length + item.backColors.length;
  const blankAmount = safeMoney(blankRate.times(item.quantity));
  const machineAmount = safeMoney(
    item.quantity < snapshot.partial.machineFee.perPassBelowQuantity
      ? fixedPerPass.times(passCount)
      : perPiecePerPass.times(item.quantity).times(passCount),
  );
  if (blankAmount === null || machineAmount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['局部烫金建议金额超过系统上限，无法保存'],
    };
  }
  const amount = sumMoneySafely([blankAmount, machineAmount]);
  if (amount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['局部烫金加工费合计超过可保存上限'],
    };
  }
  const blankUnitPrice = safeUnitPrice(blankRate);
  if (blankUnitPrice === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['局部烫金空白封单价超过可保存上限'],
    };
  }
  return {
    amount,
    unitPrice: blankUnitPrice,
    manualReasons: [],
    errors: [],
    lines: [
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'PARTIAL_BLANK',
        label: '空白封',
        amount: blankAmount,
        basis: {
          quantity: item.quantity,
          unitPrice: blankUnitPrice,
          paperType: item.paperType,
          paperWeightGsm: item.paperWeightGsm,
          specification: item.specification,
          ...(historicalPrice ? {
            historicalPriceSource: historicalPrice.source,
            sourceItemId: historicalPrice.sourceItemId,
            sourcePriceBookId: historicalPrice.sourcePriceBookId,
            sourcePriceBookVersion: historicalPrice.sourcePriceBookVersion,
            confirmedAt: historicalPrice.confirmedAt,
            actorId: historicalPrice.actorId,
            historicalPriceReason: 'CURRENT_BLANK_PRICE_UNAVAILABLE',
          } : {}),
        },
      }),
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'PARTIAL_MACHINE',
        label: '机烫费',
        amount: machineAmount,
        basis: {
          quantity: item.quantity,
          passCount,
          calculation:
            item.quantity < snapshot.partial.machineFee.perPassBelowQuantity
              ? 'FIXED_PER_PASS'
              : 'PER_PIECE_PER_PASS',
        },
      }),
    ],
  };
}

function quoteFullProcessing(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): {
  lines: CreateOrderQuoteLine[];
  amount: string | null;
  unitPrice: string | null;
  manualReasons: CreateOrderManualReason[];
  errors: string[];
} {
  // Business policy (2026-09-11): ice-white full foil is priced by an administrator,
  // even if a future price book happens to contain a matching automatic rate.
  if (item.paperType.trim() === '冰白纸') {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [manualReason(
        'FULL_ICE_WHITE_ADMIN_PRICING',
        '冰白纸专版烫金由管理员手动核价，请提交工单后等待核价',
      )],
      errors: [],
    };
  }
  const manualReasons: CreateOrderManualReason[] = [];
  if (item.frontColors.length >= 3) {
    manualReasons.push(
      manualReason(
        'FULL_THREE_OR_MORE_COLORS',
        '专版烫金三色及以上没有自动价',
      ),
    );
  }
  if (item.productStructure === 'TEN_THOUSAND_ENVELOPE') {
    manualReasons.push(
      manualReason(
        'FULL_TEN_THOUSAND_ENVELOPE',
        '万元封专版烫金没有阶梯价',
      ),
    );
  }
  const selected = selectFullUnitPrice(item, snapshot.full);
  if (!selected || selected.unitPrice === null) {
    manualReasons.push(
      manualReason('FULL_PRICE_NOT_FOUND', '专版烫金实际数量区间没有配置价格'),
    );
  }

  const paperMatches = snapshot.full.paperSurcharges.filter(
    (candidate) =>
      candidate.paperType.trim() === item.paperType.trim() &&
      candidate.paperWeightGsm === item.paperWeightGsm,
  );
  const basePaperMatches = snapshot.full.basePapers.filter(
    (candidate) =>
      candidate.paperType.trim() === item.paperType.trim() &&
      candidate.paperWeightGsm === item.paperWeightGsm,
  );
  if (
    paperMatches.length > 1 ||
    basePaperMatches.length > 1 ||
    (paperMatches.length === 1 && basePaperMatches.length === 1) ||
    (paperMatches.length === 0 && basePaperMatches.length !== 1) ||
    paperMatches[0]?.unitSurcharge === null
  ) {
    manualReasons.push(
      manualReason(
        'FULL_PAPER_SURCHARGE_NOT_FOUND',
        '专版烫金非基准纸张没有唯一有效的加价行',
      ),
    );
  }

  const needsSecondColor = item.frontColors.length === 2;
  if (needsSecondColor && snapshot.full.secondColorUnitSurcharge === null) {
    manualReasons.push(
      manualReason(
        'FULL_SECOND_COLOR_SURCHARGE_NOT_FOUND',
        '专版双色没有配置加价',
      ),
    );
  }

  const needsWestEnvelope = item.productStructure === 'WESTERN_ENVELOPE';
  if (needsWestEnvelope && snapshot.full.westEnvelopeUnitSurcharge === null) {
    manualReasons.push(
      manualReason(
        'FULL_WEST_ENVELOPE_SURCHARGE_NOT_FOUND',
        '专版西封没有配置加价',
      ),
    );
  }

  const effect = item.specialEffect ?? 'NONE';
  const effectMatches = snapshot.full.specialEffects.filter(
    (candidate) => candidate.effect === effect,
  );
  const effectPrice =
    effect === 'NONE'
      ? null
      : effectMatches.length === 1
        ? effectMatches[0]!
        : undefined;
  if (
    effect !== 'NONE' &&
    (effectPrice == null ||
      effectPrice.unitSurcharge === null ||
      effectPrice.setupFee === null)
  ) {
    manualReasons.push(
      manualReason(
        'FULL_SPECIAL_EFFECT_PRICE_NOT_FOUND',
        '专版特殊工艺没有唯一有效的加价和调版费',
      ),
    );
  }

  if (manualReasons.length > 0 || !selected || selected.unitPrice === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons,
      errors: [],
    };
  }

  const baseRate = decimalValue(selected.unitPrice);
  const secondColorRate = needsSecondColor
    ? decimalValue(snapshot.full.secondColorUnitSurcharge!)
    : new Decimal(0);
  const westEnvelopeRate = needsWestEnvelope
    ? decimalValue(snapshot.full.westEnvelopeUnitSurcharge!)
    : new Decimal(0);
  const hasConfiguredPaperSurcharge = paperMatches.length === 1;
  const paperRate =
    hasConfiguredPaperSurcharge
      ? decimalValue(paperMatches[0]!.unitSurcharge!)
      : new Decimal(0);
  const effectRate =
    effectPrice === null
      ? new Decimal(0)
      : decimalValue(effectPrice!.unitSurcharge!);
  const setupFee =
    effectPrice === null
      ? new Decimal(0)
      : decimalValue(effectPrice!.setupFee!);
  if (
    !baseRate ||
    !secondColorRate ||
    !westEnvelopeRate ||
    !paperRate ||
    !effectRate ||
    !setupFee
  ) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['专版烫金价表金额或特殊工艺配置无效'],
    };
  }
  const combinedUnitRate = baseRate
    .plus(secondColorRate)
    .plus(westEnvelopeRate)
    .plus(paperRate)
    .plus(effectRate);
  const combinedUnitPrice = safeUnitPrice(combinedUnitRate);
  if (combinedUnitPrice === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['专版烫金组合单价超过可保存上限'],
    };
  }
  const lines: CreateOrderQuoteLine[] = [];
  const baseAmount = safeMoney(baseRate.times(item.quantity));
  if (baseAmount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['专版烫金金额超过可保存上限'],
    };
  }
  lines.push(
    quotedItemLine({
      itemKey: item.itemKey,
      code: 'FULL_BASE',
      label: '专版烫金阶梯价',
      amount: baseAmount,
      basis: {
        quantity: item.quantity,
        unitPrice: unitPrice(baseRate),
        minQuantity: selected.minQuantity,
        maxQuantity: selected.maxQuantity,
      },
    }),
  );
  for (const [active, code, label, rate] of [
    [needsSecondColor, 'FULL_SECOND_COLOR', '专版双色加价', secondColorRate],
    [
      hasConfiguredPaperSurcharge,
      'FULL_PAPER_SURCHARGE',
      '专版纸张加价',
      paperRate,
    ],
    [
      needsWestEnvelope,
      'FULL_WEST_ENVELOPE',
      '专版西封加价',
      westEnvelopeRate,
    ],
    [effect !== 'NONE', 'FULL_SPECIAL_EFFECT', '专版特殊工艺', effectRate],
  ] as const) {
    if (!active) continue;
    const amount = safeMoney(rate.times(item.quantity));
    if (amount === null) {
      return {
        lines: [],
        amount: null,
        unitPrice: null,
        manualReasons: [],
        errors: ['专版烫金加价超过可保存上限'],
      };
    }
    lines.push(
      quotedItemLine({
        itemKey: item.itemKey,
        code,
        label,
        amount,
        basis: { quantity: item.quantity, unitSurcharge: unitPrice(rate) },
      }),
    );
  }
  if (effect !== 'NONE') {
    const setupAmount = safeMoney(setupFee);
    if (setupAmount === null) {
      return {
        lines: [],
        amount: null,
        unitPrice: null,
        manualReasons: [],
        errors: ['专版烫金调版费超过可保存上限'],
      };
    }
    lines.push(
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'FULL_SETUP',
        label: '调版费',
        amount: setupAmount,
        basis: { chargedOnce: true, effect },
      }),
    );
  }
  const amount = sumMoneySafely(lines.map((line) => line.amount));
  if (amount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['专版烫金加工费合计超过可保存上限'],
    };
  }
  return {
    lines,
    amount,
    unitPrice: combinedUnitPrice,
    manualReasons: [],
    errors: [],
  };
}

/**
 * Published color-print foil prices cover one flat front-side pass only.
 * Relief/raised effects and back-side foil have no automatic price, so they
 * leave automatic pricing before any flat bundle can be matched.
 */
function printFoilCapabilityManualReasons(
  item: CreateOrderQuoteItemInput,
): CreateOrderManualReason[] {
  return [
    ...((item.specialEffect ?? 'NONE') !== 'NONE'
      ? [manualReason('PRINT_NON_FLAT_FOIL', '彩印浮雕、激凸没有自动价，需管理员核价')]
      : []),
    ...(item.backColors.length > 0
      ? [manualReason('PRINT_BACK_SIDE_FOIL', '彩印反面烫金没有自动价，需管理员核价')]
      : []),
  ];
}

/**
 * An explicit film must be covered by the published per-order row: ice-white
 * rows are published without film only. No film fact keeps the paper's
 * default finishing, as before.
 */
function printPriceCoversFinishing(
  item: CreateOrderQuoteItemInput,
  price: PrintPerOrderPrice,
): boolean {
  return (
    item.printFinishing === undefined ||
    price.laminations === undefined ||
    (item.printFinishing === 'MATTE' && price.laminations.includes('MATTE'))
  );
}

function quotePrintProcessing(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): {
  lines: CreateOrderQuoteLine[];
  amount: string | null;
  unitPrice: null;
  manualReasons: CreateOrderManualReason[];
  errors: string[];
} {
  const foilCapabilityReasons = printFoilCapabilityManualReasons(item);
  if (foilCapabilityReasons.length > 0) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: foilCapabilityReasons,
      errors: [],
    };
  }
  const finishing = item.printFinishing ?? 'MATTE';
  if (finishing !== 'MATTE') {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PRINT_FINISHING_PRICE_NOT_FOUND',
          '彩印触感膜、新光膜或雷射膜加价待定',
        ),
      ],
      errors: [],
    };
  }
  if (item.quantity > 20_000) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PRINT_QUANTITY_OVER_LIMIT',
          '彩印数量超过 20000 个需人工核价',
        ),
      ],
      errors: [],
    };
  }
  const selected = selectPrintPerOrderPrice(item, snapshot.print);
  const selectedAmount = selected?.amount
    ? decimalValue(selected.amount)
    : null;
  if (!selected || !selectedAmount) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PRINT_PRICE_NOT_FOUND',
          '彩印纸张、规格或数量档没有配置价格',
        ),
      ],
      errors: [],
    };
  }
  if (!printPriceCoversFinishing(item, selected)) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [
        manualReason(
          'PRINT_FINISHING_PRICE_NOT_FOUND',
          '彩印当前纸张的阶梯价不含亚膜，需管理员核价',
        ),
      ],
      errors: [],
    };
  }
  const amount = safeMoney(selectedAmount);
  if (amount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['彩印整单价超过可保存上限'],
    };
  }
  const lines = [
    quotedItemLine({
      itemKey: item.itemKey,
      code: 'PRINT_PER_ORDER',
      label: '彩印阶梯总价',
      amount,
      basis: {
        pricingModel: 'PER_ORDER',
        actualQuantity: item.quantity,
        tierQuantity: selected.tierQuantity,
      },
    }),
  ];
  const foilMode = item.printFoilMode ?? 'NONE';
  if (foilMode !== 'NONE') {
    const tierQuantity = resolvePrintTierQuantity(
      item.quantity,
      snapshot.print.perOrderPrices.map((row) => row.tierQuantity),
    );
    const passCount = item.frontColors.length + item.backColors.length;
    const matches = snapshot.print.foilPerOrderPrices.filter(
      (candidate) =>
        candidate.mode === foilMode &&
        candidate.foilPassCount === passCount &&
        candidate.tierQuantity === tierQuantity,
    );
    const bundledAmount =
      snapshot.print.foilPricingPolicy ===
        CREATE_ORDER_PRINT_FOIL_PRICING_POLICY &&
      matches.length === 1 &&
      matches[0]!.amount !== null
        ? decimalValue(matches[0]!.amount!)
        : null;
    if (bundledAmount === null) {
      return {
        lines,
        amount: null,
        unitPrice: null,
        manualReasons: [
          manualReason(
            'PRINT_FOIL_PRICE_NOT_FOUND',
            '彩印单色烫金含版费原子套餐的当前模式、过版数或数量档没有唯一明确价格',
          ),
        ],
        errors: [],
      };
    }
    const safeBundledAmount = safeMoney(bundledAmount);
    if (safeBundledAmount === null) {
      return {
        lines: [],
        amount: null,
        unitPrice: null,
        manualReasons: [],
        errors: ['彩印烫金含版费套餐价超过可保存上限'],
      };
    }
    lines.push(
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'PRINT_FOIL_PER_ORDER',
        label: '彩印单色烫金（含制版费）',
        amount: safeBundledAmount,
        basis: {
          pricingModel: 'PER_ORDER',
          pricingPolicy: CREATE_ORDER_PRINT_FOIL_PRICING_POLICY,
          plateTreatment: 'INCLUDED_IN_ATOMIC_BUNDLE',
          mode: foilMode,
          passCount,
          tierQuantity,
        },
      }),
    );
  }
  const totalAmount = sumMoneySafely(lines.map((line) => line.amount));
  if (totalAmount === null) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons: [],
      errors: ['彩印加工费合计超过可保存上限'],
    };
  }
  return {
    lines,
    amount: totalAmount,
    unitPrice: null,
    manualReasons: [],
    errors: [],
  };
}

export function quoteCreateOrderItem(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): CreateOrderItemQuote {
  const manualPricingReason = item.manualPricingReason?.trim();
  if (item.manualPricingReason != null && !manualPricingReason) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'INVALID_INPUT',
      unitPrice: null,
      processingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: [],
      manualReasons: [],
      errors: ['配置外项目说明不能为空'],
    };
  }
  if (manualPricingReason) {
    const basicErrors: string[] = [];
    if (!item.itemKey.trim()) basicErrors.push('款式标识不能为空');
    if (!Number.isSafeInteger(item.fig) || item.fig < 1) {
      basicErrors.push('fig 必须是正整数');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      basicErrors.push('数量必须是正整数');
    }
    basicErrors.push(...printFoilValidationErrors(item));
    if (basicErrors.length > 0) {
      return {
        itemKey: item.itemKey,
        fig: item.fig,
        status: 'INVALID_INPUT',
        unitPrice: null,
        processingAmount: null,
        amount: null,
        knownAmount: '0.00',
        lines: [],
        manualReasons: [],
        errors: basicErrors,
      };
    }
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'MANUAL_PRICING_REQUIRED',
      unitPrice: null,
      processingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: [],
      manualReasons: appendPrintFoilManualPricePolicy(item, [
        manualReason(
          'CONFIGURATION_OUTSIDE_NOTE',
          `配置外项目：${manualPricingReason}`,
        ),
      ]),
      errors: [],
    };
  }

  const validationErrors = validateItem(item);
  if (validationErrors.length > 0) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'INVALID_INPUT',
      unitPrice: null,
      processingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: [],
      manualReasons: [],
      errors: validationErrors,
    };
  }

  const inheritedManualReasons = commonManualReasons(item);
  const processing =
    item.craft === 'PARTIAL'
      ? quotePartialProcessing(item, snapshot)
      : item.craft === 'FULL'
        ? quoteFullProcessing(item, snapshot)
        : quotePrintProcessing(item, snapshot);
  const baseManualReasons = [
    ...inheritedManualReasons,
    ...processing.manualReasons,
  ];
  const manualReasons =
    baseManualReasons.length > 0
      ? appendPrintFoilManualPricePolicy(item, baseManualReasons)
      : baseManualReasons;
  const errors = [
    ...processing.errors,
  ];
  const rawLines = [...processing.lines];

  if (errors.length > 0) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'INVALID_INPUT',
      unitPrice: null,
      processingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: excludedManualLines(rawLines),
      manualReasons: [],
      errors,
    };
  }

  if (manualReasons.length > 0) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'MANUAL_PRICING_REQUIRED',
      unitPrice: null,
      processingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: excludedManualLines(rawLines),
      manualReasons,
      errors: [],
    };
  }

  return {
    itemKey: item.itemKey,
    fig: item.fig,
    status: processing.amount === null ? 'PARTIAL' : 'QUOTED',
    unitPrice: processing.unitPrice,
    processingAmount: processing.amount,
    amount: processing.amount,
    knownAmount: sumMoney([processing.amount]),
    lines: rawLines,
    manualReasons: [],
    errors: [],
  };
}
