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
import { EmptyState } from '@/components/ui-business';

function workerDetail(a: AccountSummary): string {
  if (a.role !== Role.WORKER) return '—';
  const wt = workerTypeLabel(a.workerType);
  const machine = machineTypeLabel(a.machineType);
  return machine ? `${wt} · ${machine}` : wt || '—';
}

function AccountStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="outline">活跃</Badge>
  ) : (
    <Badge variant="secondary">停用</Badge>
  );
}

export function AccountsTable({
  accounts,
  hasFilters = false,
}: {
  accounts: AccountSummary[];
  hasFilters?: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <EmptyState kind={hasFilters ? 'no-result' : 'no-data'} noun="账号" />
    );
  }

  return (
    <>
      <ul aria-label="账号列表" className="grid gap-3 lg:hidden">
        {accounts.map((a) => {
          const detail = workerDetail(a);
          return (
            <li
              key={a.id}
              className="min-w-0 rounded-xl border bg-card p-3 shadow-sm"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">用户名</p>
                  <p className="admin-wrap-anywhere mt-0.5 font-mono text-sm font-semibold">
                    {a.username}
                  </p>
                </div>
                <div className="shrink-0">
                  <AccountStatusBadge isActive={a.isActive} />
                </div>
              </div>

              <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs text-muted-foreground">姓名</dt>
                  <dd className="admin-wrap-anywhere mt-0.5 font-medium">
                    {a.displayName}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">角色</dt>
                  <dd className="admin-wrap-anywhere mt-0.5">{roleLabel(a.role)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">岗位 / 工序</dt>
                  <dd className="admin-wrap-anywhere mt-0.5">{detail}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">电话</dt>
                  <dd className="admin-wrap-anywhere mt-0.5">{a.phone ?? '—'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">创建于</dt>
                  <dd className="mt-0.5">{formatDateShanghai(a.createdAt)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex justify-end border-t pt-2">
                <Link
                  href={`/owner/accounts/${a.id}`}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
                >
                  编辑账号
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden lg:block">
        <Table label="账号列表" className="min-w-[71rem] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">用户名</TableHead>
              <TableHead className="w-56">姓名</TableHead>
              <TableHead className="w-28">角色</TableHead>
              <TableHead className="w-36">岗位 / 工序</TableHead>
              <TableHead className="w-36">电话</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead className="w-28">创建于</TableHead>
              <TableHead className="w-24">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const detail = workerDetail(a);
              return (
                <TableRow
                  key={a.id}
                  className={!a.isActive ? 'opacity-60' : undefined}
                >
                  <TableCell className="font-mono">
                    <span className="block truncate" title={a.username}>
                      {a.username}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate" title={a.displayName}>
                      {a.displayName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate" title={roleLabel(a.role)}>
                      {roleLabel(a.role)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block truncate" title={detail}>
                      {detail}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block truncate" title={a.phone ?? undefined}>
                      {a.phone ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge isActive={a.isActive} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateShanghai(a.createdAt)}
                  </TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
