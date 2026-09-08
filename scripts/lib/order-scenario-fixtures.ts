import { createHash } from 'node:crypto';
import { createOrderSchema } from '@/lib/auth/schemas';
import { buildCompletionInput } from './dashboard-order-completion';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';

type Craft = 'PARTIAL' | 'FULL' | 'PRINT' | 'PRINT_FOIL';
export const ORDER_SCENARIOS = [
  { key: 'partial', name: '局部烫金 · 常规单', crafts: ['PARTIAL'], days: 7 },
  { key: 'full', name: '专版烫金 · 明日交付', crafts: ['FULL'], days: 1 },
  { key: 'print', name: '彩印 · 今日交付', crafts: ['PRINT'], days: 0 },
  { key: 'print-foil', name: '彩印加烫金 · 急单', crafts: ['PRINT_FOIL'], days: 2, urgent: true },
  { key: 'mixed', name: '三种工艺 · 多款单', crafts: ['PARTIAL', 'FULL', 'PRINT'], days: 3 },
  { key: 'overdue', name: '局部烫金 · 已逾期', crafts: ['PARTIAL'], days: -2 },
  { key: 'split', name: '专版烫金 · 混装两地址', crafts: ['FULL', 'FULL'], days: 5, split: true },
  { key: 'manual', name: '专版三色 · 待人工核价', crafts: ['FULL'], days: 4, manual: true },
  { key: 'draft', name: '彩印 · 草稿无交期', crafts: ['PRINT'], days: null, state: 'DRAFT' },
  { key: 'hold', name: '彩印 · 暂停待补稿', crafts: ['PRINT'], days: 6, state: 'ON_HOLD' },
  { key: 'rejected', name: '专版三色 · 驳回待补正', crafts: ['FULL'], days: 4, manual: true, state: 'REJECTED' },
  { key: 'change', name: '局部烫金 · 加量申请待审批', crafts: ['PARTIAL'], days: 8, change: true },
  { key: 'cancelled', name: '局部烫金 · 已取消', crafts: ['PARTIAL'], days: -3, state: 'CANCELLED' },
] as const satisfies readonly { key: string; name: string; crafts: readonly Craft[]; days: number | null; urgent?: boolean; split?: boolean; manual?: boolean; change?: boolean; state?: string }[];
export type OrderScenario = (typeof ORDER_SCENARIOS)[number];
export type ScenarioCatalog = { products: Record<'PARTIAL' | 'FULL' | 'PRINT', string>; crafts: Record<Craft | 'MANUAL', string> };

export function scenarioSubmissionId(key: string) {
  const hex = createHash('sha256').update(`ORDER_SCENARIO_V1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildOrderScenarioInput(scenario: OrderScenario, catalog: ScenarioCatalog, now: Date) {
  const base = buildCompletionInput({ id: 'e2e-dash-0000000000000000-sub-1', customName: null, customerRef: null, remark: null, packageRequirement: null, promisedDate: null, isUrgent: false });
  const split = 'split' in scenario && scenario.split;
  const manual = 'manual' in scenario && scenario.manual;
  const quantity = scenario.crafts.length === 3 ? 500 : 1000;
  const items = scenario.crafts.map((craft, index) => {
    const print = craft === 'PRINT' || craft === 'PRINT_FOIL';
    const colors = craft === 'PRINT' ? [] : manual ? ['亚金', '亚银', '红金'] : ['亚金'];
    return { ...base.items[0], fig: index + 1, name: `${scenario.name} · 第 ${index + 1} 款`,
      productId: catalog.products[print ? 'PRINT' : craft as 'PARTIAL' | 'FULL'],
      pricingRoute: print ? 'COLOR_PRINT' : craft === 'PARTIAL' ? 'STOCK_BLANK' : 'CUSTOM_SINGLE_FLAT_FOIL',
      paperType: print ? '200g铜版纸' : '160g珠光艳闪', paperWeightGsm: print ? 200 : 160,
      specification: print ? '大号88×165' : '大号封90×165', actualWidthMm: print ? 88 : 90,
      quantity, pack: 10, crafts: [catalog.crafts[manual ? 'MANUAL' : craft]],
      frontFoilColors: colors, backFoilColors: [], foilColors: colors,
      foilTechnique: craft === 'PRINT' ? 'NONE' : 'FLAT', hasLocalFoil: craft === 'PARTIAL' || craft === 'PRINT_FOIL',
      printColors: print ? ['四色'] : [], lamination: 'NONE',
      manualQuoteReason: null,
    };
  });
  const date = scenario.days === null ? null : new Date(`${todayShanghai(now)}T00:00:00.000Z`);
  if (date && scenario.days !== null) date.setUTCDate(date.getUTCDate() + scenario.days);
  return createOrderSchema.parse({ ...base, clientSubmissionId: scenarioSubmissionId(scenario.key),
    customName: `测试 · ${scenario.name}`, isUrgent: 'urgent' in scenario && scenario.urgent,
    promisedDate: date, items, nextItemFig: items.length + 1,
    remark: 'ORDER_SCENARIO_V1：开发验收数据，不可生产或发货；演示图不是 CDR。',
    packagingGroups: split ? [{ name: '两款混装', mode: 'MIXED_STYLE', actualBagCount: quantity / 10, itemUnitsPerBag: [10, 10] }]
      : items.map((_, index) => ({ name: `第 ${index + 1} 款单款装`, mode: 'SINGLE_STYLE', actualBagCount: quantity / 10, itemUnitsPerBag: items.map((_, i) => i === index ? 10 : 0) })),
    additionalShipments: split ? [{ receiverName: '第二测试收货人', receiverPhone: '00000000000', receiverAddress: '广东省广州市测试地址2号（请勿发货）', destinationProvince: '广东省', expressCode: null, itemQuantities: [500, 500] }] : [],
  });
}
