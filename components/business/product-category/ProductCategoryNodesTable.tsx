import Link from 'next/link';
import {
  AdminRowActions,
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
import type { ProductCategoryNodeSummary } from '@/lib/product';

export function ProductCategoryNodesTable({
  nodes,
  editBase = '/owner/product-categories',
}: {
  nodes: ProductCategoryNodeSummary[];
  editBase?: string;
}) {
  return (
    <Table label="产品结构分类">
      <TableHeader>
        <TableRow>
          <TableHead>分类名</TableHead>
          <TableHead className="text-right">排序</TableHead>
          <TableHead className="text-right">报价 SKU</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const depth = Math.max(0, node.path.split('.').length - 2);
          const prefix = depth > 0 ? `${'· '.repeat(depth)}` : '';
          return (
            <TableRow
              key={node.id}
              className={!node.isActive ? 'opacity-60' : undefined}
            >
              <TableCell>
                {prefix}
                {node.name}
              </TableCell>
              <TableCell className="text-right font-sans tabular-nums text-xs">
                {node.sortOrder}
              </TableCell>
              <TableCell className="text-right font-sans tabular-nums text-xs">
                {node._count.products}
              </TableCell>
              <TableCell>
                <AdminStatusBadge active={node.isActive} />
              </TableCell>
              <TableCell>
                <AdminRowActions>
                  <Link
                    href={`${editBase}/${node.id}`}
                    prefetch={false}
                    className="text-sm text-primary underline hover:no-underline"
                  >
                    编辑
                  </Link>
                </AdminRowActions>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
