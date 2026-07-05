'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InventoryCountMaterialRow } from '@/lib/inventory-count';
import { MATERIAL_CATEGORY_LABELS } from '@/lib/material-labels';

type ApiResponse = {
  materials: InventoryCountMaterialRow[];
};

function decimal(value: string | null): string {
  return value === null || value === '' ? '-' : value;
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,10}(\.\d{0,2})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function diffTone(diff: number): 'outline' | 'secondary' | 'destructive' {
  if (diff === 0) return 'secondary';
  return diff > 0 ? 'outline' : 'destructive';
}

export function InventoryCountClient() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [rows, setRows] = useState<InventoryCountMaterialRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchRows = (q: string) => {
    startTransition(async () => {
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        params.set('limit', '80');
        const res = await fetch(`/api/admin/inventory-count/materials?${params}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`库存盘点数据读取失败（${res.status}）`);
        }
        const data = (await res.json()) as ApiResponse;
        setRows(data.materials);
      } catch (err) {
        setError(err instanceof Error ? err.message : '库存盘点数据读取失败');
      }
    });
  };

  useEffect(() => {
    fetchRows('');
  }, []);

  const totals = useMemo(() => {
    let changed = 0;
    let surplus = 0;
    let shortage = 0;
    for (const row of rows) {
      const counted = parseDecimal(counts[row.id] ?? '');
      if (counted === null) continue;
      const current = Number(row.currentStock);
      const diff = counted - current;
      if (diff === 0) continue;
      changed += 1;
      if (diff > 0) surplus += diff;
      else shortage += Math.abs(diff);
    }
    return {
      changed,
      surplus: surplus.toFixed(2),
      shortage: shortage.toFixed(2),
    };
  }, [counts, rows]);

  return (
    <section className="space-y-4">
      <form
        className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query);
          fetchRows(query);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索物料编码、名称、规格、拼音"
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            搜索
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => fetchRows(submittedQuery)}
          >
            <RefreshCw aria-hidden className="size-4" />
            刷新
          </Button>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-3">
        <Summary label="已录差异物料" value={`${totals.changed}`} />
        <Summary label="盘盈合计" value={totals.surplus} />
        <Summary label="盘亏合计" value={totals.shortage} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">分类</th>
              <th className="px-4 py-3">库位库存</th>
              <th className="px-4 py-3 text-right">账面库存</th>
              <th className="px-4 py-3 text-right">实盘数</th>
              <th className="px-4 py-3 text-right">差异</th>
            </tr>
          </thead>
          <tbody>
            {isPending && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  正在读取库存...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  暂无匹配物料。
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const countedRaw = counts[row.id] ?? '';
                const counted = parseDecimal(countedRaw);
                const current = Number(row.currentStock);
                const diff = counted === null ? null : counted - current;
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.code}
                      </div>
                      {row.specification ? (
                        <div className="text-xs text-muted-foreground">
                          {row.specification}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={row.isActive ? 'outline' : 'secondary'}>
                        {MATERIAL_CATEGORY_LABELS[row.category]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {row.locations.length === 0 ? (
                        <span className="text-muted-foreground">无库位记录</span>
                      ) : (
                        <ul className="space-y-1">
                          {row.locations.map((location) => (
                            <li key={location.id} className="text-xs">
                              {location.warehouseName} / {location.locationName}
                              <span className="ml-2 font-mono">
                                {decimal(location.currentStock)} {row.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono text-xs">
                      {decimal(row.currentStock)} {row.unit}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <Input
                        inputMode="decimal"
                        value={countedRaw}
                        onChange={(event) =>
                          setCounts((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        className="ml-auto w-28 text-right font-mono text-xs"
                        aria-label={`${row.name} 实盘数`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {diff === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <Badge variant={diffTone(diff)}>
                          {diff > 0 ? '+' : ''}
                          {diff.toFixed(2)} {row.unit}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}
