'use client';

/**
 * 单张工单 PDF 的取得（业主 2026-10-22「下载 PDF 不跳页、下载即记已打印」）：在工单页内取文件，
 * 排队与失败都当数据读，页面留在原处。单独成模块，组件测试可替换真实网络。
 *
 * 生产是排队模式：接口最多等 `PDF_JOB_WAIT_MS`（默认 10 秒），没等到就返回 202 和带 jobId 的
 * 续查地址。这里沿着续查地址接着等，等同于此前那张 HTML 兜底页自己做的事，只是不替换页面。
 */

/** 整体等待预算，与 HTML 兜底页的 120 秒一致；超出即停止并允许重试。 */
const TOTAL_WAIT_MS = 120_000;
/** 单次请求上限：接口自身最多等 10 秒，留足余量。 */
const REQUEST_TIMEOUT_MS = 60_000;
const PENDING_RETRY_MS = 2_000;
/** 打印服务未就绪时放慢重试，和兜底页同一节奏。 */
const UNAVAILABLE_RETRY_MS = 10_000;

export type FetchedOrderPdf =
  | { ok: true; blob: Blob; contentKey: string | null; fileName: string | null }
  | { ok: false; message: string };

type StatusPayload = {
  state?: unknown;
  message?: unknown;
  code?: unknown;
  retryUrl?: unknown;
  error?: unknown;
};

/** 保留错误码：排查时它比文案有用，原 HTML 兜底页也一直显示（审查 P2-7）。 */
function readMessage(data: StatusPayload | null, fallback: string): string {
  const code = typeof data?.code === 'string' && data.code ? `（错误码：${data.code}）` : '';
  if (typeof data?.error === 'string' && data.error) return `${data.error}${code}`;
  if (typeof data?.message === 'string' && data.message) return `${data.message}${code}`;
  return `${fallback}${code}`;
}

/** 只接受同源的相对续查地址，不跟随响应给出的其他目标。 */
function nextUrl(data: StatusPayload | null): string | null {
  const retry = data?.retryUrl;
  return typeof retry === 'string' && retry.startsWith('/api/orders/') ? retry : null;
}

function parseFileName(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!);
    } catch {
      /* 继续用 ASCII 回退名 */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
}

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }
  signal.addEventListener('abort', onAbort, { once: true });
});

export async function fetchOrderPdf(orderId: string, signal: AbortSignal): Promise<FetchedOrderPdf> {
  let url = `/api/orders/${encodeURIComponent(orderId)}/pdf`;
  const deadline = Date.now() + TOTAL_WAIT_MS;
  try {
    for (;;) {
      const response = await fetch(url, {
        cache: 'no-store',
        // 显式要 JSON：排队与失败拿到可解析的状态，而不是给地址栏看的 HTML 兜底页。
        headers: { Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (response.ok && (response.headers.get('content-type') ?? '').includes('application/pdf')) {
        return {
          ok: true,
          blob: await response.blob(),
          contentKey: response.headers.get('X-Print-Content-Key'),
          fileName: parseFileName(response.headers.get('content-disposition')),
        };
      }
      const data: StatusPayload | null = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: readMessage(data, '登录已失效或无权下载，请重新登录后重试') };
      }
      const next = nextUrl(data);
      // 202 排队 / 生成中；503 里「服务未就绪」与「队列积压」都带着原任务的续查地址，还会有结果，
      // 继续沿着它等——丢掉 jobId 会让重试另起一个任务，白等一轮（审查 P2-3）。
      const recovering = response.status === 503
        && (data?.code === 'PDF_WORKER_UNAVAILABLE' || data?.code === 'PDF_QUEUE_DELAYED')
        && next !== null;
      const waiting = response.status === 202 || recovering;
      if (waiting && next && Date.now() < deadline) {
        await delay(recovering ? UNAVAILABLE_RETRY_MS : PENDING_RETRY_MS, signal);
        url = next;
        continue;
      }
      // 等够了还没结果：服务未就绪时沿用服务端说法，排队则说明已停止等待。
      if (waiting) {
        return recovering
          ? { ok: false, message: readMessage(data, '打印服务未就绪，请稍后重试或改用网页打印') }
          : { ok: false, message: '生成时间较长，已停止等待，可重试或改用网页打印' };
      }
      return { ok: false, message: readMessage(data, '打印文件暂不可用，请重试') };
    }
  } catch (error) {
    if (signal.aborted) return { ok: false, message: '已取消' };
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, message: '取得文件超时，请检查网络后重试' };
    }
    return { ok: false, message: '网络异常，请重试' };
  }
}
