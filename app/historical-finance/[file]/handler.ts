import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { getVerifiedSession } from '@/lib/auth/session';
import { readHistoricalFinanceFile } from '@/lib/historical-finance/files';

const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };

export async function handleHistoricalFinance(request: NextAuthRequest): Promise<Response> {
  const url = new URL(request.url);
  try {
    await requireSessionPermission('report:all', request.auth);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    if (url.pathname === '/historical-finance/index.html') {
      // A valid account without this permission must not bounce between login
      // and this page. Recheck expired, deleted or disabled accounts as well.
      if (!(await getVerifiedSession(request.auth))) {
        const login = new URL('/login', url);
        login.searchParams.set('from', url.pathname + url.search);
        return new Response(null, {
          status: 307,
          headers: { ...privateHeaders, Location: login.toString() },
        });
      }
      return new Response('当前账号无权查看经营数据，请联系管理员开通权限。', {
        status: 403,
        headers: privateHeaders,
      });
    }
    return new Response('请使用有权查看经营数据的管理员账号登录。', { status: 401, headers: privateHeaders });
  }
  const match = /^\/historical-finance\/([^/]+)$/.exec(url.pathname);
  if (!match) return new Response('文件不存在', { status: 404, headers: privateHeaders });
  const file = await readHistoricalFinanceFile(match[1]!);
  if (!file) return new Response('文件不存在', { status: 404, headers: privateHeaders });
  return new Response(file.body, { headers: { ...privateHeaders, 'Content-Type': file.type } });
}
