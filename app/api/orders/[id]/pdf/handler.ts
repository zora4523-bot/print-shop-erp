import { PERMISSIONS } from '@/lib/auth/permissions-dict';
import { pdfFailure, pdfRetryUrl, pdfStatusResponse, type PdfStatus } from '@/lib/pdf/status-response';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { requireVerifiedSession } from '@/lib/auth/session';
import { UnauthorizedError } from '@/lib/auth/errors';
import { getOrderForPrint } from '@/lib/order/print-view';
import { derivePublicBaseUrl } from '@/lib/public-base-url';
import {
  buildOrderPdfFilename,
  buildPrintHtml,
} from '@/lib/order/print-html';
import { renderDirectOrderPdf } from '@/lib/pdf/direct';
import { orderPdfSnapshotKey } from '@/lib/pdf/order-snapshot';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { getSetting } from '@/lib/settings';
import {
  enqueueOrderPdfJob,
  readPdfArtifact,
  waitForOrderPdfJob,
} from '@/lib/background-jobs/pdf';

// Node runtime: Puppeteer needs it (spawns Chromium).
// Single downloads use bounded direct rendering/cache; legacy job links retain
// their authorized queue path. Every response rechecks access and full content.

type Params = { params: Promise<{ id: string }> };

export async function handleOrderPdfGet(_req: NextAuthRequest, ctx: Params): Promise<Response> {
  let session;
  try {
    session = await requireVerifiedSession(_req.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: '未登录或登录状态已失效，请重新登录' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    throw error;
  }
  const requestUrl = new URL(_req.url);
  const view = requestUrl.searchParams.get('view');
  const statuses = requestUrl.searchParams.getAll('status');
  if (statuses.length > 1 || (statuses.length === 1 && (statuses[0] !== '1' || !requestUrl.searchParams.get('jobId') || backgroundJobsMode() !== 'durable'))) {
    return NextResponse.json({ error: 'Invalid PDF status query' }, { status: 400 });
  }
  if ((view !== null && view !== 'inline') || requestUrl.searchParams.getAll('view').length > 1) {
    return NextResponse.json({ error: 'Invalid PDF view' }, { status: 400 });
  }
  const modes = requestUrl.searchParams.getAll('mode');
  const mode = modes[0] ?? 'order';
  if (modes.length > 1 || mode !== 'order') {
    return NextResponse.json({ error: 'Invalid print mode' }, { status: 400 });
  }
  const { id } = await ctx.params;
  const statusOnly = statuses.length === 1;
  const pdfStatusPage = (input: PdfStatus) => pdfStatusResponse(input, { orderId: id, json: statusOnly, operator: PERMISSIONS['ops:jobs:manage'].some((role) => role === session.user.role) });
  const baseUrl = await derivePublicBaseUrl();
  const order = await getOrderForPrint(
    id,
    { id: session.user.id, role: session.user.role },
    baseUrl,
  );
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { name: factoryName } = await getSetting('factory_name');
  const snapshotKey = orderPdfSnapshotKey(order, factoryName);
  const requestedJobId = requestUrl.searchParams.get('jobId');
  if (requestUrl.searchParams.getAll('jobId').length > 1 || (requestedJobId !== null && (!/^[A-Za-z0-9_-]{1,64}$/.test(requestedJobId) || backgroundJobsMode() !== 'durable'))) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }
  const renderMode = process.env.PDF_ORDER_MODE || 'direct';
  if (!['direct', 'queued'].includes(renderMode)) {
    return pdfStatusPage({ title: 'PDF 生成服务暂不可用', message: '打印配置异常，请联系管理员；也可以使用网页打印。', code: 'PDF_CONFIGURATION_INVALID', status: 503, retryUrl: pdfRetryUrl(_req.url) });
  }
  let pdf: Buffer;
  if (requestedJobId !== null || (renderMode === 'queued' && backgroundJobsMode() === 'durable')) {
    const jobId =
      requestedJobId ??
      (await enqueueOrderPdfJob({
        orderId: id,
        expectedWorkOrderVersion: order.workOrderVersion,
        actor: { id: session.user.id, role: session.user.role },
        baseUrl,
        ...(requestUrl.searchParams.get('regenerate') === '1' ? { regenerationKey: randomUUID() } : {}),
        snapshotKey,
      }));
    const result = await waitForOrderPdfJob(jobId, {
      timeoutMs: statusOnly ? 1_000 : Number(process.env.PDF_JOB_WAIT_MS) || 10_000,
      signal: _req.signal,
      expected: {
        orderId: id,
        actorId: session.user.id,
        actorRole: session.user.role,
        workOrderVersion: order.workOrderVersion,
        snapshotKey,
      },
    });
    if (result.status === 'unavailable' || result.status === 'delayed') {
      return pdfStatusPage({
        title: result.status === 'unavailable' ? 'PDF 生成服务暂不可用' : 'PDF 等待时间较长',
        message: result.status === 'unavailable'
          ? 'PDF 生成服务未就绪。可以使用网页打印，或联系管理员恢复服务后重试。'
          : '已暂停自动查询，请稍后重试以查看生成结果。',
        code: result.status === 'unavailable' ? 'PDF_WORKER_UNAVAILABLE' : 'PDF_QUEUE_DELAYED',
        status: 503,
        retryUrl: pdfRetryUrl(_req.url, jobId),
      });
    }
    if (result.status === 'timeout') {
      return pdfStatusPage({
        title: result.phase === 'running' ? 'PDF 正在生成' : 'PDF 正在排队',
        message: result.phase === 'running' ? '正在生成当前工单，本页会自动查询结果。' : '任务已进入队列，本页会自动查询结果。',
        status: 202,
        retryUrl: pdfRetryUrl(_req.url, jobId),
      });
    }
    if (result.status === 'failed') {
      return pdfStatusPage({
        title: 'PDF 生成失败',
        ...pdfFailure(result.errorCode),
        status: 500,
        retryUrl: pdfRetryUrl(_req.url),
      });
    }
    try {
      pdf = await readPdfArtifact(result.artifactName);
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
      pdf = await renderDirectOrderPdf({
        orderId: id, actorId: session.user.id, actorRole: session.user.role, snapshotKey, baseUrl,
        html: () => buildPrintHtml(order, { factoryName }), signal: _req.signal,
        regenerate: requestUrl.searchParams.get('regenerate') === '1',
      });
    } catch (error) {
      // Log a fixed event only: renderer exceptions can contain paths, URLs and secrets.
      if (_req.signal.aborted) return new Response(null, { status: 499, headers: { 'Cache-Control': 'private, no-store' } });
      console.error('[order-pdf] PDF_GENERATION_FAILED');
      return pdfStatusPage({
        title: 'PDF 生成失败',
        ...pdfFailure(error instanceof Error ? error.name : null),
        status: error instanceof Error && error.name === 'PdfBusyError' ? 503 : 500,
        retryUrl: pdfRetryUrl(_req.url),
      });
    }
  }

  try {
    const currentSession = await requireVerifiedSession(_req.auth);
    if (currentSession.user.id !== session.user.id || currentSession.user.role !== session.user.role) {
      throw new UnauthorizedError();
    }
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    return NextResponse.json({ error: '未登录或登录状态已失效，请重新登录' }, {
      status: 401, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const currentOrder = await getOrderForPrint(
    id,
    { id: session.user.id, role: session.user.role },
    baseUrl,
  );
  if (!currentOrder) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { name: currentFactoryName } = await getSetting('factory_name');
  if (currentOrder.workOrderVersion !== order.workOrderVersion || orderPdfSnapshotKey(currentOrder, currentFactoryName) !== snapshotKey) {
    return pdfStatusPage({
      title: '工单内容已更新',
      message: '生成期间工单内容已更新，请重新生成当前内容。',
      status: 409,
      retryUrl: pdfRetryUrl(_req.url),
    });
  }

  if (statusOnly) {
    return NextResponse.json({ state: 'ready' }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': buildAttachmentHeader(buildOrderPdfFilename(order)).replace(/^attachment/, view === 'inline' ? 'inline' : 'attachment'),
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
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
