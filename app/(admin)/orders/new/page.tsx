import { redirect } from 'next/navigation';
import { OrderSettlementType, Role } from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import {
  listActiveProductOrderOptions,
  listCurrentExternalSalesProductOrderOptions,
} from '@/lib/product';
import { listActivePaperOrderOptions } from '@/lib/material';
import { listCustomerPartyOptions } from '@/lib/party';
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

  const settlementType = settlementTypeForOrderCreator(user.role);
  const usesExternalSalesPricing =
    settlementType === OrderSettlementType.EXTERNAL_SALES;
  const [crafts, products, paperMaterials, customers] = await Promise.all([
    listActiveCraftOrderOptions(),
    usesExternalSalesPricing
      ? listCurrentExternalSalesProductOrderOptions()
      : listActiveProductOrderOptions(),
    listActivePaperOrderOptions(),
    listCustomerPartyOptions(),
  ]);

  return (
    <div className="space-y-4">
      {!usesExternalSalesPricing ? (
        <div>
          <h1 className="text-xl font-semibold">新建工单</h1>
          <p className="text-sm text-muted-foreground">
            费用随款式参数更新；未匹配价格的款式由管理员终价。
          </p>
        </div>
      ) : null}
      <OrderForm
        draftScope={user.id}
        crafts={crafts}
        products={products}
        paperMaterials={paperMaterials}
        customers={customers}
        settlementLabel={ORDER_SETTLEMENT_LABELS[settlementType]}
        usesExternalSalesPricing={usesExternalSalesPricing}
      />
    </div>
  );
}
