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

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release,
      // Lower trace sample for high-traffic endpoints once we ship;
      // 0.2 is a starter for pre-launch when we want decent visibility.
      tracesSampleRate: 0.2,
      // Don't surface PII in error scopes by default. Salary amounts /
      // customer refs may end up in messages — keep send-default-pii
      // off and let specific call sites attach context explicitly.
      sendDefaultPii: false,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime can't load the full Node SDK — @sentry/nextjs
    // routes init() to its edge-safe variant transparently here.
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release,
      tracesSampleRate: 0.2,
      sendDefaultPii: false,
    });
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
// Actions / Route Handlers BEFORE Next surfaces them. Forward to
// Sentry only if configured — same gating as register().
export async function onRequestError(
  err: unknown,
  request: { url?: string; method?: string },
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(err, {
    extra: {
      url: request.url,
      method: request.method,
    },
  });
}
