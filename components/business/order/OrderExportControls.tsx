'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import { requestOrderExportAction, type OrderExportActionResult } from '@/actions/order-export';
import { OrderExportStatus } from '@/generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { cn } from '@/lib/utils';

export type OrderExportView = {
  id: string;
  status: OrderExportStatus;
  scope: 'all' | 'filtered';
  fileName: string;
  matchedOrderCount: number;
  byteSize: string | null;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
};

export function OrderExportControls({
  params,
  filteredTotal,
  hasFilters,
  filteredRequestKey,
  allRequestKey,
  recent,
}: {
  params: Record<string, string>;
  filteredTotal: number;
  hasFilters: boolean;
  filteredRequestKey: string;
  allRequestKey: string;
  recent: readonly OrderExportView[];
}) {
  const router = useRouter();
  const hasPending = recent.some((item) => item.status === OrderExportStatus.PENDING);
  const readyCount = recent.filter(
    (item) => item.status === OrderExportStatus.READY,
  ).length;

  // 轮询把状态从「生成中」改成「已生成」并插入下载按钮，视觉上很明显，
  // 但读屏器用户全程无感知——DOM 变了没人告诉他们。用一个**常驻**的
  // live region 播报（live region 必须先于内容存在于 DOM，条件挂载的
  // 播报不出来），只在 pending → 完成的那一刻写入文案。
  const wasPendingRef = useRef(hasPending);
  const [liveMessage, setLiveMessage] = useState('');
  useEffect(() => {
    if (wasPendingRef.current && !hasPending && readyCount > 0) {
      setLiveMessage('导出已生成，可以下载。');
    }
    wasPendingRef.current = hasPending;
  }, [hasPending, readyCount]);

  useEffect(() => {
    if (!hasPending) return;
    const interval = window.setInterval(() => router.refresh(), 3_000);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 120_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [hasPending, router]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="min-h-11 lg:min-h-8"
          />
        }
      >
        <FileSpreadsheet aria-hidden="true" />
        导出工单
        {hasPending ? (
          <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-xs text-warning-foreground">
            生成中
          </span>
        ) : null}
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={false}
        className="min-w-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:max-w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            导出工单
          </SheetTitle>
          <SheetDescription>
            由独立重任务生成多工作表 XLSX，不会占用当前页面的 SSR
            进程。文件 24 小时后过期。
          </SheetDescription>
        </SheetHeader>
        <SheetClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="关闭导出工单"
              className="absolute right-3 top-3 min-h-11 min-w-11 lg:min-h-7 lg:min-w-7"
            />
          }
        >
          <X aria-hidden="true" />
        </SheetClose>

        <div className="min-w-0 space-y-4 px-4 pb-6">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            {hasFilters ? (
              <ExportRequestForm
                scope="filtered"
                requestKey={filteredRequestKey}
                params={params}
                label={`导出筛选结果（${filteredTotal} 条）`}
              />
            ) : null}
            <ExportRequestForm
              scope="all"
              requestKey={allRequestKey}
              params={{}}
              label="导出全部工单"
              variant={hasFilters ? 'outline' : 'default'}
            />
          </div>

          {recent.length > 0 ? (
            <div className="min-w-0 border-t pt-4">
              <h3 className="text-sm font-medium">最近导出</h3>
              <ul className="mt-2 space-y-2" aria-label="最近导出记录">
                {recent.map((item) => (
                  <li
                    key={item.id}
                    className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="admin-wrap-anywhere font-medium">
                        {item.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.scope === 'all' ? '全部工单' : '当时筛选结果'} ·{' '}
                        {formatDateTimeShanghai(new Date(item.createdAt))} ·{' '}
                        <ExportStatusText item={item} />
                      </p>
                    </div>
                    {item.status === OrderExportStatus.READY ? (
                      <Link
                        href={`/api/orders/exports/${item.id}`}
                        prefetch={false}
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'min-h-11 shrink-0 lg:min-h-8',
                        )}
                      >
                        <Download aria-hidden="true" />
                        下载
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

function ExportRequestForm({
  scope,
  requestKey,
  params,
  label,
  variant = 'default',
}: {
  scope: 'all' | 'filtered';
  requestKey: string;
  params: Record<string, string>;
  label: string;
  variant?: 'default' | 'outline';
}) {
  const [state, formAction, pending] = useActionState<
    OrderExportActionResult | null,
    FormData
  >(requestOrderExportAction, null);
  return (
    <div className="min-w-0 space-y-1">
      <form action={formAction}>
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="requestKey" value={requestKey} />
        <input type="hidden" name="params" value={JSON.stringify(params)} />
        <Button
          type="submit"
          variant={variant}
          disabled={pending}
          className="min-h-11 w-full whitespace-normal lg:min-h-9 lg:w-auto"
        >
          {pending ? '正在提交…' : label}
        </Button>
      </form>
      {state ? <ActionFeedback state={state} /> : null}
    </div>
  );
}

function ActionFeedback({ state }: { state: OrderExportActionResult }) {
  if (state.status === 'queued') {
    return <p role="status" className="text-xs text-success-foreground">已排队，完成后会出现下载按钮。</p>;
  }
  if (state.status === 'success') {
    return <p role="status" className="text-xs text-success-foreground">导出已生成。</p>;
  }
  return <p role="alert" className="text-xs text-destructive">{state.message}</p>;
}

function ExportStatusText({ item }: { item: OrderExportView }) {
  if (item.status === OrderExportStatus.PENDING) return <>生成中</>;
  if (item.status === OrderExportStatus.FAILED) return <>生成失败，请重新导出</>;
  if (item.status === OrderExportStatus.EXPIRED) return <>已过期</>;
  return <>已生成 {item.matchedOrderCount} 张工单</>;
}
