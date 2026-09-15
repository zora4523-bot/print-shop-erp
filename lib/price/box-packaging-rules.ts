import { OrderPackagingMode } from '@/generated/prisma/enums';

export const BOX_PRICE_RULES = [
  {
    code: 'BOX_RED_CARD_EMPTY',
    name: '红卡盒子 230g 空盒',
    group: 'BOX_CONTAINER',
    modes: [OrderPackagingMode.BOX_RED_CARD, OrderPackagingMode.BOX_RED_CARD_MIXED],
  },
  {
    code: 'BOX_TACTILE_EMPTY',
    name: '触感盒子 250g 空盒',
    group: 'BOX_CONTAINER',
    modes: [OrderPackagingMode.BOX_TACTILE, OrderPackagingMode.BOX_TACTILE_MIXED],
  },
  {
    code: 'BOX_PACKING_LABOR',
    name: '红包装盒加工费',
    group: 'BOX_LABOR',
    modes: [
      OrderPackagingMode.BOX_RED_CARD,
      OrderPackagingMode.BOX_RED_CARD_MIXED,
      OrderPackagingMode.BOX_TACTILE,
      OrderPackagingMode.BOX_TACTILE_MIXED,
    ],
  },
] as const;

export function boxPriceRuleDefinition(code: string | null) {
  return BOX_PRICE_RULES.find((rule) => rule.code === code);
}

/** Only used by the reviewed draft installer; runtime prices come from published rules. */
export const CONFIRMED_BOX_RATES = ['1.3000', '1.8000', '0.5000'] as const;
