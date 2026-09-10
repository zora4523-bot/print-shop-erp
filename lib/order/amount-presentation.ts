import { OrderPricingStatus, OrderStatus } from '../../generated/prisma/enums';
import { formatMoney } from '../dashboard/format';

/**
 * 金额三态的唯一来源（docs/ui-规范.md §4.3）。
 *
 * 三态只由服务端事实决定，UI 不得从金额是否为零或本地枚举猜测：
 *   - 草稿：还没提交，没有任何报价事实；
 *   - 待工厂核价：`pricingStatus = PENDING_ADMIN_CONFIRMATION`，或投影层已判定
 *     人工核价 / 费用不完整（`amount === null`）；
 *   - 报价：有金额且任一费用行 `estimated`；
 *   - 已确认：有金额且无估算行。
 */
export type OrderAmountPresentation = {
  label: string;
  /** 需要在金额旁显示可见的「估」。 */
  estimated: boolean;
  /** 待工厂核价 / 未报价，展示文字而不是零金额。 */
  pending: boolean;
};

export type OrderAmountInput = {
  status: OrderStatus;
  /** 已知金额；`null` 表示尚无可展示金额。 */
  amount: string | null;
  pricingStatus?: OrderPricingStatus | null;
  /** 任一费用行是估算值。 */
  estimated?: boolean;
  /** 投影层判定「费用不完整」，与普通待核价文案区分。 */
  incomplete?: boolean;
};

export function orderAmountPresentation({
  status,
  amount,
  pricingStatus,
  estimated = false,
  incomplete = false,
}: OrderAmountInput): OrderAmountPresentation {
  if (status === OrderStatus.DRAFT && amount === null) {
    return { label: '未报价', estimated: false, pending: true };
  }
  if (incomplete) {
    return { label: '金额不完整', estimated: false, pending: true };
  }
  if (
    amount === null ||
    pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION
  ) {
    return { label: '待工厂核价', estimated: false, pending: true };
  }
  return { label: formatMoney(amount), estimated, pending: false };
}
