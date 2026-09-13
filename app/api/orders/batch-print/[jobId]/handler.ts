import type { NextAuthRequest } from 'next-auth';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { BatchPrintAccessError, BatchPrintSelectionError, batchPrintStatus, downloadBatchPrint } from '@/lib/order/batch-print';

const headers = { 'Cache-Control': 'private, no-store' };

export async function handleBatchPrintGet(req: NextAuthRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireSessionPermission('order:view:all', req.auth);
    const { jobId } = await context.params;
    const url = new URL(req.url);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return Response.json({ error: '请求无效' }, { status: 400, headers });
    const view = url.searchParams.get('view');
    if (view === null) return Response.json(await batchPrintStatus(actor.id, jobId), { headers });
    if (!['inline', 'download'].includes(view) || url.searchParams.getAll('view').length !== 1) {
      return Response.json({ error: '请求无效' }, { status: 400, headers });
    }
    const pdf = await downloadBatchPrint(actor.id, jobId);
    if (!pdf) return Response.json({ error: '打印文件尚未就绪，请返回列表查看结果' }, { status: 409, headers });
    return new Response(new Uint8Array(pdf), { headers: {
      ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `${view === 'inline' ? 'inline' : 'attachment'}; filename="orders-${jobId}.pdf"`,
      'Content-Length': String(pdf.length),
    } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: '请重新登录' }, { status: 401, headers });
    if (error instanceof BatchPrintAccessError) return Response.json({ error: '打印任务不存在或无权访问' }, { status: 404, headers });
    if (error instanceof BatchPrintSelectionError) return Response.json({ error: '工单内容已变化，请返回列表重新选择并生成', issues: error.issues }, { status: 409, headers });
    return Response.json({ error: '打印文件暂不可用，请返回列表重新生成' }, { status: 503, headers });
  }
}
