import { redirect } from 'next/navigation';
import { OrderSettlementType, Role } from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import {
  listActiveProductOrderOptions,
} from '@/lib/product';
import { listCustomerPartyOptions } from '@/lib/party';
import { OrderForm } from '@/components/business/order/OrderForm';
import {
  ORDER_SETTLEMENT_LABELS,
  settlementTypeForOrderCreator,
} from '@/lib/order/settlement';
import { loadExternalCreateOrderBootstrap } from '@/lib/order/create-order-bootstrap';

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
  const [crafts, customers, externalBootstrap, internalProducts] =
    await Promise.all([
    listActiveCraftOrderOptions(),
    listCustomerPartyOptions(),
    usesExternalSalesPricing
      ? loadExternalCreateOrderBootstrap()
      : Promise.resolve(null),
    usesExternalSalesPricing
      ? Promise.resolve([])
      : listActiveProductOrderOptions(),
  ]);
  const products = externalBootstrap?.options.products ?? internalProducts;

  return (
    <div className="space-y-4">
      <OrderForm
        draftScope={user.id}
        crafts={crafts}
        products={products}
        customers={customers}
        settlementLabel={ORDER_SETTLEMENT_LABELS[settlementType]}
        settlementType={settlementType}
        externalCreateOrderOptions={externalBootstrap?.options}
        initialExternalPriceSnapshot={externalBootstrap?.priceSnapshot}
      />
    </div>
  );
}
