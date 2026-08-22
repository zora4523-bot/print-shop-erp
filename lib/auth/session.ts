import { cache } from 'react';
import type { Session } from 'next-auth';
import { auth } from './config';
import { db } from '@/lib/db';
import { UnauthorizedError } from './errors';

// The JWT is only an optimistic session hint. Accounts may be disabled,
// deleted, or have their role changed while a long-lived token is still in a
// browser. Resolve the current user from the database before treating the
// session as authenticated so sensitive reads and every permission guard use
// current account state.
//
export async function getVerifiedSession(session: Session | null) {
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      workerType: true,
      machineType: true,
      isActive: true,
    },
  });
  if (!user?.isActive) return null;

  return {
    ...session,
    user: {
      ...session.user,
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      workerType: user.workerType,
      machineType: user.machineType,
    },
  };
}

async function readVerifiedSession() {
  return getVerifiedSession(await auth());
}

// React cache scopes both the token decode and primary-key lookup to one
// Server Component render / Server Action request. Route Handlers use the
// NextAuth `auth(handler)` wrapper and pass request.auth to
// requireVerifiedSession() below; calling zero-argument auth() from a plain
// route handler can lose Next's request-bound headers context.
const readCachedSession = cache(readVerifiedSession);

export async function getSession() {
  return readCachedSession();
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError('未登录或登录状态已失效，请重新登录');
  }
  return session;
}

export async function requireVerifiedSession(session: Session | null) {
  const verified = await getVerifiedSession(session);
  if (!verified) {
    throw new UnauthorizedError('未登录或登录状态已失效，请重新登录');
  }
  return verified;
}
