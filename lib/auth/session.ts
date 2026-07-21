import { cache } from 'react';
import { auth } from './config';
import { UnauthorizedError } from './errors';

// Layouts, pages and permission guards often need the same JWT-backed session
// during one React render pass. React cache keeps that verification request-
// scoped, so nested admin layouts do not repeatedly decode the same token.
const readSession = cache(auth);

export async function getSession() {
  return readSession();
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError('未登录');
  return session;
}
