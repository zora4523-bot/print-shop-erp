import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminRowActions,
  AdminSortLink,
} from '@/components/business/admin/AdminDataTable';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MATERIAL_CATEGORY_LABELS,
  type MaterialListSortKey,
  type MaterialSummary,
} from '@/lib/material';
import type { SortDirection, TableHrefParams } from '@/lib/admin/table';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type Props = {
  materials: MaterialSummary[];
  editBase:
    | '/owner/materials'
    | '/foreman/materials'
    | '/owner/rules/papers';
  tableBase?: string;
  queryParams?: TableHrefParams;
  sort?: MaterialListSortKey;
  direction?: SortDirection;
};

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function businessText(value: string, fallback: string): string {
  return externalPriceBusinessText(value) || fallback;
}

function SortHead({
  field,
  label,
  align = 'left',
  tableBase,
  queryParams,
  sort,
  direction,
}: {
  field: MaterialListSortKey;
  label: React.ReactNode;
  align?: 'left' | 'right';
  tableBase: string | undefined;
  queryParams: TableHrefParams;
  sort: MaterialListSortKey;
  direction: SortDirection;
}) {
  const content = tableBase ? (
    <AdminSortLink
      basePath={tableBase}
      field={field}
      label={label}
      currentSort={sort}
      currentDirection={direction}
      queryParams={queryParams}
      className={align === 'right' ? 'justify-end' : undefined}
    />
  ) : (
    label
  );

  return <TableHead className={align === 'right' ? 'text-right' : undefined}>{content}</TableHead>;
}

export function MaterialsTable({
  materials,
  editBase,
  tableBase,
  queryParams = {},
  sort = 'default',
  direction = 'asc',
}: Props) {
  return (
    <Table label="物料库存列表">
      <TableHeader>
        <TableRow>
          <SortHead
            field="code"
            label="编码"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <SortHead
            field="name"
            label="物料"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <SortHead
            field="category"
            label="分类"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <TableHead>规格</TableHead>
          <TableHead>单位</TableHead>
          <SortHead
            field="currentStock"
            label="库存"
            align="right"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <TableHead className="text-right">安全库存</TableHead>
          <TableHead className="text-right">参考平均成本</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((m) => (
          <TableRow
            key={m.id}
            className={!m.isActive ? 'text-muted-foreground' : undefined}
          >
            <TableCell className="font-sans tabular-nums text-xs">{m.code}</TableCell>
            <TableCell>
              {businessText(
                m.name,
                m.category === 'PAPER' ? '未命名纸张' : '未命名物料',
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {MATERIAL_CATEGORY_LABELS[m.category] ?? '未识别分类'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {m.specification
                ? businessText(m.specification, '未标注规格')
                : '—'}
            </TableCell>
            <TableCell>{m.unit}</TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {decimal(m.currentStock)}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {decimal(m.safetyStock)}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {decimal(m.averageCost)}
            </TableCell>
            <TableCell>
              <ActiveStatusBadge active={m.isActive} />
            </TableCell>
            <TableCell>
              <AdminRowActions>
                <Link
                  href={`${editBase}/${m.id}`}
                  prefetch={false}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  编辑
                </Link>
              </AdminRowActions>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
