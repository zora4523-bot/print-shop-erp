import { NextResponse } from 'next/server';
import { BundleExpiredError, BundleNotFoundError, BundleNotReadyError, consumeBundle } from '@/lib/cdr/bundle';
import { consumeCdrDownloadRateLimit } from '@/lib/cdr/download-rate-limit';
import { signBundleDownloadUrl } from '@/lib/cdr/download-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

// External recipients use a 256-bit bearer token. No session is required;
// database IDs and legacy CUID links never authorize a download.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: token } = await params;
  try {
    if (!(await consumeCdrDownloadRateLimit(req.headers))) {
      return NextResponse.json({ error: '请求过于频繁，请稍后重试' }, {
        status: 429, headers: { ...privateHeaders, 'Retry-After': '1' },
      });
    }
  } catch {
    return NextResponse.json({ error: '下载服务暂不可用，请稍后重试' }, { status: 503, headers: privateHeaders });
  }
  try {
    const bundle = await consumeBundle(token);
    if (bundle.zipFileUrl.startsWith('mock://')) {
      return NextResponse.json({ error: 'CDR 下载暂不可用，请联系管理员' }, { status: 503, headers: privateHeaders });
    }
    return new NextResponse(null, { status: 302, headers: { ...privateHeaders, Location: signBundleDownloadUrl(bundle) } });
  } catch (error) {
    if (error instanceof BundleNotFoundError || error instanceof BundleExpiredError) {
      return NextResponse.json({ error: '链接已失效或不存在，请联系管理员重新生成' }, { status: 404, headers: privateHeaders });
    }
    if (error instanceof BundleNotReadyError) {
      return NextResponse.json({ error: error.status === 'FAILED' ? '下载包生成失败' : '下载包正在生成' }, {
        status: 409, headers: { ...privateHeaders, 'Retry-After': '5' },
      });
    }
    return NextResponse.json({ error: '下载服务暂不可用，请联系管理员' }, { status: 503, headers: privateHeaders });
  }
}
