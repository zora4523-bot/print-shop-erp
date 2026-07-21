import Link from 'next/link';
import type { ProductSummary } from '@/lib/product';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

function formatPrice(v: ProductSummary['baseUnitPrice']): string {
  if (v === null || v === undefined) return '—';
  // Prisma's Decimal serializes via toString() to a plain decimal string.
  return String(v);
}

export function ProductsTable({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无产品</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>编码</TableHead>
          <TableHead>分类</TableHead>
          <TableHead>产品名</TableHead>
          <TableHead>规格</TableHead>
          <TableHead>纸张</TableHead>
          <TableHead className="text-right">单价</TableHead>
          <TableHead className="text-right">起订量</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <TableRow key={p.id} className={!p.isActive ? 'opacity-60' : undefined}>
            <TableCell className="font-sans tabular-nums text-xs">{p.code ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">
              {p.categoryNode.name}
            </TableCell>
            <TableCell>{p.name}</TableCell>
            <TableCell className="text-muted-foreground">{p.specification ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">{p.paperType ?? '—'}</TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {formatPrice(p.baseUnitPrice)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
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
              <Link
                href={`/owner/products/${p.id}`}
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
