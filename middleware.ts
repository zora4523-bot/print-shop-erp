// TODO(next16-migration): Next.js 16 deprecates the `middleware.ts` convention
// in favor of `proxy.ts`. Migrate in a dedicated commit (behavior identical).
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfigEdge } from '@/lib/auth/config.edge';

// A separate NextAuth() call on the edge-safe config so middleware doesn't
// pull Prisma / bcryptjs into the edge runtime bundle.
const { auth } = NextAuth(authConfigEdge);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  if (isLoggedIn) {
    // Logged-in users bouncing into /login → send them to the home page.
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  // Not logged in: protected prefixes require auth.
  const url = new URL('/login', req.url);
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
