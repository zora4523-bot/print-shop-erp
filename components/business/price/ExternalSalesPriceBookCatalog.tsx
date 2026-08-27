import { TriangleAlert } from 'lucide-react';
import { AdminTableCard } from '@/components/business/admin/AdminDataTable';
import { Badge } from '@/components/ui/badge';
import { EmptyState, TableScrollArea } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import type { CustomerPriceBookCatalog } from '@/lib/price/customer-price-book';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from './external-price-display';

export type ExternalSalesPriceBookCatalogProps = {
  catalog: CustomerPriceBookCatalog | null;
  perspective?: 'sales' | 'admin';
};

function formatEffectiveDate(value: Date | string | null | undefined): string {
  if (!value) return '长期';
  if (typeof value === 'string') return value;
  return formatDateShanghai(value);
}

function itemSubject(
  item: CustomerPriceBookCatalog['categories'][number]['items'][number],
): string[] {
  return [
    ...new Set(
      [item.product, item.specification, item.paper]
        .filter((value): value is string => Boolean(value))
        .map(externalPriceBusinessText)
        .filter(Boolean),
    ),
  ];
}

function catalogWarning(warning: string): string {
  return externalPriceBusinessText(warning)
    .replace(/第\s*\d+\s*行/g, '项目')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function ExternalSalesPriceBookCatalog({
  catalog,
  perspective = 'sales',
}: ExternalSalesPriceBookCatalogProps) {
  if (!catalog) {
    return (
      <EmptyState
        title="暂无生效报价"
        description="请联系管理员。"
      />
    );
  }

  const itemCount = catalog.categories.reduce(
    (total, category) => total + category.items.length,
    0,
  );

  return (
    <div className="min-w-0 space-y-6">
      {perspective === 'admin' ? (
        <section
          aria-labelledby="price-book-source-heading"
          className="rounded-xl border bg-card p-4 shadow-sm"
        >
          <h2 id="price-book-source-heading" className="text-base font-semibold">
            当前生效版本
          </h2>
          <div className="mt-3 flex min-w-0 flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4">
            <p className="admin-wrap-anywhere font-medium">
              {externalPriceBusinessText(catalog.name)}
            </p>
            <p className="font-sans tabular-nums text-muted-foreground">
              版本 v{catalog.version}
            </p>
            <p className="font-sans tabular-nums text-muted-foreground">
              {formatEffectiveDate(catalog.effectiveFrom)} →{' '}
              {formatEffectiveDate(catalog.effectiveTo)}
            </p>
          </div>
        </section>
      ) : null}

      {catalog.warnings.length > 0 ? (
        <section
          aria-labelledby="price-book-warnings-heading"
          className="rounded-xl border bg-muted/30 p-4"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <div className="min-w-0">
              <h2 id="price-book-warnings-heading" className="font-semibold">
                {perspective === 'admin'
                  ? '需要人工确认的情况'
                  : '这些情况必须联系管理员确认'}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {catalog.warnings.map((warning) => (
                  <li key={warning} className="admin-wrap-anywhere">
                    {catalogWarning(warning)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {itemCount === 0 ? (
        <EmptyState
          title="暂无可用报价"
          description="请联系管理员。"
        />
      ) : (
        catalog.categories.map((category) => (
          <section key={category.code} className="min-w-0 space-y-3">
            <div>
              <h2 className="text-base font-semibold">{category.name}</h2>
              {category.description ? (
                <p className="mt-1 admin-wrap-anywhere text-sm text-muted-foreground">
                  {category.description}
                </p>
              ) : null}
            </div>
            <AdminTableCard
              isEmpty={category.items.length === 0}
              emptyTitle={`暂无${category.name}报价`}
            >
              {category.items.length > 0 ? (
                <TableScrollArea label={`${category.name}报价明细`}>
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left">
                          收费项目
                        </th>
                        <th scope="col" className="px-3 py-2 text-left">
                          产品 / 规格 / 纸张
                        </th>
                        <th scope="col" className="px-3 py-2 text-left">
                          计价方式
                        </th>
                        <th scope="col" className="px-3 py-2 text-left">
                          数量范围
                        </th>
                        <th scope="col" className="px-3 py-2 text-right">
                          金额
                        </th>
                        <th scope="col" className="px-3 py-2 text-left">
                          处理方式
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {category.items.map((item) => {
                        const subjects = itemSubject(item);
                        return (
                          <tr key={item.code} className="align-top">
                            <td className="max-w-64 px-3 py-3 whitespace-normal">
                              <div className="admin-wrap-anywhere font-medium">
                                {externalPriceRuleDisplayName(item.name)}
                              </div>
                            </td>
                            <td className="max-w-72 px-3 py-3 whitespace-normal">
                              {subjects.length > 0 ? (
                                <ul className="space-y-1">
                                  {subjects.map((subject) => (
                                    <li key={subject} className="admin-wrap-anywhere">
                                      {subject}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-muted-foreground">通用收费项</span>
                              )}
                            </td>
                            <td className="max-w-52 px-3 py-3 whitespace-normal">
                              <span className="admin-wrap-anywhere">
                                {item.calculationLabel}
                              </span>
                            </td>
                            <td className="max-w-56 px-3 py-3 whitespace-normal">
                              <span className="admin-wrap-anywhere">
                                {item.quantityRangeLabel}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-sans font-medium tabular-nums whitespace-nowrap">
                              {item.amountLabel}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <Badge
                                variant={
                                  item.automation === 'AUTO'
                                    ? 'secondary'
                                    : 'destructive'
                                }
                              >
                                {item.automation === 'AUTO'
                                  ? '自动计价'
                                  : '需人工确认'}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScrollArea>
              ) : null}
            </AdminTableCard>
          </section>
        ))
      )}
    </div>
  );
}
