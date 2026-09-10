import type { OrderMaterialUsageEstimate as Estimate } from '@/lib/bom';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { TableScrollArea } from '@/components/ui-business';

function sourceLabel(source: Estimate['items'][number]['source']): string {
  if (source === 'PRODUCT') return '产品 BOM';
  if (source === 'CATEGORY') return '分类 BOM';
  return '未匹配';
}

export function OrderMaterialUsageEstimate({
  estimate,
}: {
  estimate: Estimate;
}) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold">物料用量估算</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          仅按当前启用 BOM 估算，不自动扣减库存；生产发料流程另行确认。
        </p>
      </div>

      {estimate.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          款式未关联产品，无法匹配 BOM。
        </p>
      ) : (
        <div className="space-y-4">
          <TableScrollArea label="工单物料用量估算">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">款式</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">BOM</th>
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
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      {item.materials.length === 0 ? (
                        <span className="text-muted-foreground">无匹配物料</span>
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
              <h3 className="mb-3 text-sm font-medium">汇总</h3>
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
