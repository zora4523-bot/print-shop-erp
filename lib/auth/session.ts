import { auth } from './config';
import { UnauthorizedError } from './errors';

export async function getSession() {
  return auth();
}

export async function requireSession() {
  const session = await auth();
  if (!session) throw new UnauthorizedError('未登录');
  return session;
}
