type PriceRuleFacts = { operationType: string; unit: string; smallOrderAmount: unknown };

/**
 * 分档烫金报工：报工所用工价簿里有同工序类型、同计价单位且带小单价的规则。
 * 以已发布规则而不是报工快照里的可选说明为准；结算的“分档工序尚未结束”判定与
 * 升版时旧代次转人工核定共用这一口径。
 */
export function reportUsesTieredFoilWage(
  operationType: string,
  report: { unit: string; priceBook: { rules: readonly PriceRuleFacts[] } },
): boolean {
  return operationType !== 'PACKING' && report.priceBook.rules.some((rule) =>
    rule.operationType === operationType && rule.unit === report.unit && rule.smallOrderAmount !== null);
}
