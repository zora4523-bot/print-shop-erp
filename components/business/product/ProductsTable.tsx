import Link from 'next/link';
import type { ProductListRow, ProductSummary } from '@/lib/product';
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
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

function formatPrice(v: ProductSummary['baseUnitPrice']): string {
  if (v === null || v === undefined) return '—';
  // Prisma's Decimal serializes via toString() to a plain decimal string.
  return String(v);
}

function businessText(value: string, fallback: string): string {
  return externalPriceBusinessText(value) || fallback;
}

export function ProductsTable({
  products,
  editBase = '/owner/products',
  label = '产品字典列表',
  categoryHeading = '分类',
  showInternalPrice = true,
}: {
  products: ProductListRow[];
  editBase?: string;
  label?: string;
  categoryHeading?: string;
  showInternalPrice?: boolean;
}) {
  if (products.length === 0) {
    return null;
  }

  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>编码</TableHead>
          <TableHead>{categoryHeading}</TableHead>
          <TableHead>产品名</TableHead>
          <TableHead>规格</TableHead>
          <TableHead>纸张</TableHead>
          {showInternalPrice ? (
            <TableHead className="text-right">内部/直单基础单价</TableHead>
          ) : null}
          <TableHead className="text-right">起订量</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>被引用</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow
            key={p.id}
            className={!p.isActive ? 'bg-muted/30' : undefined}
          >
            <TableCell className="font-sans tabular-nums text-xs">
              {p.code ?? '—'}
            </TableCell>
            <TableCell>
              {businessText(p.categoryNode.name, '未命名分类')}
            </TableCell>
            <TableCell>{businessText(p.name, '未命名 SKU')}</TableCell>
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
            {showInternalPrice ? (
              <TableCell className="text-right font-sans tabular-nums text-xs">
                {formatPrice(p.baseUnitPrice)}
              </TableCell>
            ) : null}
            <TableCell className="text-right font-sans tabular-nums text-muted-foreground">
              {p.minOrderQty ?? '—'}
            </TableCell>
            <TableCell>
              {p.isActive ? (
                <Badge variant="outline">启用</Badge>
              ) : (
                <Badge variant="secondary">停用</Badge>
              )}
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
                className="text-sm text-primary underline hover:no-underline"
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
