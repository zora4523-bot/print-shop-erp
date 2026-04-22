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
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/auth|favicon.ico|login|.*\\..*).*)',
  ],
};
