import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import { buildPrintHtml } from '@/lib/order/print-html';
import { renderHtmlToPdf } from '@/lib/pdf/render';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
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
    // API routes don't go through the page-redirect middleware; return
    // JSON 401 so a failed download is an obvious error in the
    // download manager / devtools instead of a silent empty file.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const jobId = await enqueueOrderPdfJob({
      orderId: id,
      actor: { id: session.user.id, role: session.user.role },
      baseUrl,
    });
    const result = await waitForOrderPdfJob(jobId, {
      timeoutMs: Number(process.env.PDF_JOB_WAIT_MS) || 120_000,
      signal: _req.signal,
    });
    if (result.status === 'timeout') {
      return NextResponse.json(
        { error: 'PDF 生成仍在排队', jobId },
        { status: 202, headers: { 'Retry-After': '5' } },
      );
    }
    if (result.status === 'failed') {
      return NextResponse.json(
        { error: 'PDF 生成失败', errorCode: result.errorCode },
        { status: 500 },
      );
    }
    try {
      pdf = await readAndDeletePdfArtifact(result.artifactName);
    } catch {
      return NextResponse.json(
        { error: 'PDF 产物不可用，请重试', errorCode: 'ArtifactUnavailable' },
        { status: 500 },
      );
    }
  } else {
    try {
      const html = await buildPrintHtml(order);
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

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': buildAttachmentHeader(`${order.orderNo}.pdf`),
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

// RFC 5987 / 6266: ship an ASCII fallback for legacy clients and the
// UTF-8 spelling via filename*= for anything modern. orderNo is ASCII
// today (YYYYMMDD-XXXX) but the factory name prefix might leak into
// future naming, and the extra header is cheap.
function buildAttachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
