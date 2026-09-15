import NextAuth from 'next-auth';
import { NextResponse, type NextRequest, type NextFetchEvent, type NextMiddleware } from 'next/server';
import { authConfigEdge } from '@/lib/auth/config.edge';

// Keep the request-layer auth bundle free of Prisma and bcryptjs. Secure
// authorization checks still live in the data-access and action layers.
const { auth } = NextAuth(authConfigEdge);

function hasValidSession(session: unknown): boolean {
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return false;
  if (!('user' in session) || !('expires' in session)) return false;
  const { user, expires } = session;
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return false;
  if (!('id' in user) || typeof user.id !== 'string' || !user.id.trim()) return false;
  return typeof expires === 'string' && Date.parse(expires) > Date.now();
}

const authenticatedProxy: NextMiddleware = auth((req, _event: NextFetchEvent) => {
  void _event; // Select the middleware overload instead of the route-handler overload.
  // Auth.js can return an error object when configuration fails. Only accept
  // the session shape its JWT/session callbacks produce; database account and
  // permission checks remain in the final route/action layers.
  if (hasValidSession(req.auth)) return NextResponse.next();

  // Keep the same gate for protected APIs, but never redirect downloads to HTML.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: '未登录或登录状态已失效，请重新登录' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  // /login is excluded by the matcher. Preserve the requested path and query so a
  // successful login can send the user back to the page they intended to open.
  const url = new URL('/login', req.url);
  const { pathname, search } = req.nextUrl;
  if (pathname !== '/') {
    url.searchParams.set('from', pathname + search);
  }
  return NextResponse.redirect(url);
});

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await authenticatedProxy(request, event);
  const isPrefetch = (request.method === 'GET' || request.method === 'HEAD') &&
    (request.headers.get('next-router-prefetch') === '1' || request.headers.get('purpose') === 'prefetch');
  if (isPrefetch && response instanceof Response) {
    // Auth.js appends its rolling JWT cookie after the auth callback. A late
    // prefetch must not restore that cookie after logout has cleared it.
    // Authentication still runs; ordinary navigation retains session renewal.
    response.headers.delete('set-cookie');
  }
  return response;
}

// Public API routes below enforce their own authentication or intentionally
// expose a minimal health/download surface; avoid turning their responses into
// session redirects.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/auth|api/cron|api/cdr|api/health|favicon.ico|login|.*\\..*).*)',
  ],
};
