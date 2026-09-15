import { redirect } from "next/navigation";
import { Role } from "../../../../generated/prisma/enums";
import { requireSession } from "@/lib/auth/session";
import { listActiveCraftOrderOptions } from "@/lib/craft";
import { listSalesCustomerOptions } from "@/lib/order/sales-customer-scope";
import { listCustomerPartyOptions } from "@/lib/party";
import { listExternalSalesAccountOptions } from "@/lib/order/external-sales-association";
import { OrderForm } from "@/components/business/order/OrderForm";
import {
  ORDER_SETTLEMENT_LABELS,
  settlementTypeForOrderCreator,
} from "@/lib/order/settlement";
import { loadExternalCreateOrderBootstrap } from "@/lib/order/create-order-bootstrap";

export const metadata = {
  title: "新建工单",
};

export default async function NewOrderPage({
  searchParams,
}: { searchParams?: Promise<{ fromWorkbench?: string }> } = {}) {
  const transfer = (await searchParams)?.fromWorkbench;
  const workbenchTransferId =
    typeof transfer === "string" && /^[\da-f-]{36}$/i.test(transfer)
      ? transfer
      : undefined;
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.ADMIN;
  if (!canCreate) redirect("/orders");

  const settlementType = settlementTypeForOrderCreator(user.role);
  const [crafts, customers, createOrderBootstrap, externalSalesAccounts] =
    await Promise.all([
      listActiveCraftOrderOptions(),
      user.role === Role.SALES
        ? listSalesCustomerOptions(user)
        : user.role === Role.CUSTOMER_SERVICE
          ? listCustomerPartyOptions()
          : [],
      // Every chargeable create path uses the same published catalog snapshot.
      // Role changes who may request manual pricing, not which paper/spec/craft
      // dictionary the form renders.
      loadExternalCreateOrderBootstrap(),
      listExternalSalesAccountOptions(user),
    ]);

  return (
    <div className="space-y-4">
      <OrderForm
        key={workbenchTransferId ?? "new"}
        workbenchTransferId={workbenchTransferId}
        draftScope={user.id}
        crafts={crafts}
        products={createOrderBootstrap.options.products}
        customers={customers}
        externalSalesAccounts={
          user.role === Role.ADMIN ? externalSalesAccounts : undefined
        }
        settlementLabel={ORDER_SETTLEMENT_LABELS[settlementType]}
        settlementType={settlementType}
        externalCreateOrderOptions={createOrderBootstrap.options}
        initialExternalPriceSnapshot={createOrderBootstrap.priceSnapshot}
      />
    </div>
  );
}
