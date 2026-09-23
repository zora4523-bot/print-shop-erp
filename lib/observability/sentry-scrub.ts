// Sentry 事件清洗（instrumentation.ts 的 beforeSend / beforeSendTransaction）。
//
// 抽成独立纯模块是为了能在 node 环境单测；这里不 import 任何运行时依赖，
// edge 与 node 两个 runtime 都能加载。
//
// Sentry 的 captureRequestError + 默认 RequestData integration 会把
// `event.request.headers`（Authorization、Cookie）和 `event.request.data`
// （Server Action FormData，含薪资金额 / 客户信息）发到 Sentry 服务器；
// `sendDefaultPii: false` 只管 IP 采集（Codex round 65）。清洗点：
//   - event.request          → 收窄为 { url=path, method }            (round 65 P1)
//   - event.spans[*].data    → 只留白名单 key，丢掉完整 URL           (round 67 P2)
//   - contexts.nextjs.request_path → 去 query                          (round 67 P2)
//   - contexts.trace.data / breadcrumbs[*].data → URL 去 query 与 fragment，
//     删掉单独的 query / fragment 字段（根 span 的 http.target 带搜索词；
//     旧版企业微信 Webhook 的 ?key= 会进 fetch 面包屑与 url.full）
//   - 全事件字符串           → 遮蔽 CDR 外发链接的 bearer token        (2026-09-23)
// beforeSend（异常）与 beforeSendTransaction（采样 trace）都要挂（round 66 P1）；
// beforeBreadcrumb 挂 scrubSentryBreadcrumb。Web（instrumentation.ts）与
// 后台 worker（scripts/background-worker-runtime.ts）共用 SENTRY_SCRUB_HOOKS。

// CDR 外协下载链接把 256-bit token 放在路径里（/api/cdr/bundles/<token>），
// 链接即凭证。路径会出现在 request.url、transaction 名、http span 描述、
// contexts.trace.data（url.path / http.target …）、breadcrumb 等处，逐个
// 字段追不全，所以对整个事件的字符串做一次遍历遮蔽。
const CDR_BUNDLE_TOKEN_PATH = /(\/api\/cdr\/bundles\/)[^/?#\s"']+/g;
const CDR_BUNDLE_TOKEN_PLACEHOLDER = '[token]';

export function redactCdrBundleToken(value: string): string {
  return value.replace(CDR_BUNDLE_TOKEN_PATH, `$1${CDR_BUNDLE_TOKEN_PLACEHOLDER}`);
}

// Present while beforeSend / beforeSendTransaction run, deleted by the SDK
// when it builds the envelope. It holds live scopes and the client, whose
// getter-only members make blind reassignment throw — and a throwing hook
// drops the whole event. Only its dynamicSamplingContext is sent (copied
// into the envelope `trace` header), so that member is scrubbed on its own.
const SDK_INTERNAL_EVENT_KEYS = new Set(['sdkProcessingMetadata']);

// Mutates in place and only writes a string back when redaction changed it,
// so read-only members that carry no token are never assigned.
function redactStringsDeep(
  value: unknown,
  seen: WeakSet<object>,
  skipKeys: ReadonlySet<string> = new Set(),
): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (skipKeys.has(key)) continue;
    const current = record[key];
    if (typeof current === 'string') {
      const redacted = redactCdrBundleToken(current);
      if (redacted !== current) record[key] = redacted;
    } else {
      redactStringsDeep(current, seen);
    }
  }
}

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

// URL-valued attributes (legacy + current OTel semantic conventions, plus
// Sentry's own `url`) keep scheme / host / path; query and fragment drop.
const URL_VALUED_DATA_KEYS = new Set(['url', 'url.full', 'http.url', 'http.target']);
// Attributes that hold nothing but a query string or fragment.
const QUERY_ONLY_DATA_KEYS = new Set([
  'url.query',
  'url.fragment',
  'http.query',
  'http.fragment',
]);

function stripUrlQueryAndFragment(value: string): string {
  const cut = value.search(/[?#]/);
  return cut >= 0 ? value.slice(0, cut) : value;
}

function scrubUrlData(data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (QUERY_ONLY_DATA_KEYS.has(key)) {
      delete record[key];
    } else if (URL_VALUED_DATA_KEYS.has(key) && typeof record[key] === 'string') {
      record[key] = stripUrlQueryAndFragment(record[key]);
    }
  }
}

/** beforeBreadcrumb hook: fetch / http breadcrumbs record the outgoing URL. */
export function scrubSentryBreadcrumb<T>(breadcrumb: T): T {
  scrubUrlData((breadcrumb as { data?: unknown }).data);
  redactStringsDeep(breadcrumb, new WeakSet());
  return breadcrumb;
}

export function scrubSentryEvent<T>(event: T): T {
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
      trace?: { data?: unknown };
      [k: string]: unknown;
    };
    breadcrumbs?: unknown;
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

  scrubUrlData(e.contexts?.trace?.data);
  if (Array.isArray(e.breadcrumbs)) {
    for (const breadcrumb of e.breadcrumbs) {
      if (breadcrumb && typeof breadcrumb === 'object') {
        scrubUrlData((breadcrumb as { data?: unknown }).data);
      }
    }
  }

  scrubDynamicSamplingContext(
    (event as { sdkProcessingMetadata?: { dynamicSamplingContext?: unknown } })
      .sdkProcessingMetadata?.dynamicSamplingContext,
  );
  redactStringsDeep(event, new WeakSet(), SDK_INTERNAL_EVENT_KEYS);
  return event;
}

function scrubDynamicSamplingContext(dsc: unknown): void {
  if (!dsc || typeof dsc !== 'object') return;
  const record = dsc as Record<string, unknown>;
  if (typeof record.transaction === 'string') {
    record.transaction = stripUrlQueryAndFragment(record.transaction);
  }
  redactStringsDeep(record, new WeakSet());
}

/** Shared Sentry.init hooks for the Web runtime and the background worker. */
export const SENTRY_SCRUB_HOOKS = {
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeBreadcrumb: scrubSentryBreadcrumb,
};
