// Next.js instrumentation hook — runs once at process boot for the
// Node runtime (Server Components / Server Actions / API routes / Proxy). See:
//   https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Posture: graceful no-op when SENTRY_DSN is unset (dev / pre-prod).
// Once a DSN is configured the SDK initializes lazily so dev workflows
// don't pay the import cost. OTel auto-instrumentation is sketched as
// a structured TODO — the relevant @opentelemetry/* sub-packages are
// not in package.json yet (see README §运维 for the install list).

export async function register() {
  // Skip entirely if no DSN is configured. Dynamically importing
  // @sentry/nextjs is otherwise ~3 MB on cold start; gating saves dev
  // boot time and keeps tests deterministic.
  if (!process.env.SENTRY_DSN) return;

  const Sentry = await import('@sentry/nextjs');
  const release = process.env.APP_VERSION || 'dev';

  // Defense-in-depth header / body / URL-query scrubber. Sentry's
  // captureRequestError + the default RequestData integration would
  // otherwise forward `event.request.headers` (Authorization, Cookie,
  // any custom API keys) and `event.request.data` (Server Action
  // FormData with 薪资金额 / customer refs) to the Sentry server.
  // `sendDefaultPii: false` only gates IP collection (Codex round 65).
  //
  // Three sweep points — each was a separate Codex finding:
  //   - event.request          → minimize to { url=path, method }       (round 65 P1)
  //   - event.spans[*].data    → drop full URLs from sampled spans      (round 67 P2)
  //   - contexts.nextjs.req_path → strip query string                   (round 67 P2)
  // Applied to BOTH beforeSend (exceptions) and beforeSendTransaction
  // (sampled traces, since tracesSampleRate=0.2; round 66 P1).
  function stripQuery(s: string | undefined): string | undefined {
    if (!s) return s;
    try {
      // Parse with dummy base so relative / absolute both work; we keep
      // only .pathname so query / hash / host all drop.
      return new URL(s, 'http://scrubbed.local').pathname;
    } catch {
      // Unparseable — drop rather than forward something unexpected.
      return undefined;
    }
  }

  // Whitelist of span-data keys that don't carry URL / query / header
  // info and are useful for debugging. Anything else (http.url,
  // http.target, http.query, db.statement, etc.) is dropped.
  // Includes BOTH legacy (http.method) and current OTel semantic-
  // conventions (http.request.method) keys — the @sentry/nextjs SDK
  // emits the new form on Node runtimes; allowing only the legacy
  // dropped method entirely (Codex round 68 / P2).
  const SAFE_SPAN_DATA_KEYS = new Set([
    'http.method',
    'http.request.method',
    'http.response.status_code',
    'http.status_code',
    'op',
    'origin',
  ]);

  function scrubEvent<T>(event: T): T {
    // Sentry's ErrorEvent / TransactionEvent share these fields; we
    // mutate via a permissive view so one helper covers both.
    const e = event as unknown as {
      request?: { url?: string; method?: string };
      spans?: Array<{
        description?: string;
        data?: Record<string, unknown>;
      }>;
      contexts?: {
        nextjs?: { request_path?: unknown };
        [k: string]: unknown;
      };
    };

    if (e.request) {
      e.request = {
        url: stripQuery(e.request.url),
        method: e.request.method,
      };
    }

    if (Array.isArray(e.spans)) {
      for (const span of e.spans) {
        const isHttpSpan =
          typeof (span as { op?: unknown }).op === 'string' &&
          ((span as { op: string }).op.startsWith('http.') ||
            (span as { op: string }).op === 'http');
        // ONLY HTTP-flavored span descriptions look like `<METHOD>
        // <URL>` and need the query stripped. Prisma / db spans use
        // raw SQL as description — and SQL legitimately contains `?`
        // (JSONB operators, prepared-statement placeholders); cutting
        // those would corrupt the span name (Codex round 68 / P3).
        if (isHttpSpan && typeof span.description === 'string') {
          const q = span.description.indexOf('?');
          if (q >= 0) span.description = span.description.slice(0, q);
        }
        if (span.data && typeof span.data === 'object') {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(span.data)) {
            if (SAFE_SPAN_DATA_KEYS.has(k)) safe[k] = v;
          }
          span.data = safe;
        }
      }
    }

    if (
      e.contexts?.nextjs &&
      typeof e.contexts.nextjs.request_path === 'string'
    ) {
      e.contexts.nextjs.request_path = stripQuery(
        e.contexts.nextjs.request_path,
      );
    }

    return event;
  }

  const baseInit = {
    dsn: process.env.SENTRY_DSN,
    release,
    // Lower trace sample for high-traffic endpoints once we ship;
    // 0.2 is a starter for pre-launch when we want decent visibility.
    tracesSampleRate: 0.2,
    // Don't surface PII in error scopes by default. Salary amounts /
    // customer refs may end up in messages — keep send-default-pii
    // off and let specific call sites attach context explicitly.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(baseInit);
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime can't load the full Node SDK — @sentry/nextjs
    // routes init() to its edge-safe variant transparently here.
    Sentry.init(baseInit);
  }

  // TODO(p1-otel): wire @opentelemetry/sdk-node + auto-instrumentations
  // once the additional packages are pinned. Need:
  //   @opentelemetry/auto-instrumentations-node
  //   @opentelemetry/resources
  //   @opentelemetry/semantic-conventions
  // Sentry's own OTel tracing covers HTTP routes well enough for MVP; revisit when
  // we want PG span detail or pg_advisory_xact_lock visibility.
}

// Next.js 15+ hook: receives errors from Server Components / Server
// Actions / Route Handlers BEFORE Next surfaces them. Next passes a
// `(err, request, context)` triple where `request` has `{ path,
// method, headers }` and `context` has `{ routerKind, routePath,
// routeType }`.
//
// We forward via `@sentry/nextjs`'s `captureRequestError` rather than
// the bare `captureException` because:
//   1. It awaits the transport flush, so events don't drop on short-
//      lived Edge / Route Handler invocations (Codex round 64 / P1).
//   2. It already knows how to project Next's request shape into a
//      Sentry event with the right route metadata, no manual extras.
//
// Same DSN gating as register() so dev / pre-prod is a true no-op.
export const onRequestError: typeof import('@sentry/nextjs').captureRequestError =
  async (err, request, context) => {
    if (!process.env.SENTRY_DSN) return;
    const Sentry = await import('@sentry/nextjs');
    await Sentry.captureRequestError(err, request, context);
  };
