import { createHash } from 'node:crypto';
import release from '@/config/customer-price-books/dark-red-paper-20261020.json';
import { parseCustomerRuleCondition } from './customer-rule-condition';
import { canonicalizeCreateOrderPaperFact } from './create-order/canonical-facts';
import type { DraftPriceRuleForValidation } from './customer-price-book-draft-validation';

export { release as DARK_RED_PAPER_RELEASE };

export function buildDarkRedPaperReleaseRules(
  original: DraftPriceRuleForValidation[],
): DraftPriceRuleForValidation[] {
  const surchargeRules = original.filter(rule => rule.exclusiveGroup === 'CUSTOM_PAPER_SURCHARGE');
  if (original.some(rule => rule.code === release.ruleCode) || surchargeRules.some(rule =>
    parseCustomerRuleCondition(rule.triggerCondition).condition?.paperTypes?.some(paper => {
      const fact = canonicalizeCreateOrderPaperFact(paper);
      return fact?.paperType === '珠光闪红' && fact.paperWeightGsm === 160;
    }))) {
    throw new Error('当前版本已有暗红纸张加价，请核对现有规则');
  }
  const anchors = surchargeRules.filter(rule =>
    rule.code === 'CUSTOM_PAPER_VARIEGATED_PEARL_160' && rule.isActive);
  if (anchors.length !== 1) throw new Error('缺少唯一有效的杂色珠光专版加价规则');
  const anchor = anchors[0]!;
  const source = {
    sourceName: release.source,
    sourceSha256: createHash('sha256').update(JSON.stringify(release)).digest('hex'),
    sourceSheet: '专版纸张加价',
    sourceRange: null,
  };
  let tierCount = 0;
  const tiers = original.map(rule => {
    if (rule.exclusiveGroup !== 'CUSTOM_BASE') return rule;
    const { condition } = parseCustomerRuleCondition(rule.triggerCondition);
    if (!rule.isActive || !condition?.paperTypes?.length ||
        condition.paperTypes.includes(release.paperType)) {
      throw new Error('专版阶梯纸张范围不符合本次发布条件');
    }
    tierCount += 1;
    return {
      ...rule,
      ...source,
      triggerCondition: { ...condition, paperTypes: [...condition.paperTypes, release.paperType] },
    };
  });
  if (tierCount === 0) throw new Error('缺少专版阶梯规则');
  return [...tiers, {
    ...anchor,
    ...source,
    id: release.ruleCode,
    code: release.ruleCode,
    name: '暗红珠光 160g',
    amount: release.unitSurcharge,
    productId: null,
    product: null,
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
      paperTypes: [release.paperType],
    },
    note: '160g暗红珠光纸专版烫金每个加价0.03元。',
  }];
}
