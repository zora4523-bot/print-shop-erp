import { redirect } from 'next/navigation';
import {
  OrderSettlementType,
  Role,
} from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import { listActiveProductOrderOptions } from '@/lib/product';
import { OrderForm } from '@/components/business/order/OrderForm';
import {
  ORDER_SETTLEMENT_LABELS,
  settlementTypeForOrderCreator,
} from '@/lib/order/settlement';

export const metadata = {
  title: '新建工单 · 红包印刷 ERP',
};

export default async function NewOrderPage() {
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.ADMIN;
  if (!canCreate) redirect('/orders');

  const [crafts, products] = await Promise.all([
    listActiveCraftOrderOptions(),
    listActiveProductOrderOptions(),
  ]);
  const settlementType = settlementTypeForOrderCreator(user.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建工单</h1>
        <p className="text-sm text-muted-foreground">
          创建后自动生成易读工单号（如 GD-260719-001）并保存为草稿；进入详情页后再点
          &ldquo;提交工单&rdquo; 进入排产流程。
        </p>
      </div>
      <OrderForm
        crafts={crafts}
        products={products}
        settlementLabel={
          ORDER_SETTLEMENT_LABELS[settlementType]
        }
        usesExternalSalesPricing={
          settlementType === OrderSettlementType.EXTERNAL_SALES
        }
      />
    </div>
  );
}
