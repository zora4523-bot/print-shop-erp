import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import {
  AgentMonthlyBillExportFailedError,
  AgentMonthlyBillExportNotFoundError,
  AgentMonthlyBillExportNotReadyError,
  prepareAgentMonthlyBillExportDownload,
} from '@/lib/agent-monthly-billing/export';


type Context = { params: Promise<{ id: string }> };

export async function handleAgentMonthlyBillExportDownload(
  request: NextAuthRequest,
  context: Context,
): Promise<Response> {
  let actor;
  try {
    actor = await requireSessionPermission('bill:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }

  const { id } = await context.params;
  try {
    const artifact = await prepareAgentMonthlyBillExportDownload(id, actor);
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
    if (error instanceof AgentMonthlyBillExportNotReadyError) {
      return NextResponse.json(
        { error: '导出文件正在生成' },
        { status: 409, headers: { 'Retry-After': '5' } },
      );
    }
    if (error instanceof AgentMonthlyBillExportFailedError) {
      return NextResponse.json(
        { error: '导出文件生成失败，请重新导出' },
        { status: 410 },
      );
    }
    if (error instanceof AgentMonthlyBillExportNotFoundError) {
      return NextResponse.json(
        { error: '导出文件不存在或已过期' },
        { status: 404 },
      );
    }
    throw error;
  }
}


function attachmentHeader(fileName: string): string {
  const ascii =
    fileName
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent-monthly-bills.xlsx';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
