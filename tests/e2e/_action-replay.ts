import type { Request } from '@playwright/test';

/** Detached replay responses must not feed React's dev debug stream belonging
 * to the live browser request. Business payload, action identity and cookies
 * remain identical. Next generates a unique debug request ID per real action. */
export function detachedActionHeaders(request: Request) {
  const headers = { ...request.headers() };
  delete headers['x-nextjs-request-id'];
  delete headers['x-nextjs-html-request-id'];
  return headers;
}
