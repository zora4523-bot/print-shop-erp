'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MutationResult } from '@/lib/admin/action-helpers';
import type { InventoryCountMaterialRow } from '@/lib/inventory-count';
import { MATERIAL_CATEGORY_LABELS } from '@/lib/material-labels';

type ApiResponse = { materials: InventoryCountMaterialRow[] };

type Props = {
  action: (
    prev: MutationResult | null,
    formData: FormData,
  ) => Promise<MutationResult>;
  initialIdempotencyKey: string;
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

export function InventoryCountClient({ action, initialIdempotencyKey }: Props) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [rows, setRows] = useState<InventoryCountMaterialRow[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [fetchPending, startTransition] = useTransition();

  const fetchRows = useCallback((q: string) => {
    startTransition(async () => {
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        params.set('limit', '80');
        const res = await fetch(`/api/admin/inventory-count/materials?${params}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`库存盘点数据读取失败（${res.status}）`);
        const data = (await res.json()) as ApiResponse;
        setRows(data.materials);
      } catch (err) {
        setError(err instanceof Error ? err.message : '库存盘点数据读取失败');
      }
    });
  }, []);

  useEffect(() => {
    fetchRows('');
  }, [fetchRows]);

  const submitCount = useCallback(
    async (prev: MutationResult | null, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.status === 'success') {
        setIdempotencyKey(window.crypto.randomUUID());
        setCounts({});
        setRemark('');
        fetchRows(submittedQuery);
      }
      return result;
    },
    [action, fetchRows, submittedQuery],
  );
  const [state, formAction, actionPending] = useActionState<
    MutationResult | null,
    FormData
  >(submitCount, null);

  const submittedItems = useMemo(
    () =>
      rows.flatMap((row) =>
        row.locations.flatMap((location) => {
          const counted = parseDecimal(counts[`${row.id}:${location.locationId}`] ?? '');
          return counted === null
            ? []
            : [{
                materialId: row.id,
                locationId: location.locationId,
                countedQuantity: counted.toFixed(2),
              }];
        }),
      ),
    [counts, rows],
  );

  const totals = useMemo(() => {
    let changed = 0;
    let surplus = 0;
    let shortage = 0;
    for (const row of rows) {
      for (const location of row.locations) {
        const counted = parseDecimal(
          counts[`${row.id}:${location.locationId}`] ?? '',
        );
        if (counted === null) continue;
        const diff = counted - Number(location.currentStock);
        if (diff === 0) continue;
        changed += 1;
        if (diff > 0) surplus += diff;
        else shortage += Math.abs(diff);
      }
    }
    return {
      changed,
      surplus: surplus.toFixed(2),
      shortage: shortage.toFixed(2),
    };
  }, [counts, rows]);

  const actionErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const actionError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message : null;

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
          <Button type="submit" disabled={fetchPending}>搜索</Button>
          <Button
            type="button"
            variant="outline"
            disabled={fetchPending}
            onClick={() => fetchRows(submittedQuery)}
          >
            <RefreshCw aria-hidden className="size-4" />
            刷新
          </Button>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-3">
        <Summary label="有差异库位" value={`${totals.changed}`} />
        <Summary label="盘盈合计" value={totals.surplus} />
        <Summary label="盘亏合计" value={totals.shortage} />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="items" value={JSON.stringify(submittedItems)} />
        <div
          className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="盘点物料列表"
          tabIndex={0}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">仓库 / 库位</th>
                <th className="px-4 py-3 text-right">账面数</th>
                <th className="px-4 py-3 text-right">实盘数</th>
                <th className="px-4 py-3 text-right">差异</th>
              </tr>
            </thead>
            <tbody>
              {fetchPending && rows.length === 0 ? (
                <EmptyRow text="正在读取库存..." />
              ) : rows.length === 0 ? (
                <EmptyRow text="暂无匹配物料。" />
              ) : (
                rows.flatMap((row) => {
                  if (row.locations.length === 0) {
                    return [
                      <tr key={row.id} className="border-b last:border-0">
                        <MaterialCells row={row} />
                        <td colSpan={4} className="px-4 py-3 text-muted-foreground">
                          无库位库存记录，请先通过收货、调拨或其他入库建立库位。
                        </td>
                      </tr>,
                    ];
                  }
                  return row.locations.map((location, index) => {
                    const key = `${row.id}:${location.locationId}`;
                    const countedRaw = counts[key] ?? '';
                    const counted = parseDecimal(countedRaw);
                    const diff = counted === null
                      ? null
                      : counted - Number(location.currentStock);
                    return (
                      <tr key={key} className="border-b last:border-0">
                        {index === 0 ? <MaterialCells row={row} rowSpan={row.locations.length} /> : null}
                        <td className="px-4 py-3 align-top">
                          <div>{location.warehouseName} / {location.locationName}</div>
                          <div className="font-sans tabular-nums text-xs text-muted-foreground">
                            {location.warehouseCode} / {location.locationCode}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-top font-sans tabular-nums text-xs">
                          {decimal(location.currentStock)} {row.unit}
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <Input
                            inputMode="decimal"
                            value={countedRaw}
                            onChange={(event) => setCounts((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))}
                            className="ml-auto w-28 text-right font-sans tabular-nums text-xs"
                            aria-label={row.locations.length === 1
                              ? `${row.name} 实盘数`
                              : `${row.name} ${location.warehouseName}/${location.locationName} 实盘数`}
                          />
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          {diff === null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <Badge variant={diffTone(diff)}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(2)} {row.unit}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <label htmlFor="inventory-count-remark" className="text-sm font-medium">
                盘点备注（选填）
              </label>
              <Input
                id="inventory-count-remark"
                name="remark"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                disabled={actionPending}
              />
            </div>
            <Button type="submit" disabled={actionPending || submittedItems.length === 0}>
              {actionPending ? '过账中…' : `提交盘点过账（${submittedItems.length} 条）`}
            </Button>
          </div>
          {actionErrors.items?.[0] ? <p className="mt-2 text-sm text-destructive">{actionErrors.items[0]}</p> : null}
          {actionError ? <p className="mt-2 text-sm text-destructive">{actionError}</p> : null}
          {success ? <p className="mt-2 text-sm text-success-foreground">✓ {success}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">
            未录入的库位不会被改动；实盘数为 0 表示该库位全部盘亏。
          </p>
        </div>
      </form>
    </section>
  );
}

function MaterialCells({
  row,
  rowSpan,
}: {
  row: InventoryCountMaterialRow;
  rowSpan?: number;
}) {
  return (
    <>
      <td rowSpan={rowSpan} className="px-4 py-3 align-top">
        <div className="font-medium">{row.name}</div>
        <div className="font-sans tabular-nums text-xs text-muted-foreground">{row.code}</div>
        {row.specification ? <div className="text-xs text-muted-foreground">{row.specification}</div> : null}
      </td>
      <td rowSpan={rowSpan} className="px-4 py-3 align-top">
        <Badge variant={row.isActive ? 'outline' : 'secondary'}>
          {MATERIAL_CATEGORY_LABELS[row.category]}
        </Badge>
      </td>
    </>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{text}</td></tr>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-sans tabular-nums text-lg font-semibold">{value}</div>
    </div>
  );
}
