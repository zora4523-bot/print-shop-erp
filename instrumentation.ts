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

  // Header / body / URL-query / CDR-token scrubber — see
  // lib/observability/sentry-scrub.ts for the sweep points and history.
  const { SENTRY_SCRUB_HOOKS } = await import('./lib/observability/sentry-scrub');

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
    ...SENTRY_SCRUB_HOOKS,
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
