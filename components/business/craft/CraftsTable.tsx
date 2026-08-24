import Link from 'next/link';
import type { CraftSummary } from '@/lib/craft';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { machineTypeLabel, workerTypeLabel } from '@/lib/auth/role-labels';

export function CraftsTable({ crafts }: { crafts: CraftSummary[] }) {
  if (crafts.length === 0) {
    return null;
  }

  return (
    <Table label="工艺字典列表">
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">排序</TableHead>
          <TableHead>工艺名</TableHead>
          <TableHead>外协</TableHead>
          <TableHead>接单岗位</TableHead>
          <TableHead>默认机器</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {crafts.map((c) => (
          <TableRow key={c.id} className={!c.isActive ? 'opacity-60' : undefined}>
            <TableCell className="text-muted-foreground">{c.sortOrder}</TableCell>
            <TableCell>{c.name}</TableCell>
            <TableCell>
              {c.isOutsource ? (
                <Badge variant="secondary">外协</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {workerTypeLabel(c.defaultWorkerType) || '—'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {machineTypeLabel(c.defaultMachineType) || '—'}
            </TableCell>
            <TableCell>
              {c.isActive ? (
                <Badge variant="outline">启用</Badge>
              ) : (
                <Badge variant="secondary">停用</Badge>
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/owner/crafts/${c.id}`}
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
