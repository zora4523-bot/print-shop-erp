import Link from 'next/link';
import { Role } from '../../../generated/prisma/enums';
import type { AccountSummary } from '@/lib/account';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDateShanghai } from '@/lib/format/dates';
import {
  roleLabel,
  workerTypeLabel,
  machineTypeLabel,
} from '@/lib/auth/role-labels';

function workerDetail(a: AccountSummary): string {
  if (a.role !== Role.WORKER) return '—';
  const wt = workerTypeLabel(a.workerType);
  const machines =
    (a.machineCapabilities?.length ?? 0) > 0
      ? a.machineCapabilities.map((machine) => machineTypeLabel(machine))
      : a.machineType
        ? [machineTypeLabel(a.machineType)]
        : [];
  const capabilityText =
    (a.craftCapabilities?.length ?? 0) > 0
      ? ` · ${a.craftCapabilities.length} 项熟练工艺`
      : '';
  return machines.length > 0
    ? `${wt} · ${machines.join(' / ')}${capabilityText}`
    : `${wt || '—'}${capabilityText}`;
}

export function AccountsTable({ accounts }: { accounts: AccountSummary[] }) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">暂无账号</p>
    );
  }

  return (
    <Table label="账号列表">
      <TableHeader>
        <TableRow>
          <TableHead>用户名</TableHead>
          <TableHead>姓名</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>岗位 / 机器 / 熟练工艺</TableHead>
          <TableHead>电话</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>创建于</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((a) => (
          <TableRow key={a.id} className={!a.isActive ? 'opacity-60' : undefined}>
            <TableCell className="font-mono">{a.username}</TableCell>
            <TableCell>{a.displayName}</TableCell>
            <TableCell>{roleLabel(a.role)}</TableCell>
            <TableCell className="text-muted-foreground">{workerDetail(a)}</TableCell>
            <TableCell className="text-muted-foreground">{a.phone ?? '—'}</TableCell>
            <TableCell>
              {a.isActive ? (
                <Badge variant="outline">活跃</Badge>
              ) : (
                <Badge variant="secondary">停用</Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDateShanghai(a.createdAt)}</TableCell>
            <TableCell>
              <Link
                href={`/owner/accounts/${a.id}`}
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
