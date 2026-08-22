import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfigEdge } from '@/lib/auth/config.edge';

// Keep the request-layer auth bundle free of Prisma and bcryptjs. Secure
// authorization checks still live in the data-access and action layers.
const { auth } = NextAuth(authConfigEdge);

export default auth((req) => {
  if (req.auth) return NextResponse.next();

  // /login is excluded by the matcher. Preserve the requested pathname so a
  // successful login can send the user back to the page they intended to open.
  const url = new URL('/login', req.url);
  const { pathname } = req.nextUrl;
  if (pathname !== '/') {
    url.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(url);
});

// Public API routes below enforce their own authentication or intentionally
// expose a minimal health/download surface; avoid turning their responses into
// session redirects.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/auth|api/cron|api/cdr|api/health|favicon.ico|login|.*\\..*).*)',
  ],
};
