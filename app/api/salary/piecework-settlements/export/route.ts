import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import {
  buildPieceworkSettlementWorkbook,
  loadPieceworkSettlementExportData,
  PieceworkSettlementExportError,
} from '@/lib/salary/piecework-settlement-xlsx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await requirePermission('salary:view:all');
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
