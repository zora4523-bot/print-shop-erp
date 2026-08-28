import Decimal from 'decimal.js';
import { decimalValue, money, safeMoney, sumMoney, unitPrice } from './money';
import {
  resolvePrintTierQuantity,
  selectFullUnitPrice,
  selectPartialUnitPrice,
  selectPrintPerOrderPrice,
} from './selectors';
import type {
  CreateOrderItemQuote,
  CreateOrderManualReason,
  CreateOrderPriceSnapshot,
  CreateOrderQuoteItemInput,
  CreateOrderQuoteLine,
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
    code: args.code,
    label: args.label,
    status: 'QUOTED',
    amount: args.amount,
    includedInKnownTotal: true,
    basis: args.basis,
    errors: [],
  };
}

function pendingBaggingLine(
  item: CreateOrderQuoteItemInput,
): CreateOrderQuoteLine {
  return {
    layer: 'ITEM',
    itemKey: item.itemKey,
    code: 'BAGGING',
    label: '入袋',
    status: 'PENDING',
    amount: null,
    includedInKnownTotal: false,
    basis: {
      quantity: item.quantity,
      pack: null,
      packRaw: item.packRaw,
      displayAmount: '—',
    },
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
    !Number.isFinite(item.paperWeightGsm) ||
    item.paperWeightGsm <= 0
  ) {
    errors.push('纸张克重必须是正数');
  }
  if (
    item.pack !== null &&
    (!Number.isSafeInteger(item.pack) || item.pack < 1)
  ) {
    errors.push('每包数量必须为正整数或留空');
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
  if (
    item.craft === 'PRINT' &&
    (item.printFoilMode ?? 'NONE') === 'FULL' &&
    item.backColors.length > 0
  ) {
    errors.push('彩印叠加专版烫金只能使用正面');
  }
  if (
    item.craft === 'PRINT' &&
    (item.printFoilMode ?? 'NONE') === 'NONE' &&
    item.frontColors.length + item.backColors.length > 0
  ) {
    errors.push('彩印未叠加烫金时不能携带烫金颜色');
  }
  return errors;
}

function commonManualReasons(
  item: CreateOrderQuoteItemInput,
): CreateOrderManualReason[] {
  return [
    ...(item.customPaper
      ? [manualReason('CUSTOM_PAPER', '自定义纸张需人工核价')]
      : []),
    ...(item.paperWeightSource === 'MANUAL'
      ? [manualReason('MANUAL_PAPER_WEIGHT', '手动输入克重需人工核价')]
      : []),
    ...(item.isResized
      ? [manualReason('RESIZED', '改尺寸需人工核价')]
      : []),
  ];
}

function quoteBagging(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): { line: CreateOrderQuoteLine; amount: string | null; error: string | null } {
  if (item.pack === null) {
    return { line: pendingBaggingLine(item), amount: null, error: null };
  }
  const rate = decimalValue(
    item.packagingMode === 'MIXED'
      ? snapshot.bagging.mixedPerBag
      : snapshot.bagging.standardPerBag,
  );
  if (!rate) {
    const error = '入袋费率配置无效';
    return {
      line: {
        ...pendingBaggingLine(item),
        errors: [error],
      },
      amount: null,
      error,
    };
  }
  const bagCount = Math.ceil(item.quantity / item.pack);
  const amount = safeMoney(rate.times(bagCount));
  if (amount === null) {
    const error = '入袋费超过可保存上限';
    return {
      line: { ...pendingBaggingLine(item), errors: [error] },
      amount: null,
      error,
    };
  }
  return {
    amount,
    error: null,
    line: quotedItemLine({
      itemKey: item.itemKey,
      code: 'BAGGING',
      label: item.packagingMode === 'MIXED' ? '混装入袋' : '常规入袋',
      amount,
      basis: {
        quantity: item.quantity,
        pack: item.pack,
        packRaw: item.packRaw,
        bagCount,
        rate: unitPrice(rate),
        mode: item.packagingMode,
      },
    }),
  };
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
  const selected = selectPartialUnitPrice(item, snapshot.partial);
  if (!selected) {
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
  const blankRate = decimalValue(selected.unitPrice);
  const fixedPerPass = decimalValue(
    snapshot.partial.machineFee.fixedFeePerPass,
  );
  const perPiecePerPass = decimalValue(
    snapshot.partial.machineFee.perPiecePerPass,
  );
  if (!blankRate || !fixedPerPass || !perPiecePerPass) {
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
      errors: ['局部烫金金额超过可保存上限'],
    };
  }
  return {
    amount: sumMoney([blankAmount, machineAmount]),
    unitPrice: unitPrice(blankRate),
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
          unitPrice: unitPrice(blankRate),
          paperType: item.paperType,
          paperWeightGsm: item.paperWeightGsm,
          specification: item.specification,
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
  if (!selected) {
    manualReasons.push(
      manualReason('FULL_PRICE_NOT_FOUND', '专版烫金实际数量区间没有配置价格'),
    );
  }
  if (manualReasons.length > 0 || !selected) {
    return {
      lines: [],
      amount: null,
      unitPrice: null,
      manualReasons,
      errors: [],
    };
  }

  const baseRate = decimalValue(selected.unitPrice);
  const secondColorRate =
    item.frontColors.length === 2
      ? decimalValue(snapshot.full.secondColorUnitSurcharge)
      : new Decimal(0);
  const paperMatches = snapshot.full.paperSurcharges.filter(
    (candidate) =>
      candidate.paperType.trim() === item.paperType.trim() &&
      candidate.paperWeightGsm === item.paperWeightGsm,
  );
  const paperRate =
    paperMatches.length === 0
      ? new Decimal(0)
      : paperMatches.length === 1
        ? decimalValue(paperMatches[0]!.unitSurcharge)
        : null;
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
  const effectRate =
    effectPrice === null
      ? new Decimal(0)
      : effectPrice === undefined
        ? null
        : decimalValue(effectPrice.unitSurcharge);
  const setupFee =
    effectPrice === null
      ? new Decimal(0)
      : effectPrice === undefined
        ? null
        : decimalValue(effectPrice.setupFee);
  if (!baseRate || !secondColorRate || !paperRate || !effectRate || !setupFee) {
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
    .plus(paperRate)
    .plus(effectRate);
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
  for (const [code, label, rate] of [
    ['FULL_SECOND_COLOR', '专版双色加价', secondColorRate],
    ['FULL_PAPER_SURCHARGE', '专版纸张加价', paperRate],
    ['FULL_SPECIAL_EFFECT', '专版特殊工艺', effectRate],
  ] as const) {
    if (rate.isZero()) continue;
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
  if (!setupFee.isZero()) {
    lines.push(
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'FULL_SETUP',
        label: '调版费',
        amount: money(setupFee),
        basis: { chargedOnce: true, effect },
      }),
    );
  }
  return {
    lines,
    amount: sumMoney(lines.map((line) => line.amount)),
    unitPrice: unitPrice(combinedUnitRate),
    manualReasons: [],
    errors: [],
  };
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
    const addOn = matches.length === 1 ? decimalValue(matches[0]!.amount) : null;
    if (!addOn) {
      return {
        lines,
        amount: null,
        unitPrice: null,
        manualReasons: [
          manualReason(
            'PRINT_FOIL_PRICE_NOT_FOUND',
            '彩印叠加烫金的当前模式、过版数或数量档没有价格',
          ),
        ],
        errors: [],
      };
    }
    const addOnAmount = safeMoney(addOn);
    if (addOnAmount === null) {
      return {
        lines: [],
        amount: null,
        unitPrice: null,
        manualReasons: [],
        errors: ['彩印烫金加价超过可保存上限'],
      };
    }
    lines.push(
      quotedItemLine({
        itemKey: item.itemKey,
        code: 'PRINT_FOIL_PER_ORDER',
        label: '彩印叠加烫金',
        amount: addOnAmount,
        basis: {
          pricingModel: 'PER_ORDER',
          mode: foilMode,
          passCount,
          tierQuantity,
        },
      }),
    );
  }
  return {
    lines,
    amount: sumMoney(lines.map((line) => line.amount)),
    unitPrice: null,
    manualReasons: [],
    errors: [],
  };
}

export function quoteCreateOrderItem(
  item: CreateOrderQuoteItemInput,
  snapshot: CreateOrderPriceSnapshot,
): CreateOrderItemQuote {
  const validationErrors = validateItem(item);
  const bagging = quoteBagging(item, snapshot);
  if (validationErrors.length > 0) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'INVALID_INPUT',
      unitPrice: null,
      processingAmount: null,
      baggingAmount: null,
      amount: null,
      knownAmount: '0.00',
      lines: excludedManualLines([bagging.line]),
      manualReasons: [],
      errors: [...validationErrors, ...(bagging.error ? [bagging.error] : [])],
    };
  }

  const inheritedManualReasons = commonManualReasons(item);
  const processing =
    item.craft === 'PARTIAL'
      ? quotePartialProcessing(item, snapshot)
      : item.craft === 'FULL'
        ? quoteFullProcessing(item, snapshot)
        : quotePrintProcessing(item, snapshot);
  const manualReasons = [
    ...inheritedManualReasons,
    ...processing.manualReasons,
  ];
  const errors = [
    ...processing.errors,
    ...(bagging.error ? [bagging.error] : []),
  ];
  const rawLines = [...processing.lines, bagging.line];

  if (errors.length > 0) {
    return {
      itemKey: item.itemKey,
      fig: item.fig,
      status: 'INVALID_INPUT',
      unitPrice: null,
      processingAmount: null,
      baggingAmount: null,
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
      baggingAmount: bagging.amount,
      amount: null,
      knownAmount: '0.00',
      lines: excludedManualLines(rawLines),
      manualReasons,
      errors: [],
    };
  }

  const complete = processing.amount !== null && bagging.amount !== null;
  return {
    itemKey: item.itemKey,
    fig: item.fig,
    status: complete ? 'QUOTED' : 'PARTIAL',
    unitPrice: processing.unitPrice,
    processingAmount: processing.amount,
    baggingAmount: bagging.amount,
    amount: complete
      ? sumMoney([processing.amount, bagging.amount])
      : null,
    knownAmount: sumMoney([
      processing.amount,
      bagging.amount,
    ]),
    lines: rawLines,
    manualReasons: [],
    errors: [],
  };
}
