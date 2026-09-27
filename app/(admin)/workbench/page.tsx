import { requirePermission } from '@/lib/auth/permissions';
import { listExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { listExternalSalesAccountOptions } from '@/lib/order/external-sales-association';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import { SalesWorkbench } from '@/components/business/workbench/SalesWorkbench';
import { Role } from '@/generated/prisma/enums';

export const metadata = { title: '工作台' };

export default async function WorkbenchPage() {
  const actor = await requirePermission('order:create');
  const [loaded, externalSalesAccounts] = await Promise.all([
    Promise.all([
      listExternalCreateOrderOptions(),
      listActiveCraftOrderOptions(),
    ]).catch(() => null),
    // 业主 2026-09-24：管理员从工作台直接建寄样品 / 打样也必须选择外部销售。
    actor.role === Role.ADMIN ? listExternalSalesAccountOptions(actor) : undefined,
  ]);
  const options = loaded?.[0] ?? null;
  return (
    <SalesWorkbench
      crafts={loaded?.[1] ?? []}
      draftScope={actor.id}
      catalogUnavailable={options === null}
      externalSalesAccounts={externalSalesAccounts}
      options={
        options ?? {
          products: [],
          papers: [],
          specifications: [],
          foilColors: [],
        }
      }
    />
  );
}
