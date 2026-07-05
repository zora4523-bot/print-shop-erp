import Link from 'next/link';
import {
  AdminRowActions,
  AdminSortLink,
  AdminStatusBadge,
} from '@/components/business/admin/AdminDataTable';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatPartyAddress,
  PARTY_TYPE_LABELS,
  type PartyListSortKey,
  type PartySummary,
} from '@/lib/party';
import type { SortDirection, TableHrefParams } from '@/lib/admin/table';

type Props = {
  parties: PartySummary[];
  tableBase?: string;
  queryParams?: TableHrefParams;
  sort?: PartyListSortKey;
  direction?: SortDirection;
};

function SortHead({
  field,
  label,
  tableBase,
  queryParams,
  sort,
  direction,
}: {
  field: PartyListSortKey;
  label: React.ReactNode;
  tableBase: string | undefined;
  queryParams: TableHrefParams;
  sort: PartyListSortKey;
  direction: SortDirection;
}) {
  const content = tableBase ? (
    <AdminSortLink
      basePath={tableBase}
      field={field}
      label={label}
      currentSort={sort}
      currentDirection={direction}
      queryParams={queryParams}
    />
  ) : (
    label
  );

  return <TableHead>{content}</TableHead>;
}

export function PartiesTable({
  parties,
  tableBase,
  queryParams = {},
  sort = 'default',
  direction = 'asc',
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead
            field="code"
            label="编码"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <SortHead
            field="name"
            label="名称"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <SortHead
            field="type"
            label="类型"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <TableHead>联系人</TableHead>
          <TableHead>电话</TableHead>
          <TableHead>默认地址</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {parties.map((party) => (
          <TableRow key={party.id} className={!party.isActive ? 'opacity-60' : undefined}>
            <TableCell className="font-mono text-xs">{party.code}</TableCell>
            <TableCell>
              <div className="font-medium">{party.name}</div>
              {party.shortName ? (
                <div className="text-xs text-muted-foreground">{party.shortName}</div>
              ) : null}
            </TableCell>
            <TableCell>{PARTY_TYPE_LABELS[party.type]}</TableCell>
            <TableCell>{party.primaryContact?.name ?? '—'}</TableCell>
            <TableCell className="font-mono text-xs">
              {party.primaryContact?.phone ?? party.defaultAddress?.receiverPhone ?? '—'}
            </TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">
              {formatPartyAddress(party.defaultAddress) ?? '—'}
            </TableCell>
            <TableCell>
              <AdminStatusBadge active={party.isActive} />
            </TableCell>
            <TableCell>
              <AdminRowActions>
                <Link
                  href={`/owner/parties/${party.id}`}
                  className="text-sm text-primary underline hover:no-underline"
                >
                  编辑
                </Link>
              </AdminRowActions>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
