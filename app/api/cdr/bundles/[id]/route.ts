import { NextResponse } from 'next/server';
import {
  BundleExpiredError,
  BundleNotFoundError,
  consumeBundle,
} from '@/lib/cdr/bundle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CDR bundle 公开下载入口（SPEC §3.5）。
//
// **不走 session 认证**——业务上 foreman 复制链接发外协模具厂，外协方
// 不可能登录我们系统。安全模型：
//   - bundle.id 是 cuid（~125 bits 熵），URL slug 即 token；猜不到。
//   - 24h 过期（DesignBundle.expiresAt），lib/cdr/bundle.consumeBundle
//     校验。
//   - downloadCount 自增审计；老板 dashboard 看异常活跃 bundle。
//
// middleware.ts matcher 已排除 `api/cron`；本路由 `api/cdr` 默认会被
// session middleware 拦截 → 必须同样加排除（详见 fix 同 commit）。
//
// MVP / OSS 未接入：consumeBundle 返的 zipFileUrl 形如 `mock://bundle/<id>.zip`，
// 这里识别后返 503，提示 "OSS 未配置"。STS SDK 接进来后，把 mock 路径
// 替换为 ossSignGetUrl(zipFileUrl, 60s) → 302 redirect。
//
// Usage（用户在浏览器粘贴）：GET /api/cdr/bundles/<bundleId>

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id || typeof id !== 'string' || id.length > 64) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  let bundle;
  try {
    bundle = await consumeBundle(id);
  } catch (err) {
    if (err instanceof BundleNotFoundError) {
      // 404 而不是 410 —— 攻击者无法区分&ldquo;猜对了 id 但已过期&rdquo;和&ldquo;根本
      // 不存在&rdquo;，降低暴力探测可见性。
      return NextResponse.json({ error: '链接已失效或不存在' }, { status: 404 });
    }
    if (err instanceof BundleExpiredError) {
      return NextResponse.json(
        { error: '链接已过期（24 小时有效）', expiredAt: err.expiredAt.toISOString() },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { error: '下载失败；联系业主' },
      { status: 500 },
    );
  }

  // mock-mode 占位 zipFileUrl 不能真下载；返 503 让外协方知道&ldquo;系统
  // 还没配 OSS&rdquo;，不是&ldquo;链接坏了&rdquo;。
  if (bundle.zipFileUrl.startsWith('mock://')) {
    return NextResponse.json(
      {
        error: 'OSS 未配置；CDR 下载暂不可用，请联系业主',
        mockUrl: bundle.zipFileUrl,
      },
      { status: 503 },
    );
  }

  // Prod 路径：bundle.zipFileUrl 是 OSS 对象 key（或已签 URL）。
  // STS SDK 接入后这里 sign 一个 60s 短 GET URL → 302 redirect。
  // 当前直接 302 到 zipFileUrl（如果 bucket 是 public-read 也能用）；
  // P1 替换。
  return NextResponse.redirect(bundle.zipFileUrl, 302);
}
