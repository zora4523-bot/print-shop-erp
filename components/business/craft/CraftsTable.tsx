import Link from 'next/link';
import type { CraftSummary } from '@/lib/craft';
import { isRetiredCraft } from '@/lib/rules/retired-catalog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export function CraftsTable({
  crafts,
  editBase = RULE_CENTER_HREFS.crafts,
}: {
  crafts: CraftSummary[];
  editBase?: string;
}) {
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
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.isActive ? (
                  <Badge variant="outline">启用</Badge>
                ) : (
                  <Badge variant="secondary">停用</Badge>
                )}
                {isRetiredCraft(c) ? (
                  <Badge variant="secondary">历史 / 已退役</Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Link
                href={`${editBase}/${c.id}`}
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
