import { blankPriceIdentity, blankPriceIdentityFromCondition, type BlankPriceIdentity } from './blank-price-identity';
import { parseCustomerRuleCondition } from './customer-rule-condition';

/** Shared by draft creation and the pre-migration gate: neither may guess an identity. */
export function inspectBlankDraftIdentity(rule: {
  triggerCondition: unknown;
  productId: string | null;
  product?: { code: string | null; paperType: string | null; weight: number | null; specification: string | null } | null;
}): { identity: BlankPriceIdentity; issue: null } | { identity: null; issue: string } {
  const identity = blankPriceIdentityFromCondition(rule.triggerCondition);
  if (!identity) return { identity: null, issue: '空白封规则身份不完整，无法创建调价草稿' };
  const condition = parseCustomerRuleCondition(rule.triggerCondition).condition;
  if (rule.productId !== null) {
    const productIdentity = rule.product?.paperType && rule.product.specification ? blankPriceIdentity({
      paperType: rule.product.paperType, paperWeightGsm: rule.product.weight, specification: rule.product.specification,
    }) : null;
    if (!productIdentity || productIdentity.key !== identity.key ||
        (condition?.productCodes && (condition.productCodes.length !== 1 || condition.productCodes[0] !== rule.product?.code))) {
      return { identity: null, issue: '空白封历史产品与价格文本不一致，请先修复后再创建调价草稿' };
    }
  } else if (condition?.productCodes) {
    return { identity: null, issue: '空白封价格仍有不明确的产品条件，请先修复' };
  }
  return { identity, issue: null };
}
