'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { recordOrderPdfDownloadAction } from '@/actions/order-print-record';
import type { OrderPrintRecordResult } from '@/actions/order-print-record.types';
import { deliverPrintFile } from './print-file-navigation';
import { fetchOrderPdf } from './order-pdf-download';
import { announcePrintRecorded, refreshPageAfterPrint } from './use-refresh-after-print';

/**
 * 工单 PDF 下载（业主 2026-10-22）：在工单页内取文件、记为已打印、交付文件，全程不离开本页。
 *
 * 此前这里是一个指向下载接口的链接，整页跳转过去；生产排队超过接口等待上限时接口改返回 HTML
 * 兜底页，管理员就被留在那张「PDF 已生成」的页面上，还要再点一次返回。
 *
 * 与批量打印的差别只有一处：这里**总是**把取得的文件交给管理员，记录结果单独播报。批量是一次
 * 明确的“印这一批”，没记上就不交付；单张下载也用于查看已发货等不再记打印的工单，扣着文件不给
 * 会把原本可用的下载改坏。没记上时如实说明，并允许只补记录（不再重复下载）。
 */
type RecordOutcome = Extract<OrderPrintRecordResult, { status: 'success' }>['outcome'];

/** 记录结果播报：只说管理员要据此行动的事实。 */
const OUTCOME_NOTICE: Record<RecordOutcome, { warn: boolean; text: string }> = {
  MARKED: { warn: false, text: '已记为已打印。' },
  ALREADY_PRINTED: { warn: false, text: '本版本此前已记为已打印。' },
  STALE: { warn: true, text: '工单内容在下载期间已更新，这份文件未记为已打印，请重新下载当前版本。' },
  NOT_PRINTABLE: { warn: true, text: '当前状态不计打印。' },
};

/** 一次失败交付的重试依据：文件已在管理员手上时只补记录，沿用同一尝试（重放不会重复记录）。 */
type Retry = { attemptId: string; contentKey: string | null; fileName: string };
type State =
  | { status: 'working'; phase: 'fetching' | 'recording' }
  | { status: 'done'; outcome: RecordOutcome; fileName: string }
  | { status: 'failed'; message: string; retry: Retry | null };

export function OrderPdfDownloadButton({ orderId, orderNo, className }: {
  orderId: string;
  orderNo: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const inFlight = useRef(false);
  const fetchAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; fetchAbort.current?.abort(); };
  }, []);

  const run = useCallback((retry?: Retry) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const attemptId = retry?.attemptId ?? crypto.randomUUID();
    const controller = new AbortController();
    fetchAbort.current = controller;
    const show = (next: State) => { if (mounted.current) setState(next); };
    void (async () => {
      try {
        let contentKey = retry?.contentKey ?? null;
        let fileName = retry?.fileName ?? `工单-${orderNo}.pdf`;
        let blob: Blob | null = null;
        if (!retry) {
          show({ status: 'working', phase: 'fetching' });
          const file = await fetchOrderPdf(orderId, controller.signal);
          if (!file.ok) {
            show({ status: 'failed', message: file.message, retry: null });
            return;
          }
          blob = file.blob;
          contentKey = file.contentKey;
          fileName = file.fileName ?? fileName;
        }
        show({ status: 'working', phase: 'recording' });

        let outcome: RecordOutcome | null = null;
        let failure: string | null = null;
        if (!contentKey) {
          failure = '文件缺少内容标识，未能记为已打印';
        } else {
          try {
            const result = await recordOrderPdfDownloadAction({ orderId, contentKey, attemptId });
            if (result.status === 'success') outcome = result.outcome;
            else failure = result.message;
          } catch {
            // 结果未知：可能已记上。保留同一尝试，重试只补记录。
            failure = '打印记录结果未知（网络异常）';
          }
        }

        // 文件总是交付：下载本身是管理员有权做的事，记录成败只决定播报什么。
        if (blob) deliverPrintFile(blob, 'download', null, fileName);

        if (outcome) {
          show({ status: 'done', outcome, fileName });
          if (outcome === 'MARKED') {
            announcePrintRecorded([orderId]);
            if (mounted.current) refreshPageAfterPrint(router);
          }
          return;
        }
        show({
          status: 'failed',
          message: `${blob ? '文件已下载，' : ''}${failure}`,
          retry: { attemptId, contentKey, fileName },
        });
      } finally {
        if (fetchAbort.current === controller) fetchAbort.current = null;
        inFlight.current = false;
      }
    })();
  }, [orderId, orderNo, router]);

  const working = state?.status === 'working';
  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} disabled={working} onClick={() => run()}>
        下载 PDF
      </Button>
      {state ? (
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 [overflow-wrap:anywhere]" data-slot="order-pdf-download">
          {state.status === 'working' ? (
            <>
              <span role="status" className="text-sm">
                {state.phase === 'fetching' ? '正在生成打印文件…' : '正在记为已打印…'}
              </span>
              {state.phase === 'fetching' ? (
                <Button type="button" variant="outline" size="sm" onClick={() => fetchAbort.current?.abort()}>取消</Button>
              ) : null}
            </>
          ) : null}
          {state.status === 'done' ? (
            <span role="status" className={`text-sm${OUTCOME_NOTICE[state.outcome].warn ? ' text-warning' : ''}`}>
              已下载 {state.fileName}。{OUTCOME_NOTICE[state.outcome].text}
            </span>
          ) : null}
          {state.status === 'failed' ? (
            <>
              <span role="alert" className="text-sm text-destructive">{state.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => run(state.retry ?? undefined)}>
                {state.retry ? '重试记录' : '重试下载'}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
