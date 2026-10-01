import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { exportSalesBillItems, exportSalesBillList, SalesBillExportInputError, SalesBillExportNotFoundError } from '@/lib/agent-monthly-billing/sales-export';

export async function handleSalesBillExport(request: NextAuthRequest, billId?: string): Promise<Response> {
  try {
    const actor = await requireSessionPermission('bill:view:self', request.auth);
    const params = new URL(request.url).searchParams;
    const file = billId === undefined ? await exportSalesBillList(actor, params) : await exportSalesBillItems(actor, billId, params);
    return new Response(file.csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof SalesBillExportNotFoundError ? 404 : error instanceof SalesBillExportInputError ? 400 : 503;
    if (status === 503) console.error('[sales-bill-export] request failed', error instanceof Error ? error.name : 'UnknownError');
    const message = status === 401 ? '请重新登录后导出。' : status === 404 ? '账单不存在或无权查看。' : error instanceof SalesBillExportInputError ? error.message : '暂时无法导出，请稍后重试。';
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
