import { NextResponse } from 'next/server';
import {
  BundleExpiredError,
  BundleNotFoundError,
  BundleNotReadyError,
  consumeBundle,
} from '@/lib/cdr/bundle';
// BundleExpiredError 仍 import 用作 instanceof 判定；UI 文案对外
// 一致返 404，但内部分支保留以便将来加 audit log（&ldquo;有人探到了
// 已过期的 token X 次/小时&rdquo;）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CDR bundle 公开下载入口（SPEC §3.5）。
//
// **不走 session 认证**——业务上 foreman 复制链接发外协模具厂，外协方
// 不可能登录我们系统。安全模型：
//   - 链接即凭证，无 session、无吊销入口。bundle.id 为 cuid v1：
//     时间戳、计数器、进程 fingerprint 可预测/固定；不可猜部分约 41 bits，
//     来自非加密 Math.random()，不能当作密码学随机 token。
//   - 24h 过期（DesignBundle.expiresAt），lib/cdr/bundle.consumeBundle
//     校验。
//   - downloadCount 自增审计；管理员 dashboard 看异常活跃 bundle。
//
// proxy.ts matcher 已排除 `api/cron` 和本路由 `api/cdr`，避免公开下载被
// session Proxy 重定向到登录页。
//
// lib/cdr/zip.ts 为私有 OSS 产物签发与 expiresAt 对齐的预签名 URL。
// consumeBundle 仍可能返回 mock:// 产物；本路由对此返回 503，不开放下载。
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
    if (err instanceof BundleNotReadyError) {
      return NextResponse.json(
        { error: err.status === 'FAILED' ? '下载包生成失败' : '下载包正在生成' },
        { status: 409, headers: { 'Retry-After': '5' } },
      );
    }
    if (
      err instanceof BundleNotFoundError ||
      err instanceof BundleExpiredError
    ) {
      // **404 + 同款文案**——攻击者无法区分&ldquo;猜对了 id 但已过期&rdquo;和
      // &ldquo;根本不存在&rdquo;，降低暴力探测可见性（
      // 之前&ldquo;过期&rdquo;返 410 + expiredAt 字段会泄漏&ldquo;这个 id 曾经有效&rdquo;）。
      // 业务上对外协方信息一致：&ldquo;链接已失效或不存在，请联系管理员
      // 重新生成&rdquo;。
      return NextResponse.json(
        { error: '链接已失效或不存在' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: '下载失败；请联系管理员' },
      { status: 500 },
    );
  }

  // mock-mode 占位 zipFileUrl 不能真下载；返 503 让外协方知道&ldquo;系统
  // 还没配 OSS&rdquo;，不是&ldquo;链接坏了&rdquo;。
  if (bundle.zipFileUrl.startsWith('mock://')) {
    return NextResponse.json(
      { error: 'CDR 下载暂不可用，请联系管理员' },
      { status: 503 },
    );
  }

  // Prod 路径：bundle.zipFileUrl 是 OSS 对象 key（或已签 URL）。
  // STS SDK 接入后这里 sign 一个 60s 短 GET URL → 302 redirect。
  // 当前直接 302 到 zipFileUrl（如果 bucket 是 public-read 也能用）；
  // P1 替换。
  return NextResponse.redirect(bundle.zipFileUrl, 302);
}
