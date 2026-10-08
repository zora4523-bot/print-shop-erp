'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog, FormErrorSummary, FormMessage, TableScrollArea, formMessageA11yProps, type FormErrorSummaryItem } from '@/components/ui-business';
import type { InventoryCountMutationResult } from '@/actions/owner-inventory.types';
import type { InventoryCountMaterialRow } from '@/lib/inventory-count';
import {
  buildSubmittedItems,
  countKey,
  parseCountValue,
  pinDisplayedBookQuantities,
  sameBookQuantity,
  type CountEntry,
} from '@/lib/inventory-count-entries';
import { MATERIAL_CATEGORY_LABELS } from '@/lib/material-labels';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type ApiResponse = { materials: InventoryCountMaterialRow[] };

type Props = {
  action: (
    prev: InventoryCountMutationResult | null,
    formData: FormData,
  ) => Promise<InventoryCountMutationResult>;
  initialIdempotencyKey: string;
  /**
   * 服务端首屏已读出的库位行（与 /api/admin/inventory-count/materials 默认查询一致）。
   * 传入后首帧就有表格，挂载/恢复时仍在后台核对最新库存。
   */
  initialRows?: InventoryCountMaterialRow[];
};

/**
 * 盘点过账的一次性提交授权。理由本身就是 token：只有 L3
 * 确认按钮能 arm，紧接着的第一次 submit 消费它，之后立即失效。
 */
export function createInventoryCountSubmitGate() {
  let armedRemark: string | null = null;

  return {
    arm(reason: string | null): string | null {
      const normalized = reason?.trim() ?? '';
      armedRemark = normalized.length > 0 ? normalized : null;
      return armedRemark;
    },
    consume(): string | null {
      const remark = armedRemark;
      armedRemark = null;
      return remark;
    },
    clear(): void {
      armedRemark = null;
    },
    snapshot(): { armed: boolean; remark: string } {
      return {
        armed: armedRemark !== null,
        remark: armedRemark ?? '',
      };
    },
  };
}

function decimal(value: string | null): string {
  return value === null || value === '' ? '-' : value;
}

function diffTone(diff: number): 'outline' | 'secondary' | 'destructive' {
  if (diff === 0) return 'secondary';
  return diff > 0 ? 'outline' : 'destructive';
}

