// TODO(next16-migration): Next.js 16 deprecates the `middleware.ts` convention
// in favor of `proxy.ts`. Migrate in a dedicated commit (behavior identical).
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfigEdge } from '@/lib/auth/config.edge';

// A separate NextAuth() call on the edge-safe config so middleware doesn't
// pull Prisma / bcryptjs into the edge runtime bundle.
const { auth } = NextAuth(authConfigEdge);

export default auth((req) => {
  if (req.auth) return NextResponse.next();

  // /login is excluded by the matcher, so by the time we're here we're a
  // guest on a non-public page — bounce to the login screen and remember
  // where they were headed so we can hop back after a successful login.
  const url = new URL('/login', req.url);
  const { pathname } = req.nextUrl;
  if (pathname !== '/') {
    url.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(url);
});

// Only run on pages the user would land on. Exclude Next.js internals, the
// Auth.js API route itself, static assets, and any file-like paths.
//
// `api/cron` 排除原因：cron 端点已有自己的 Bearer 认证（CRON_SECRET，
// DECISIONS 2026-04-24），不应被 session-based 中间件拦截 redirect
// 到 /login（pre-existing latent bug，P1 #2 Slice D E2E 才 surface
// 出来）。
//
// `api/cdr` 排除原因：CDR bundle 下载路由用 cuid token（DesignBundle.id，
// ~125 bits 熵 + 24h 过期）做无 session 鉴权——业务上外协方拿 URL 下载
// 时不会有我们系统的登录态（SPEC §3.5）。匹配规则同 cron。
//
// `api/health` 排除原因：liveness 探针供 PM2 / Nginx / 监控无 session
// 探活，不应被中间件 redirect 到 /login。
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/auth|api/cron|api/cdr|api/health|favicon.ico|login|.*\\..*).*)',
  ],
};
