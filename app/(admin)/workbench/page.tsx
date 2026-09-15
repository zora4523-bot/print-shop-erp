import { requirePermission } from '@/lib/auth/permissions';
import { listExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import { SalesWorkbench } from '@/components/business/workbench/SalesWorkbench';

export const metadata = { title: '工作台' };

export default async function WorkbenchPage() {
  const actor = await requirePermission('order:create');
  const loaded = await Promise.all([
    listExternalCreateOrderOptions(),
    listActiveCraftOrderOptions(),
  ]).catch(() => null);
  const options = loaded?.[0] ?? null;
  return (
    <SalesWorkbench
      crafts={loaded?.[1] ?? []}
      draftScope={actor.id}
      catalogUnavailable={options === null}
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
