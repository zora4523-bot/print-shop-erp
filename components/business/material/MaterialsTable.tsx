import Link from 'next/link';
import {
  AdminRowActions,
  AdminSortLink,
  AdminStatusBadge,
} from '@/components/business/admin/AdminDataTable';
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

type Props = {
  materials: MaterialSummary[];
  editBase: '/owner/materials' | '/foreman/materials';
  tableBase?: string;
  queryParams?: TableHrefParams;
  sort?: MaterialListSortKey;
  direction?: SortDirection;
};

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
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
    <Table>
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
          <TableHead className="text-right">平均成本</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((m) => (
          <TableRow key={m.id} className={!m.isActive ? 'opacity-60' : undefined}>
            <TableCell className="font-mono text-xs">{m.code}</TableCell>
            <TableCell>{m.name}</TableCell>
            <TableCell className="text-muted-foreground">
              {MATERIAL_CATEGORY_LABELS[m.category]}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {m.specification ?? '—'}
            </TableCell>
            <TableCell>{m.unit}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {decimal(m.currentStock)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {decimal(m.safetyStock)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {decimal(m.averageCost)}
            </TableCell>
            <TableCell>
              <AdminStatusBadge active={m.isActive} />
            </TableCell>
            <TableCell>
              <AdminRowActions>
                <Link
                  href={`${editBase}/${m.id}`}
                  className="text-sm text-primary underline hover:no-underline"
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
