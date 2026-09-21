import Link from 'next/link';
import { AdminRowActions } from '@/components/business/admin/AdminDataTable';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProductCategoryNodeSummary } from '@/lib/product';
import { isRetiredProductCategory } from '@/lib/rules/retired-catalog';
import { Badge } from '@/components/ui/badge';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export function ProductCategoryNodesTable({
  nodes,
  editBase = RULE_CENTER_HREFS.productCategories,
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
          <TableHead className="text-right">产品资料</TableHead>
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
              className={!node.isActive ? 'text-muted-foreground' : undefined}
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
                <div className="flex flex-wrap gap-1">
                  <ActiveStatusBadge active={node.isActive} />
                  {isRetiredProductCategory(node) ? (
                    <Badge variant="secondary">历史 / 已退役</Badge>
                  ) : null}
                </div>
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
