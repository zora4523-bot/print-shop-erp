import type { ReporterOperationDetail } from '@/lib/production/operation-portal';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { formatFoilColors } from '@/lib/order/foil-colors';

export function WorkerOperationSources({ sources }: { sources: ReporterOperationDetail['sources'] }) {
  return (
        <section className="min-w-0 space-y-3">
          <h2 className="text-base font-semibold">设计与生产要求</h2>
          {sources.map((source, index) => {
            if (source.item) return (
              <article
                key={source.item.id}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <h3 className="worker-wrap-anywhere min-w-0 font-semibold">
                  #{source.item.sequence} · {source.item.name}
                </h3>
                <p className="worker-wrap-anywhere mt-1 min-w-0 text-sm text-muted-foreground">
                  {source.item.specification
                    ? externalPriceBusinessText(source.item.specification)
                    : '未填规格'}
                  {' · '}
                  {source.item.paperType
                    ? externalPriceBusinessText(source.item.paperType)
                    : '未填纸张'}
                  {' · '}款式数量 {source.item.quantity}
                </p>
                <p className="mt-2 text-sm">正面：{formatFoilColors(source.item.frontFoilColors)}{source.item.backFoilColors.length ? ` · 反面：${formatFoilColors(source.item.backFoilColors)}` : ''}</p>
                {source.item.remark ? (
                  <HighlightedRemark className="mt-3">
                    {source.item.remark}
                  </HighlightedRemark>
                ) : null}
                <DesignImageGallery
                  images={source.item.designs.map((design) => ({
                    ...design,
                    fileUrl: signDesignReadUrl(design.fileUrl),
                  }))}
                />
              </article>
            );
            if (source.packagingGroup) return (
              <article
                key={source.packagingGroup.id}
                className="rounded-xl border bg-card p-4 text-sm shadow-sm"
              >
                <h3 className="font-semibold">
                  包装组 #{source.packagingGroup.sequence}
                  {source.packagingGroup.name
                    ? ` · ${source.packagingGroup.name}`
                    : ''}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  计划 {source.packagingGroup.actualBagCount} 袋
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {source.packagingGroup.lines.map((line) => (
                    <li key={line.orderItem.sequence}>
                      #{line.orderItem.sequence} · {line.orderItem.name} · 每袋 {line.unitsPerBag} 个
                    </li>
                  ))}
                </ul>
              </article>
            );
            return (
              <p key={index} className="text-sm text-muted-foreground">
                来源记录不完整
              </p>
            );
          })}
        </section>
  );
}
