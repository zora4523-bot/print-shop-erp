export const ORDER_PRICING_STATUS = {
  LEGACY_CONFIRMED: "LEGACY_CONFIRMED",
  AUTO_CONFIRMED: "AUTO_CONFIRMED",
  PENDING_ADMIN_CONFIRMATION: "PENDING_ADMIN_CONFIRMATION",
  ADMIN_CONFIRMED: "ADMIN_CONFIRMED",
} as const;

export type OrderPricingStatusValue =
  (typeof ORDER_PRICING_STATUS)[keyof typeof ORDER_PRICING_STATUS];

export const ORDER_PRICING_STATUS_LABELS: Record<
  OrderPricingStatusValue,
  string
> = {
  LEGACY_CONFIRMED: "历史已确认",
  AUTO_CONFIRMED: "系统自动确认",
  PENDING_ADMIN_CONFIRMATION: "待管理员确认价格",
  ADMIN_CONFIRMED: "管理员已确认",
};

export function orderPricingStatusLabel(
  status: string | null | undefined,
): string {
  if (!status) return "—";
  return (
    ORDER_PRICING_STATUS_LABELS[status as OrderPricingStatusValue] ??
    "未识别状态"
  );
}
