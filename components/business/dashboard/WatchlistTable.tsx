import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Generic watchlist table for the owner dashboard. Each Slice B list
// (待发货 / 超期外协 / 即将结算客服周期) has its own column shape and
// row data, but the chrome — title + description + empty fallback +
// header / body / hint footer — is the same. Centralising it keeps
// /owner/page.tsx readable and makes future extension (e.g. a "view
// all →" link) one place to edit.
//
// columns: header label + cell renderer keyed off the row. Cell return
// type is React.ReactNode so callers can mix Badge / formatted dates /
// plain text freely.

export type WatchlistColumn<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string; // applied to TableCell only (TableHead inherits)
  align?: 'left' | 'right' | 'center';
};

export type WatchlistTableProps<T> = {
  title: string;
  description?: string;
  columns: readonly WatchlistColumn<T>[];
  rows: readonly T[];
  emptyText: string;
  // Optional footer (e.g. "+N more — 查看全部"). Renders inside the
  // section but outside the table.
  footer?: React.ReactNode;
  rowKey: (row: T) => string;
  // Optional `data-slot` override so E2E can target a specific
  // watchlist (default is the same on all 3 — fine for "exists at
  // all" assertions).
  slot?: string;
};

export function WatchlistTable<T>({
  title,
  description,
  columns,
  rows,
  emptyText,
  footer,
  rowKey,
  slot = 'dashboard-watchlist',
}: WatchlistTableProps<T>) {
  return (
    <section
      data-slot={slot}
      className="rounded-xl border bg-card shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        // 用 title 当地标名：owner 首页同时渲染 4 个 WatchlistTable，
        // 全叫「数据表格」的话读屏器的地标列表分不出谁是谁。
        <Table label={title}>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={rowKey(r)}>
                {columns.map((c, i) => (
                  <TableCell
                    key={i}
                    className={cn(
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {footer ? (
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
