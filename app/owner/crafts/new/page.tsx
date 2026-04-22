import Link from 'next/link';
import { createCraftAction } from '@/actions/owner-crafts';
import { CraftForm } from '@/components/business/craft/CraftForm';

export const metadata = {
  title: '新建工艺 · 红包印刷 ERP',
};

export default function NewCraftPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建工艺</h1>
        <p className="text-sm text-muted-foreground">
          新工艺默认启用，会立即出现在录单时的工艺多选框里。
          <Link href="/owner/crafts" className="ml-2 text-primary underline hover:no-underline">
            返回列表
          </Link>
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <CraftForm mode="create" action={createCraftAction} />
      </div>
    </div>
  );
}
