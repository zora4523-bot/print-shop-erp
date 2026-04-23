import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listCrafts } from '@/lib/craft';
import { listProducts } from '@/lib/product';
import { OrderForm } from '@/components/business/order/OrderForm';

export const metadata = {
  title: '新建工单 · 红包印刷 ERP',
};

export default async function NewOrderPage() {
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.OWNER ||
    user.role === Role.FOREMAN;
  if (!canCreate) redirect('/orders');

  const [allCrafts, allProducts] = await Promise.all([listCrafts(), listProducts()]);

  // Only show active entries in the picker — the server-side guard in
  // createOrder.ts would reject inactive refs anyway.
  const crafts = allCrafts
    .filter((c) => c.isActive)
    .map((c) => ({ id: c.id, name: c.name, isOutsource: c.isOutsource }));
  const products = allProducts
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name, category: p.category }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建工单</h1>
        <p className="text-sm text-muted-foreground">
          填完基本信息和至少一个款式后，&ldquo;创建工单&rdquo; 会保存为草稿（DRAFT）。
          进入详情页后再点 &ldquo;提交工单&rdquo; 进入排产流程。
        </p>
      </div>
      <OrderForm crafts={crafts} products={products} />
    </div>
  );
}
