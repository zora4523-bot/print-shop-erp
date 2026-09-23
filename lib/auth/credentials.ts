import 'server-only';

import { randomBytes } from 'node:crypto';
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

// Must match the cost every stored hash is written with (lib/account.ts,
// actions/account.ts, prisma/seed.ts all hash with 10) so a miss costs the
// same bcrypt work as a real compare.
const DUMMY_HASH_COST = 10;
let dummyPasswordHash: Promise<string> | undefined;

/** Created once per process on the first miss; its plaintext is never kept. */
function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= bcrypt.hash(randomBytes(16).toString('hex'), DUMMY_HASH_COST);
  return dummyPasswordHash;
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
  // Always pay one bcrypt compare, even for a missing or inactive account, so
  // response time does not reveal which usernames exist and can sign in.
  const ok = await bcrypt.compare(password, user?.password ?? (await getDummyPasswordHash()));
  if (!user || !user.isActive || !ok) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workerType: user.workerType,
    machineType: user.machineType,
  };
}
