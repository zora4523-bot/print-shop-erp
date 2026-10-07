import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { readHistoricalFinanceFile } from '@/lib/historical-finance/files';

const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };

export async function handleHistoricalFinance(request: NextAuthRequest): Promise<Response> {
  try {
    await requireSessionPermission('report:all', request.auth);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    return new Response('请使用有权查看经营数据的管理员账号登录。', { status: 401, headers: privateHeaders });
  }
  const pathname = new URL(request.url).pathname;
  const match = /^\/historical-finance\/([^/]+)$/.exec(pathname);
  if (!match) return new Response('文件不存在', { status: 404, headers: privateHeaders });
  const file = await readHistoricalFinanceFile(match[1]!);
  if (!file) return new Response('文件不存在', { status: 404, headers: privateHeaders });
  return new Response(file.body, { headers: { ...privateHeaders, 'Content-Type': file.type } });
}
