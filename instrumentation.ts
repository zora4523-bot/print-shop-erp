// Next.js instrumentation hook — runs once at process boot in BOTH the
// Node runtime (Server Components / Server Actions / API routes) and
// the Edge runtime (middleware). See:
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

  // Defense-in-depth header / body scrubber. Sentry's
  // captureRequestError + the default RequestData integration would
  // otherwise forward `event.request.headers` (Authorization, Cookie,
  // any custom API keys) and `event.request.data` (which can include
  // 薪资金额 / customer refs in Server Action payloads) to the Sentry
  // server. `sendDefaultPii: false` does NOT gate this — it only gates
  // IP collection (Codex round 65 / P1).
  //
  // We strip aggressively before send: keep ONLY pathname + method —
  // url query strings can carry reset tokens / signed URL params /
  // customer ids (Codex round 66 / P2), so we strip them too. Also
  // applied to transaction events (Codex round 66 / P1) since
  // tracesSampleRate=0.2 means sampled spans flow through
  // beforeSendTransaction with the same RequestData attached.
  function scrubRequest<T extends { request?: { url?: string; method?: string } }>(
    event: T,
  ): T {
    if (event.request) {
      let pathOnly: string | undefined = event.request.url;
      if (pathOnly) {
        try {
          // Parse with a dummy base so absolute and relative both work;
          // we only keep `.pathname` so query / hash / host all drop.
          pathOnly = new URL(pathOnly, 'http://scrubbed.local').pathname;
        } catch {
          // Unparseable URL — drop entirely rather than forward something
          // unexpected.
          pathOnly = undefined;
        }
      }
      event.request = {
        url: pathOnly,
        method: event.request.method,
      };
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
    beforeSend: scrubRequest,
    beforeSendTransaction: scrubRequest,
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
  // Reference skeleton at _reference/instrumentation.ts. Sentry's own
  // OTel tracing covers HTTP routes well enough for MVP; revisit when
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
