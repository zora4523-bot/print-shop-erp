import Link from 'next/link';
import type { OrderMaterialUsageEstimate as Estimate } from '@/lib/bom';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { TableScrollArea } from '@/components/ui-business';

function sourceLabel(source: Estimate['items'][number]['source']): string {
  if (source === 'BLANK') return '纸张规格物料清单';
  if (source === 'PRODUCT') return '产品物料清单';
  if (source === 'CATEGORY') return '分类物料清单';
  return '未匹配';
}

export function OrderMaterialUsageEstimate({
  estimate,
  canManageBom = false,
  headingLevel = 2,
}: {
  estimate: Estimate;
  canManageBom?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div>
        <Heading className="text-base font-semibold">物料用量估算</Heading>
      </div>

      {canManageBom && estimate.items.some((item) => !item.bom) ? (
        <Link href="/owner/boms" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
          维护用料清单
        </Link>
      ) : null}

      {estimate.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无款式用量记录。
        </p>
      ) : (
        <div className="space-y-4">
          <TableScrollArea label="工单物料用量估算">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">款式</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">物料清单</th>
                  <th className="py-2 pr-3">物料</th>
                </tr>
              </thead>
              <tbody>
                {estimate.items.map((item) => (
                  <tr key={item.orderItemId} className="border-b last:border-0">
                    <td className="py-3 pr-3 align-top">
                      #{item.sequence} · {externalPriceBusinessText(item.itemName)}
                      <div className="font-sans tabular-nums text-xs text-muted-foreground">
                        数量 {item.quantity}
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-top">{sourceLabel(item.source)}</td>
                    <td className="py-3 pr-3 align-top">
                      {item.bom ? (
                        <>
                          {externalPriceBusinessText(item.bom.name)}
                          <div className="font-sans tabular-nums text-xs text-muted-foreground">
                            v{item.bom.version} / 基准 {item.bom.baseQuantity}
                          </div>
                        </>
                      ) : (
                        <span className={item.issue ? 'text-destructive' : 'text-muted-foreground'}>
                          {item.issue ?? '尚未配置物料清单'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      {item.materials.length === 0 ? (
                        <span className="text-muted-foreground">{item.issue ? '未估算' : '暂无物料'}</span>
                      ) : (
                        <ul className="space-y-1">
                          {item.materials.map((material) => (
                            <li key={material.materialId}>
                              {material.code} · {externalPriceBusinessText(material.name)}
                              <span className="ml-2 font-sans tabular-nums text-xs">
                                {material.quantity} {material.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>

          {estimate.totals.length > 0 ? (
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 text-sm font-medium">
                {estimate.items.some((item) => item.source === 'NONE') ? '已估算款式汇总' : '汇总'}
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {estimate.totals.map((material) => (
                  <div
                    key={material.materialId}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span>
                      {material.code} · {externalPriceBusinessText(material.name)}
                    </span>
                    <span className="font-sans tabular-nums text-xs">
                      {material.quantity} {material.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
