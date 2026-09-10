import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import {
  buildPieceworkWorkbook,
  loadPieceworkExportData,
  PieceworkExportError,
} from '@/lib/salary/piecework-xlsx';


export async function handlePieceworkExportGet(request: NextAuthRequest) {
  try {
    await requireSessionPermission('salary:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
  const params = new URL(request.url).searchParams;
  const date = params.get('date');
  const from = params.get('from') ?? date ?? '';
  const to = params.get('to') ?? date ?? from;
  const workerId = params.get('workerId')?.trim() || undefined;

  try {
    const rows = await loadPieceworkExportData({ from, to, workerId });
    const workbook = await buildPieceworkWorkbook(rows);
    const filename = `piecework-${from}-${to}.xlsx`;
    return new Response(new Uint8Array(workbook), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(workbook.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof PieceworkExportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
