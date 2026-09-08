import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import {
  buildOrderPdfFilename,
  buildPrintHtml,
} from '@/lib/order/print-html';
import { renderHtmlToPdf } from '@/lib/pdf/render';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { getSetting } from '@/lib/settings';
import {
  enqueueOrderPdfJob,
  readAndDeletePdfArtifact,
  waitForOrderPdfJob,
} from '@/lib/background-jobs/pdf';

// Node runtime: Puppeteer needs it (spawns Chromium).
export const runtime = 'nodejs';
// PDFs are per-order, generated on demand. No caching yet — once we
// know what staleness window is acceptable we can turn on
// `export const revalidate = N;` or an ETag.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Params) {
  const session = await getSession();
  if (!session) {
    // API routes excluded from the page-redirect Proxy return
    // JSON 401 so a failed download is an obvious error in the
    // download manager / devtools instead of a silent empty file.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const requestUrl = new URL(_req.url);
  const modes = requestUrl.searchParams.getAll('mode');
  const mode = modes[0] ?? 'order';
  if (modes.length > 1 || (mode !== 'order' && mode !== 'tasks')) {
    return NextResponse.json({ error: 'Invalid print mode' }, { status: 400 });
  }
  const { id } = await ctx.params;
  const baseUrl = await derivePublicBaseUrl();
  const order = await getOrderForPrint(
    id,
    { id: session.user.id, role: session.user.role },
    baseUrl,
  );
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let pdf: Buffer;
  if (backgroundJobsMode() === 'durable') {
    const requestedJobId = new URL(_req.url).searchParams.get('jobId');
    if (requestedJobId && !/^[A-Za-z0-9_-]{1,64}$/.test(requestedJobId)) {
      return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    const jobId =
      requestedJobId ??
      (await enqueueOrderPdfJob({
        orderId: id,
        expectedWorkOrderVersion: order.workOrderVersion,
        actor: { id: session.user.id, role: session.user.role },
        baseUrl,
        mode,
      }));
    const result = await waitForOrderPdfJob(jobId, {
      timeoutMs: Number(process.env.PDF_JOB_WAIT_MS) || 10_000,
      signal: _req.signal,
      expected: {
        orderId: id,
        actorId: session.user.id,
        workOrderVersion: order.workOrderVersion,
        mode,
      },
    });
    if (result.status === 'timeout') {
      return pdfStatusPage({
        title: 'PDF 正在生成',
        message: '任务仍在排队，本页将在 5 秒后自动重试。',
        status: 202,
        retryUrl: pdfRetryUrl(_req.url, jobId),
      });
    }
    if (result.status === 'failed') {
      return pdfStatusPage({
        title: 'PDF 生成失败',
        message: `错误码：${result.errorCode ?? 'UnknownError'}。请点击下方按钮重新生成。`,
        status: 500,
        retryUrl: pdfRetryUrl(_req.url),
      });
    }
    try {
      pdf = await readAndDeletePdfArtifact(result.artifactName);
    } catch {
      return pdfStatusPage({
        title: 'PDF 产物不可用',
        message: '生成结果已过期或被清理，请点击下方按钮重新生成。',
        status: 500,
        retryUrl: pdfRetryUrl(_req.url),
      });
    }
  } else {
    try {
      const { name: factoryName } = await getSetting('factory_name');
      const html = await buildPrintHtml(order, { factoryName, mode });
      pdf = await renderHtmlToPdf({ html });
    } catch (err) {
      // Most likely cause here is Chromium not yet installed on the
      // host (pnpm may skip puppeteer's postinstall). Return a 500 with
      // a hint so the owner knows to run `npx puppeteer browsers install`
      // instead of guessing at the browser side.
      // Puppeteer's "no browser" error wording varies by version: older
      // releases said "Could not find Chromium", current ones say
      // "Could not find Chrome". The SAME error covers two distinct
      // causes — (a) the browser was never downloaded on this host /
      // user, or (b) it WAS downloaded but at a path the runtime can't
      // see (split build/runtime container, different user's
      // ~/.cache/puppeteer, custom PUPPETEER_CACHE_DIR). Steering
      // operators at only (a) hides (b) — the regex fires for both
      // cases now and the hint mentions both .
      const hint =
        err instanceof Error &&
        /Could not find (Chrome|Chromium|browser)/i.test(err.message)
          ? '未找到 Puppeteer 期望的浏览器。两种典型原因：' +
            '(1) 当前用户 / 容器还没下载——跑 `npx puppeteer browsers install chrome`；' +
            '(2) 已下载但路径错配——核对 PUPPETEER_CACHE_DIR 或运行时用户的 ~/.cache/puppeteer 与下载位置是否一致。' +
            '错误正文里 Puppeteer 已经打印了它实际查的路径。'
          : null;
      return NextResponse.json(
        {
          error: 'PDF 生成失败',
          message: err instanceof Error ? err.message : String(err),
          hint,
        },
        { status: 500 },
      );
    }
  }

  const currentOrder = await getOrderForPrint(
    id,
    { id: session.user.id, role: session.user.role },
    baseUrl,
  );
  if (
    !currentOrder ||
    currentOrder.workOrderVersion !== order.workOrderVersion
  ) {
    return pdfStatusPage({
      title: '工单版本已更新',
      message: '生成期间工单已升版，旧 PDF 已丢弃。请重新生成当前版。',
      status: 409,
      retryUrl: pdfRetryUrl(_req.url),
    });
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': buildAttachmentHeader(buildOrderPdfFilename(order, mode)),
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

function pdfRetryUrl(requestUrl: string, jobId?: string): string {
  const url = new URL(requestUrl);
  const mode = url.searchParams.get('mode');
  url.search = '';
  if (mode === 'tasks') url.searchParams.set('mode', mode);
  if (jobId) url.searchParams.set('jobId', jobId);
  return `${url.pathname}${url.search}`;
}

function pdfStatusPage(input: {
  title: string;
  message: string;
  status: number;
  retryUrl: string;
}): Response {
  const retryUrl = escapeHtml(input.retryUrl);
  const autoRefresh = input.status === 202;
  const refreshMeta = autoRefresh
    ? `<meta http-equiv="refresh" content="5;url=${retryUrl}">`
    : '';
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${refreshMeta}<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.5rem;line-height:1.6"><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.message)}</p><p><a href="${retryUrl}">立即重试</a></p></body></html>`,
    {
      status: input.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        ...(autoRefresh
          ? { 'Retry-After': '5', Refresh: `5;url=${input.retryUrl}` }
          : {}),
      },
    },
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

// RFC 5987 / 6266: ship an ASCII fallback for legacy clients and the
// UTF-8 spelling via filename*= for anything modern. orderNo is ASCII
// today (GD-YYMMDD-XXX) but the customer name can contain Chinese, and the
// extra header is cheap.
function buildAttachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
