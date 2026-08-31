import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { BomSummary } from '@/lib/bom';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

function targetLabel(
  bom: BomSummary,
  categoryLabelById: Record<string, string>,
): string {
  if (bom.product) {
    return `${bom.product.code ? `${bom.product.code} · ` : ''}${externalPriceBusinessText(bom.product.name)}`;
  }
  if (bom.categoryNode) {
    // 名称链（"定制 / 平面烫金"）消歧跨父级重名的分类
    const label =
      categoryLabelById[bom.categoryNode.id] ?? bom.categoryNode.name;
    return `分类 · ${externalPriceBusinessText(label)}`;
  }
  return '—';
}

export function BomsTable({
  boms,
  categoryLabelById,
}: {
  boms: BomSummary[];
  categoryLabelById: Record<string, string>;
}) {
  if (boms.length === 0) {
    return null;
  }

  return (
    <Table label="BOM 列表">
      <TableHeader>
        <TableRow>
          <TableHead>BOM</TableHead>
          <TableHead>目标</TableHead>
          <TableHead className="text-right">版本</TableHead>
          <TableHead className="text-right">基准产量</TableHead>
          <TableHead className="text-right">物料行</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {boms.map((bom) => (
          <TableRow key={bom.id} className={!bom.isActive ? 'opacity-60' : undefined}>
            <TableCell>{externalPriceBusinessText(bom.name)}</TableCell>
            <TableCell className="text-muted-foreground">
              {targetLabel(bom, categoryLabelById)}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              v{bom.version}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {bom.baseQuantity}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums">{bom._count.items}</TableCell>
            <TableCell>
              <Badge variant={bom.isActive ? 'outline' : 'secondary'}>
                {bom.isActive ? '启用' : '停用'}
              </Badge>
            </TableCell>
            <TableCell>
              <Link
                href={`/owner/boms/${bom.id}`}
                prefetch={false}
                className="text-sm text-primary underline hover:no-underline"
              >
                查看
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
