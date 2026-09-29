import { redirect } from "next/navigation";
import { Role } from "../../../../generated/prisma/enums";
import { requireSession } from "@/lib/auth/session";
import { listActiveCraftOrderOptions } from "@/lib/craft";
import { listExternalSalesAccountOptions } from "@/lib/order/external-sales-association";
import { OrderCreationWorkspace } from "@/components/business/order/OrderCreationWorkspace";
import { PageHeader } from "@/components/ui-business";
import { NoExternalSalesEmptyState } from "@/components/business/order/NoExternalSalesEmptyState";
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
  // 业主 2026-09-24：所有业务都以外部销售身份开展。销售本人建单；管理员
  // 代建时必须选择一个启用的外部销售账号。
  if (user.role !== Role.SALES && user.role !== Role.ADMIN) redirect("/orders");

  const externalSalesAccounts =
    user.role === Role.ADMIN ? await listExternalSalesAccountOptions(user) : undefined;
  if (externalSalesAccounts && externalSalesAccounts.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader back={{ href: "/orders", label: "返回工单列表" }} title="新建工单" />
        <NoExternalSalesEmptyState />
      </div>
    );
  }

  const [crafts, createOrderBootstrap] = await Promise.all([
    listActiveCraftOrderOptions(),
    // Every chargeable create path uses the same published catalog snapshot.
    // Role changes who may request manual pricing, not which paper/spec/craft
    // dictionary the form renders.
    loadExternalCreateOrderBootstrap(),
  ]);

  return (
    <div className="space-y-4">
      <OrderCreationWorkspace
        key={workbenchTransferId ?? "new"}
        workbenchTransferId={workbenchTransferId}
        draftScope={user.id}
        crafts={crafts}
        products={createOrderBootstrap.options.products}
        externalSalesAccounts={externalSalesAccounts}
        externalCreateOrderOptions={createOrderBootstrap.options}
        initialExternalPriceSnapshot={createOrderBootstrap.priceSnapshot}
      />
    </div>
  );
}