async function fetchCountMaterials(q: string): Promise<ApiResponse> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('limit', '80');
  const res = await fetch(`/api/admin/inventory-count/materials?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`库存盘点数据读取失败（${res.status}）`);
  return res.json();
}

function useInventoryCountController({ action, initialIdempotencyKey, initialRows }: Props) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const restoredQueryRef = useRef('');
  const [rows, setRows] = useState<InventoryCountMaterialRow[]>(initialRows ?? []);
  // 账面基线在每个库位**首次展示**时钉住，不等到首次录入。
  // 否则操作员数完但还没输入时的一次刷新，会把基线推进到库存变动之后。
  const [bookSnapshots, setBookSnapshots] = useState<Record<string, string>>(
    () => (initialRows ? pinDisplayedBookQuantities({}, initialRows) : {}),
  );
  // 值是 { value, book }；book 从上面的首次展示快照复制，提交时供服务端 CAS。
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const touchedKeys = useRef(new Set<string>());
  const fetchSequence = useRef(0);
  // 服务端点名「账面数已变动、没给你过账」的行，等操作员重新录入就消掉。
  const [staleKeys, setStaleKeys] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [fetchPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const remarkInputRef = useRef<HTMLInputElement>(null);
  const confirmationSubmitDispatchingRef = useRef(false);
  const submitGateRef = useRef<ReturnType<
    typeof createInventoryCountSubmitGate
  > | null>(null);
  if (submitGateRef.current === null) {
    submitGateRef.current = createInventoryCountSubmitGate();
  }
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const fetchRows = useCallback((q: string, restored = false) => {
    const sequence = ++fetchSequence.current;
    startTransition(async () => {
      setError(null);
      try {
        const data = await fetchCountMaterials(q);
        if (sequence !== fetchSequence.current) return;
        setRows(data.materials);
        setBookSnapshots(current => pinDisplayedBookQuantities(
          restored ? Object.fromEntries(Object.entries(current).filter(([key]) => touchedKeys.current.has(key))) : current,
          data.materials,
        ));
      } catch (err) {
        if (sequence === fetchSequence.current) setError(err instanceof Error ? err.message : '库存盘点数据读取失败');
      }
    });
  }, []);

  const invalidatePendingFetch = useCallback(() => { fetchSequence.current++; }, []);
  useEffect(() => {
    fetchRows(restoredQueryRef.current, true);
    return invalidatePendingFetch;
  }, [fetchRows, invalidatePendingFetch]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) fetchRows(submittedQuery, true);
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [fetchRows, submittedQuery]);

  const submitCount = useCallback(
    async (prev: InventoryCountMutationResult | null, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.status === 'success') {
        // 部分过账时 staleKeys 非空：没冲突的行已经入库，被点名的行连同它们
        // 钉住的旧账面数一起作废，操作员必须对着新账面数重数一遍。所以这里
        // 一律整体清空，而不是「保留冲突行的数字、悄悄换个新 book 再提交」
        // ——后者等于把守卫刚拦下的那次提交原样放行。
        setIdempotencyKey(window.crypto.randomUUID());
        setCounts({});
        touchedKeys.current.clear();
        // 一次提交（包括部分过账）结束了当前盘点会话。下次
        // fetch 必须从新账面数重建基线，不能沿用已经过账的快照。
        setBookSnapshots({});
        setStaleKeys(result.staleKeys ?? []);
        fetchRows(submittedQuery);
        return result;
      }
      if (result.status === 'error' && result.staleKeys?.length) {
        // 全量失效：一行都没过账。清掉被点名行的录入（它们的 book 已经过期），
        // 其余录入原样保留。
        // 幂等键刻意不换：这是一次被明确拒绝、已整体回滚的提交，换键只会在
        // 「其实成功了但响应丢了」的情况下多开一张盘点单。
        const stale = new Set(result.staleKeys);
        setCounts((current) => {
          const next = { ...current };
          for (const key of stale) delete next[key];
          return next;
        });
        setBookSnapshots((current) => {
          const next = { ...current };
          for (const key of stale) delete next[key];
          return next;
        });
        setStaleKeys(result.staleKeys);
        fetchRows(submittedQuery);
      }
      return result;
    },
    [action, fetchRows, submittedQuery],
  );
  const [state, formAction, actionPending] = useActionState<
    InventoryCountMutationResult | null,
    FormData
  >(submitCount, null);

  const submittedItems = useMemo(
    () => buildSubmittedItems(rows, counts),
    [counts, rows],
  );

  const totals = useMemo(() => {
    let changed = 0;
    let surplus = 0;
    let shortage = 0;
    for (const row of rows) {
      for (const location of row.locations) {
        const counted = parseCountValue(
          counts[countKey(row.id, location.locationId)]?.value ?? '',
        );
        if (counted === null) continue;
        const key = countKey(row.id, location.locationId);
        const book = bookSnapshots[key] ?? location.currentStock;
        const diff = counted - Number(book);
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
  }, [bookSnapshots, counts, rows]);

  const visibleActionState = actionPending ? null : state;
  const fieldErrors =
    visibleActionState?.status === 'invalid'
      ? visibleActionState.fieldErrors
      : {};
  const itemError = fieldErrors.items?.[0];
  const actionError =
    visibleActionState?.status === 'error'
      ? visibleActionState.message
      : null;
  const successReceipt =
    visibleActionState?.status === 'success'
      ? {
          message: visibleActionState.message ?? '盘点已过账',
          partial: Boolean(visibleActionState.staleKeys?.length),
        }
      : null;
  const summaryErrors = toInventoryCountErrorSummary(fieldErrors);
  const fetchError = fetchPending ? null : error;
  const staleKeySet = useMemo(() => new Set(staleKeys), [staleKeys]);

  function clearSubmissionAuthorization() {
    submitGateRef.current?.clear();
    if (remarkInputRef.current) remarkInputRef.current.value = '';
  }

  function prepareConfirmation() {
    const form = formRef.current;
    clearSubmissionAuthorization();
    if (!form || actionPending) return;

    // 无论是点击触发器还是在输入框内按 Enter，都先走浏览器
    // 约束校验；非法数字不应被当成“未录入”后继续打开确认层。
    if (!form.reportValidity()) return;
    if (submittedItems.length === 0) return;

    setConfirmationOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const authorizedRemark = submitGateRef.current?.consume() ?? null;
    if (authorizedRemark !== null) {
      // requestSubmit() 会同步派发 submit；在 React 捕获 FormData 前
      // 确保审计理由已经写入表单。授权在 consume 后已立即失效。
      if (remarkInputRef.current) {
        remarkInputRef.current.value = authorizedRemark;
      }
      return;
    }

    // 所有普通 submit（包括实盘数输入中的 Enter）都只能打开
    // L3，不得直接调用 Server Action。
    event.preventDefault();
    prepareConfirmation();
  }

  function handleConfirmationOpenChange(nextOpen: boolean) {
    setConfirmationOpen(nextOpen);
    if (!nextOpen) {
      submitGateRef.current?.clear();
      // 确认按钮会先 requestSubmit，随后 AlertDialog 才关闭。该同步
      // 提交窗口内保留 hidden reason，取消 / Escape 则立即清理。
      if (!confirmationSubmitDispatchingRef.current && remarkInputRef.current) {
        remarkInputRef.current.value = '';
      }
    }
  }

  function submitFromConfirmation(reason: string | null) {
    const form = formRef.current;
    if (!form || actionPending || submittedItems.length === 0) {
      clearSubmissionAuthorization();
      return;
    }
    if (!form.reportValidity()) {
      clearSubmissionAuthorization();
      return;
    }

    const authorizedRemark = submitGateRef.current?.arm(reason) ?? null;
    if (authorizedRemark === null) {
      clearSubmissionAuthorization();
      return;
    }
    if (remarkInputRef.current) {
      remarkInputRef.current.value = authorizedRemark;
    }

    confirmationSubmitDispatchingRef.current = true;
    try {
      form.requestSubmit();
    } finally {
      // React 在 submit 事件中同步捕获 FormData。到微任务时已可安全
      // 清除 DOM 镜像，避免之后的 Enter 夹带陈旧理由。
      queueMicrotask(() => {
        confirmationSubmitDispatchingRef.current = false;
        clearSubmissionAuthorization();
      });
    }
  }

  return {
    action,
    query,
    setQuery,
    submittedQuery,
    setSubmittedQuery,
    restoredQueryRef,
    rows,
    bookSnapshots,
    counts,
    setCounts,
    touchedKeys,
    setStaleKeys,
    idempotencyKey,
    fetchPending,
    formRef,
    confirmationTriggerRef,
    remarkInputRef,
    confirmationOpen,
    fetchRows,
    formAction,
    actionPending,
    submittedItems,
    totals,
    itemError,
    actionError,
    successReceipt,
    summaryErrors,
    fetchError,
    staleKeySet,
    prepareConfirmation,
    handleSubmit,
    handleConfirmationOpenChange,
    submitFromConfirmation,
  };
}

function InventoryCountSearch({ model }: { model: ReturnType<typeof useInventoryCountController> }) {
  const { query, setQuery, submittedQuery, setSubmittedQuery, restoredQueryRef, fetchPending, fetchRows } = model;
  return (<>
    <form
      id="inventory-count-search-form"
      aria-busy={fetchPending}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmittedQuery(query);
        restoredQueryRef.current = query;
        fetchRows(query);
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="inventory-count-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索物料编码、名称、规格、拼音"
          aria-label="搜索盘点物料"
          className="pl-8"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={fetchPending} aria-busy={fetchPending}>
          {fetchPending ? '正在读取…' : '搜索'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={fetchPending}
          aria-busy={fetchPending}
          onClick={() => fetchRows(submittedQuery)}
        >
          <RefreshCw
            aria-hidden
            className={fetchPending ? 'size-4 animate-spin' : 'size-4'}
          />
          {fetchPending ? '正在读取…' : '刷新'}
        </Button>
      </div>
    </form>
  </>);
}

export function InventoryCountClient(props: Parameters<typeof useInventoryCountController>[0]) {
  const model = useInventoryCountController(props);
  const {
    rows,
    bookSnapshots,
    counts,
    setCounts,
    touchedKeys,
    setStaleKeys,
    idempotencyKey,
    fetchPending,
    formRef,
    confirmationTriggerRef,
    remarkInputRef,
    confirmationOpen,
    formAction,
    actionPending,
    submittedItems,
    totals,
    itemError,
    actionError,
    successReceipt,
    summaryErrors,
    fetchError,
    staleKeySet,
    prepareConfirmation,
    handleSubmit,
    handleConfirmationOpenChange,
    submitFromConfirmation,
  } = model;
  return (
    <section className="space-y-4">
      <InventoryCountSearch model={model} />

      <div className="grid gap-3 md:grid-cols-3">
        <Summary label="有差异库位" value={`${totals.changed}`} />
        <Summary label="盘盈合计" value={totals.surplus} />
        <Summary label="盘亏合计" value={totals.shortage} />
      </div>

      {fetchError ? (
        <ActionNotice
          tone="error"
          title="盘点物料读取失败"
          description={fetchError}
        />
      ) : null}

      <form
        ref={formRef}
        id="inventory-count-form"
        action={formAction}
        onSubmit={handleSubmit}
        aria-busy={actionPending}
        className="space-y-4"
        data-risk-level="L3"
      >
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="items" value={JSON.stringify(submittedItems)} />
        <input ref={remarkInputRef} type="hidden" name="remark" />
        <FormErrorSummary errors={summaryErrors} />
        <TableScrollArea
          id="inventory-count-items"
          {...(itemError
            ? formMessageA11yProps('inventory-count-items', 'error')
            : {})}
          aria-busy={fetchPending}
          label="盘点物料列表"
          className="rounded-xl border bg-card shadow-sm"
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
                <EmptyRow text="暂无匹配物料" />
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
                    const key = countKey(row.id, location.locationId);
                    const entry = counts[key];
                    const countedRaw = entry?.value ?? '';
                    const counted = parseCountValue(countedRaw);
                    const displayedBook =
                      bookSnapshots[key] ?? location.currentStock;
                    const diff = counted === null
                      ? null
                      : counted - Number(displayedBook);
                    // 首次展示之后账面数又被别人动过：这一行提交上去必被拒，先在
                    // 页面上就说清楚，别让操作员点了提交才知道。
                    const bookDrifted = !sameBookQuantity(
                      displayedBook,
                      location.currentStock,
                    );
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
                          {decimal(displayedBook)} {row.unit}
                          {bookDrifted ? (
                            <div className="text-warning-foreground">
                              当前账面 {location.currentStock}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <Input
                            inputMode="decimal"
                            pattern="\d{1,10}(\.\d{0,2})?"
                            maxLength={13}
                            title="请输入最多 10 位整数、2 位小数的非负数"
                            value={countedRaw}
                            disabled={actionPending}
                            onChange={(event) => {
                              const value = event.target.value;
                              touchedKeys.current.add(key);
                              setCounts((current) => {
                                if (value.trim() === '') {
                                  // 清空只表示这一行尚未录入；盘点会话的首次展示
                                  // 账面快照仍保留，只有提交结束或服务端判定 stale 才重置。
                                  const next = { ...current };
                                  delete next[key];
                                  return next;
                                }
                                return {
                                  ...current,
                                  [key]: {
                                    value,
                                    book:
                                      current[key]?.book ??
                                      bookSnapshots[key] ??
                                      location.currentStock,
                                  },
                                };
                              });
                              setStaleKeys((current) =>
                                current.includes(key)
                                  ? current.filter((item) => item !== key)
                                  : current,
                              );
                            }}
                            className="ml-auto w-28 text-right font-sans tabular-nums text-xs"
                            aria-label={row.locations.length === 1
                              ? `${externalPriceBusinessText(row.name)} 实盘数`
                              : `${externalPriceBusinessText(row.name)} ${location.warehouseName}/${location.locationName} 实盘数`}
                          />
                          {staleKeySet.has(key) ? (
                            <div className="mt-1 text-xs text-warning-foreground">
                              账面数已变动，未过账，请重数
                            </div>
                          ) : null}
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
        </TableScrollArea>
        {itemError ? (
          <FormMessage fieldId="inventory-count-items" tone="error">
            {itemError}
          </FormMessage>
        ) : null}

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Button
            ref={confirmationTriggerRef}
            id="inventory-count-submit-trigger"
            type="button"
            disabled={actionPending || submittedItems.length === 0}
            aria-busy={actionPending}
            aria-haspopup="dialog"
            aria-expanded={confirmationOpen}
            className="min-h-11"
            onClick={prepareConfirmation}
          >
            {actionPending
              ? '正在提交盘点过账…'
              : `核对并提交盘点过账（${submittedItems.length} 条）`}
          </Button>
          <ConfirmActionController level="L3"
            reasonLabel="盘点过账原因"
            reasonPlaceholder="例如：月末例行盘点，复核库位实物后调整"
            open={confirmationOpen}
            onOpenChange={handleConfirmationOpenChange}
            focusReturnRef={confirmationTriggerRef}
            disabled={actionPending || submittedItems.length === 0}
            onConfirm={submitFromConfirmation}>
            <ConfirmActionDialog action={`确认过账 ${submittedItems.length} 个库位？`} changes={[]} consequences={
              submittedItems.length === 0
                ? []
                : [
                  `提交范围：${submittedItems.length} 个库位；有差异 ${totals.changed} 个。`,
                  `页面数值汇总：盘盈 ${totals.surplus}、盘亏 ${totals.shortage}；不同物料单位不可合并比较，以表格逐行差异为准。`,
                  '无冲突的行会更新库位库存并写入盘点流水；实盘数为 0 表示该库位全部盘亏。',
                  '若部分库位的账面数在盘点期间发生变化，那些行不会过账，但其他无冲突行仍可能成功。',
                ]
            } confirmText="确认过账" />
          </ConfirmActionController>
          {submittedItems.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              请至少录入一个库位的实盘数。
            </p>
          ) : null}
          {actionError ? (
            <ActionNotice
              tone="error"
              title="盘点过账失败"
              description={actionError}
              className="mt-3"
            />
          ) : null}
          {successReceipt ? (
            <ActionNotice
              tone={successReceipt.partial ? 'warning' : 'success'}
              title={successReceipt.partial ? '盘点已部分过账' : '盘点已过账'}
              description={successReceipt.message}
              className="mt-3"
            />
          ) : null}
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
        <div className="font-medium">{externalPriceBusinessText(row.name)}</div>
        <div className="font-sans tabular-nums text-xs text-muted-foreground">{row.code}</div>
        {row.specification ? (
          <div className="text-xs text-muted-foreground">
            {externalPriceBusinessText(row.specification)}
          </div>
        ) : null}
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

function toInventoryCountErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  const targets: Record<string, { fieldId: string; label: string }> = {
    idempotencyKey: { fieldId: 'inventory-count-form', label: '盘点请求' },
    items: { fieldId: 'inventory-count-items', label: '盘点明细' },
    // 理由输入位于关闭的确认层内；服务端校验失败后先把操作员带回
    // 触发器，重新打开即可修改，避免错误摘要链接到不可见的 Portal。
    remark: {
      fieldId: 'inventory-count-submit-trigger',
      label: '盘点过账原因',
    },
  };
  return Object.entries(fieldErrors).flatMap(([field, messages]) => {
    const target = targets[field] ?? {
      fieldId: 'inventory-count-form',
      label: field,
    };
    return messages.map((message) => ({ ...target, message }));
  });
}
