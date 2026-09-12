import { redirect } from 'next/navigation';
import { Role } from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import { listSalesCustomerOptions } from '@/lib/order/sales-customer-scope';
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
  const [crafts, customers, createOrderBootstrap] = await Promise.all([
    listActiveCraftOrderOptions(),
    user.role === Role.SALES ? listSalesCustomerOptions(user) : listCustomerPartyOptions(),
    // Every chargeable create path uses the same published catalog snapshot.
    // Role changes who may request manual pricing, not which paper/spec/craft
    // dictionary the form renders.
    loadExternalCreateOrderBootstrap(),
  ]);

  return (
    <div className="space-y-4">
      <OrderForm
        draftScope={user.id}
        crafts={crafts}
        products={createOrderBootstrap.options.products}
        customers={customers}
        settlementLabel={ORDER_SETTLEMENT_LABELS[settlementType]}
        settlementType={settlementType}
        externalCreateOrderOptions={createOrderBootstrap.options}
        initialExternalPriceSnapshot={createOrderBootstrap.priceSnapshot}
      />
    </div>
  );
}
