import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import type { ProductListRow } from '@/lib/product';
import { isRetiredProductCategory } from '@/lib/rules/retired-catalog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProductReferenceImpact } from './ProductReferenceImpact';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

function businessText(value: string, fallback: string): string {
  return externalPriceBusinessText(value) || fallback;
}

export function ProductsTable({
  products,
  editBase = RULE_CENTER_HREFS.productReferences,
  label = '产品资料列表',
  categoryHeading = '产品结构',
}: {
  products: ProductListRow[];
  editBase?: string;
  label?: string;
  categoryHeading?: string;
}) {
  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden xl:table-cell">编码</TableHead>
          <TableHead>{categoryHeading}</TableHead>
          <TableHead>产品名称</TableHead>
          <TableHead>规格</TableHead>
          <TableHead>纸张</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>引用影响</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow
            key={p.id}
            className={!p.isActive ? 'bg-muted/30' : undefined}
          >
            <TableCell className="hidden font-sans tabular-nums text-xs xl:table-cell">
              {p.code ?? '—'}
            </TableCell>
            <TableCell>
              {businessText(p.categoryNode.name, '未命名分类')}
            </TableCell>
            <TableCell>{businessText(p.name, '未命名产品')}</TableCell>
            <TableCell className="text-muted-foreground">
              {p.specification
                ? businessText(p.specification, '未标注规格')
                : '—'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {p.paperType
                ? businessText(p.paperType, '未标注纸张')
                : '—'}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {p.isActive ? (
                  <Badge variant="outline">启用</Badge>
                ) : (
                  <Badge variant="secondary">停用</Badge>
                )}
                {isRetiredProductCategory(p.categoryNode) ? (
                  <Badge variant="secondary">历史 / 已退役</Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <ProductReferenceImpact
                impact={p.referenceImpact}
                variant="compact"
              />
            </TableCell>
            <TableCell>
              <Link
                href={`${editBase}/${p.id}`}
                prefetch={false}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                编辑
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
