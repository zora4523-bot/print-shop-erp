import { notFound } from 'next/navigation';
import { getCraftSummary } from '@/lib/craft';
import { updateCraftAction } from '@/actions/owner-crafts';
import { CraftForm } from '@/components/business/craft/CraftForm';
import { ToggleActiveButton } from '@/components/business/craft/ToggleActiveButton';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const craft = await getCraftSummary(id);
  return {
    title: craft ? `编辑 ${craft.name} · 工艺字典` : '工艺不存在',
  };
}

export default async function EditCraftPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('dict:craft:manage');
  const { id } = await params;
  const craft = await getCraftSummary(id);
  if (!craft) notFound();

  const boundUpdate = updateCraftAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑工艺：{craft.name}</h1>
        <p className="text-sm text-muted-foreground">
          代码 <span className="font-mono">{craft.code}</span>
          {craft.isActive ? ' · 启用' : ' · 停用'}
          {craft.isOutsource ? ' · 外协' : ''}
        </p>
      </div>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        {/*
          Same pattern as accounts edit page — remount on updatedAt so the
          client form resets from fresh server data after a successful save.
        */}
        <CraftForm
          key={`${craft.id}-${craft.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={craft}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {craft.isActive ? '停用工艺' : '启用工艺'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {craft.isActive
            ? '停用后该工艺不再出现在录单页的工艺多选框里；历史工单里已经引用的记录全部保留。没有"最后一条"强制约束 —— 可以全部停用，只是新工单选不到任何工艺。'
            : '启用后该工艺会立刻出现在录单页的多选列表里。'}
        </p>
        <ToggleActiveButton craftId={craft.id} currentlyActive={craft.isActive} />
      </section>
    </div>
  );
}
