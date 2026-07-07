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

function targetLabel(bom: BomSummary): string {
  if (bom.product) {
    return `${bom.product.code ? `${bom.product.code} · ` : ''}${bom.product.name}`;
  }
  if (bom.categoryNode) return `分类 · ${bom.categoryNode.name}`;
  return '—';
}

export function BomsTable({ boms }: { boms: BomSummary[] }) {
  if (boms.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无 BOM。</p>;
  }

  return (
    <Table>
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
            <TableCell>{bom.name}</TableCell>
            <TableCell className="text-muted-foreground">{targetLabel(bom)}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              v{bom.version}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {bom.baseQuantity}
            </TableCell>
            <TableCell className="text-right">{bom.items.length}</TableCell>
            <TableCell>
              <Badge variant={bom.isActive ? 'outline' : 'secondary'}>
                {bom.isActive ? '启用' : '停用'}
              </Badge>
            </TableCell>
            <TableCell>
              <Link
                href={`/owner/boms/${bom.id}`}
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
