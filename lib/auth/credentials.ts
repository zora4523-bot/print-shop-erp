import 'server-only';

import { AuthError, CredentialsSignin } from '@auth/core/errors';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { consumeLoginRateLimit } from './login-rate-limit';
import { loginSchema } from './schemas';

export class LoginRateLimitedError extends CredentialsSignin {
  code = 'rate_limited';
}

/** Keeps the original infrastructure error attached for Auth.js server logs. */
export class LoginRateLimitUnavailableError extends AuthError {
  static type = 'CallbackRouteError';

  constructor(cause: unknown) {
    const error =
      cause instanceof Error ? cause : new Error('login rate limiter unavailable');
    super('login rate limiter unavailable', { cause: { err: error } });
  }
}

export async function authorizeCredentials(
  raw: Partial<Record<'username' | 'password', unknown>>,
  request: Request,
) {
  let allowed: boolean;
  try {
    allowed = await consumeLoginRateLimit(request.headers);
  } catch (error) {
    // Throw an AuthError so Auth.js's raw Server Action path preserves the
    // failure instead of converting it into a credentials mismatch.
    throw new LoginRateLimitUnavailableError(error);
  }
  if (!allowed) throw new LoginRateLimitedError();

  // Invalid form bodies are attempts too, hence validation happens after the
  // token is consumed.
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { username, password } = parsed.data;
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workerType: user.workerType,
    machineType: user.machineType,
  };
}
