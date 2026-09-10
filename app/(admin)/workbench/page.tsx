import { requirePermission } from '@/lib/auth/permissions';
import { listExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { SalesWorkbench } from '@/components/business/workbench/SalesWorkbench';

export const metadata = { title: '工作台 · 红包印刷 ERP' };

export default async function WorkbenchPage() {
  await requirePermission('order:create');
  const options = await listExternalCreateOrderOptions().catch(() => null);
  return (
    <SalesWorkbench
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
