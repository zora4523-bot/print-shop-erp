import { cache } from 'react';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PageHeader, TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { ToggleBomActiveButton } from '@/components/business/bom/ToggleBomActiveButton';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getBomDetail } from '@/lib/bom';
import {
  categoryChainLabelMap,
  listProductCategoryNodes,
} from '@/lib/product';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function targetLabel(
  bom: Awaited<ReturnType<typeof getBomDetail>>,
): Promise<string> {
  if (!bom) return '—';
  if (bom.product) {
    return `${bom.product.code ? `${bom.product.code} · ` : ''}${externalPriceBusinessText(bom.product.name)}`;
  }
  if (bom.categoryNode) {
    // 名称链消歧跨父级重名的分类
    const nodes = await listProductCategoryNodes();
    const label =
      categoryChainLabelMap(nodes).get(bom.categoryNode.id) ??
      bom.categoryNode.name;
    return `分类 · ${externalPriceBusinessText(label)}`;
  }
  return '—';
}

// 见 owner/products/[id] 里的同名注释：generateMetadata 与页面组件各查
// 一次，React cache() 收敛成一次。刻意包在页面模块而不是 lib/bom.ts ——
// setBomActive() 是「先 getBomDetail 再写」，在 lib 层包会引入同请求内
// 读到陈旧值的隐患。
const loadBom = cache(getBomDetail);

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  // BOM 明细是未分域的管理数据。metadata 必须自己做软权限判断，
  // 不能依赖后续 Page/owner layout 的 redirect。
  const session = await getSession();
  if (!session || !hasPermission('bom:manage', session.user.role)) {
    return { title: 'BOM/用料' };
  }
  const bom = await loadBom(id);
  return {
    title: bom
      ? `${externalPriceBusinessText(bom.name)} · BOM/用料`
      : 'BOM 不存在',
  };
}

export default async function OwnerBomDetailPage({ params, searchParams }: PageProps) {
  await requirePermission('bom:manage');
  const { id } = await params;
  const bom = await loadBom(id);
  if (!bom) notFound();

  const receipt = readReceipt(await searchParams);

  return (
    <div className="space-y-6">
      <ReceiptNotice receipt={receipt} noun="BOM" />
      <PageHeader
        title={externalPriceBusinessText(bom.name)}
        subtitle={`${await targetLabel(bom)} · v${bom.version} · 基准产量 ${bom.baseQuantity}`}
        actions={
          <Badge variant={bom.isActive ? 'outline' : 'secondary'}>
            {bom.isActive ? '启用' : '停用'}
          </Badge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">物料清单</h2>
        <TableScrollArea label="BOM 物料明细">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">物料</th>
                <th className="py-2 pr-3 text-right">基准用量</th>
                <th className="py-2 pr-3">备注</th>
              </tr>
            </thead>
            <tbody>
              {bom.items.length === 0 ? (
                <TableEmptyState
                  colSpan={3}
                  title="暂无物料行"
                  description="这个 BOM 尚未配置用料。"
                />
              ) : (
                bom.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-3 pr-3">
                      {item.material.code} ·{' '}
                      {externalPriceBusinessText(item.material.name)}
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
                ))
              )}
            </tbody>
          </table>
        </TableScrollArea>
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
