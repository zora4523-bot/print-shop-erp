import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui-business';
import { ToggleBomActiveButton } from '@/components/business/bom/ToggleBomActiveButton';
import { requirePermission } from '@/lib/auth/permissions';
import { getBomDetail } from '@/lib/bom';
import {
  categoryChainLabelMap,
  listProductCategoryNodes,
} from '@/lib/product';

type PageProps = { params: Promise<{ id: string }> };

async function targetLabel(
  bom: Awaited<ReturnType<typeof getBomDetail>>,
): Promise<string> {
  if (!bom) return '—';
  if (bom.product) {
    return `${bom.product.code ? `${bom.product.code} · ` : ''}${bom.product.name}`;
  }
  if (bom.categoryNode) {
    // 名称链消歧跨父级重名的分类
    const nodes = await listProductCategoryNodes();
    const label =
      categoryChainLabelMap(nodes).get(bom.categoryNode.id) ??
      bom.categoryNode.name;
    return `分类 · ${label}`;
  }
  return '—';
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const bom = await getBomDetail(id);
  return { title: bom ? `${bom.name} · BOM/用料` : 'BOM 不存在' };
}

export default async function OwnerBomDetailPage({ params }: PageProps) {
  await requirePermission('bom:manage');
  const { id } = await params;
  const bom = await getBomDetail(id);
  if (!bom) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={bom.name}
        subtitle={`${await targetLabel(bom)} · v${bom.version} · 基准产量 ${bom.baseQuantity}`}
        actions={
          <Badge variant={bom.isActive ? 'outline' : 'secondary'}>
            {bom.isActive ? '启用' : '停用'}
          </Badge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">物料清单</h2>
        {bom.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无物料行。</p>
        ) : (
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="BOM 物料明细"
            tabIndex={0}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">物料</th>
                  <th className="py-2 pr-3 text-right">基准用量</th>
                  <th className="py-2 pr-3">备注</th>
                </tr>
              </thead>
              <tbody>
                {bom.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-3 pr-3">
                      {item.material.code} · {item.material.name}
                      {!item.material.isActive ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          已停用
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-right font-sans tabular-nums text-xs">
                      {String(item.quantity)} {item.material.unit}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {item.remark ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {bom.isActive ? '停用 BOM' : '启用 BOM'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          启用时会检查同一产品或分类是否已有启用 BOM；停用后不会用于新估算。
        </p>
        <ToggleBomActiveButton bomId={bom.id} currentlyActive={bom.isActive} />
      </section>
    </div>
  );
}
