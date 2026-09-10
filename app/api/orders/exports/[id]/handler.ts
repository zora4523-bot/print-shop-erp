import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import {
  OrderExportFailedError,
  OrderExportNotFoundError,
  OrderExportNotReadyError,
  prepareOrderExportDownload,
} from '@/lib/order/export';


type Context = { params: Promise<{ id: string }> };

export async function handleOrderExportDownload(
  request: NextAuthRequest,
  context: Context,
): Promise<Response> {
  let actor;
  try {
    actor = await requireSessionPermission('order:export:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }

  const { id } = await context.params;
  try {
    const artifact = await prepareOrderExportDownload(id, actor);
    return new Response(
      Readable.toWeb(artifact.stream) as ReadableStream<Uint8Array>,
      {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': attachmentHeader(artifact.fileName),
          'Content-Length': String(artifact.byteLength),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch (error) {
    if (error instanceof OrderExportNotReadyError) {
      return NextResponse.json(
        { error: '导出文件正在生成' },
        { status: 409, headers: { 'Retry-After': '5' } },
      );
    }
    if (error instanceof OrderExportFailedError) {
      return NextResponse.json(
        { error: '导出文件生成失败，请重新导出' },
        { status: 410 },
      );
    }
    if (error instanceof OrderExportNotFoundError) {
      return NextResponse.json(
        { error: '导出文件不存在或已过期' },
        { status: 404 },
      );
    }
    throw error;
  }
}


function attachmentHeader(fileName: string): string {
  const ascii = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'orders.xlsx';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
