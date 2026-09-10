import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import {
  buildPieceworkSettlementWorkbook,
  loadPieceworkSettlementExportData,
  PieceworkSettlementExportError,
} from '@/lib/salary/piecework-settlement-xlsx';


export async function handlePieceworkSettlementExportGet(request: NextAuthRequest): Promise<Response> {
  try {
    await requireSessionPermission('salary:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: '无权导出计件结算，请使用有权限的账号登录' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    throw error;
  }
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? from;
  const workerId = url.searchParams.get('workerId')?.trim() || undefined;
  try {
    const rows = await loadPieceworkSettlementExportData({
      from,
      to,
      workerId,
    });
    const workbook = await buildPieceworkSettlementWorkbook(rows);
    const filename = `piecework-settlements-${from}-${to}.xlsx`;
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof PieceworkSettlementExportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
