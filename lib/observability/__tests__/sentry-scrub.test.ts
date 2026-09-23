import { describe, expect, it } from 'vitest';
import {
  redactCdrBundleToken,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '../sentry-scrub';

const TOKEN = 'Abc_DEF-0123456789abcdefghijklmnopqrstuvwxy';
const PATH = `/api/cdr/bundles/${TOKEN}`;

describe('redactCdrBundleToken', () => {
  it('masks the bearer segment and keeps surrounding text', () => {
    expect(redactCdrBundleToken(`GET ${PATH}`)).toBe('GET /api/cdr/bundles/[token]');
    expect(redactCdrBundleToken(`https://erp.example.com${PATH}?x=1`)).toBe(
      'https://erp.example.com/api/cdr/bundles/[token]?x=1',
    );
  });

  it('leaves unrelated paths alone', () => {
    expect(redactCdrBundleToken('/api/orders/o1/pdf')).toBe('/api/orders/o1/pdf');
    expect(redactCdrBundleToken('/foreman/cdr')).toBe('/foreman/cdr');
  });
});

describe('scrubSentryEvent', () => {
  it('removes the CDR token from every place a request path lands', () => {
    const event = {
      transaction: `GET ${PATH}`,
      request: { url: `https://erp.example.com${PATH}?a=b`, method: 'GET', headers: { cookie: 'x' } },
      contexts: {
        nextjs: { request_path: PATH },
        trace: { data: { 'url.path': PATH, 'http.target': PATH, 'sentry.op': 'http.server' } },
      },
      spans: [{ op: 'http.server', description: `GET ${PATH}?q=1`, data: { 'http.url': PATH } }],
      breadcrumbs: [{ category: 'fetch', data: { url: `https://erp.example.com${PATH}` } }],
      exception: { values: [{ value: `failed ${PATH}` }] },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.request).toEqual({ url: '/api/cdr/bundles/[token]', method: 'GET' });
    expect(scrubbed.transaction).toBe('GET /api/cdr/bundles/[token]');
    expect(scrubbed.spans[0]!.description).toBe('GET /api/cdr/bundles/[token]');
    expect(scrubbed.contexts.trace.data['sentry.op']).toBe('http.server');
  });

  it('keeps the existing query / header / span-data scrubbing', () => {
    const event = {
      request: { url: 'https://erp.example.com/orders?customer=x', method: 'POST', data: 'salary=1' },
      spans: [
        { op: 'db', description: 'SELECT * FROM t WHERE a ? b', data: { 'db.statement': 's', 'http.method': 'GET' } },
      ],
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request).toEqual({ url: '/orders', method: 'POST' });
    expect(scrubbed.spans[0]!.description).toBe('SELECT * FROM t WHERE a ? b');
    expect(scrubbed.spans[0]!.data).toEqual({ 'http.method': 'GET' });
  });

  it('tolerates cyclic references', () => {
    const event: Record<string, unknown> = { transaction: PATH };
    event.self = event;
    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event.transaction).toBe('/api/cdr/bundles/[token]');
  });
});

// A legacy WeCom group webhook carries its credential in the query
// (…/webhook/send?key=<secret>); list searches put customer names in `?q=`.
// Neither may reach Sentry via breadcrumbs or the root span's trace data.
const WEBHOOK_KEY = 'wecom-webhook-key-abc';
const WEBHOOK_URL = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WEBHOOK_KEY}`;

describe('URL query scrubbing outside request / spans', () => {
  it('strips query and fragment from contexts.trace.data', () => {
    const event = {
      type: 'transaction',
      contexts: {
        trace: {
          data: {
            'sentry.op': 'http.client',
            'http.request.method': 'POST',
            'http.target': '/orders?q=张三#top',
            'http.url': WEBHOOK_URL,
            'url.full': WEBHOOK_URL,
            url: WEBHOOK_URL,
            'url.query': `key=${WEBHOOK_KEY}`,
            'url.fragment': 'frag',
            'http.query': `?key=${WEBHOOK_KEY}`,
            'http.fragment': '#frag',
          },
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);
    const serialized = JSON.stringify(scrubbed);

    expect(serialized).not.toContain(WEBHOOK_KEY);
    expect(serialized).not.toContain('张三');
    expect(serialized).not.toContain('frag');
    expect(scrubbed.contexts.trace.data).toEqual({
      'sentry.op': 'http.client',
      'http.request.method': 'POST',
      'http.target': '/orders',
      'http.url': 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
      'url.full': 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
    });
  });

  it('strips query and fragment from breadcrumbs carried by an error event', () => {
    const event = {
      exception: { values: [{ value: 'NOTIFICATION_DELIVERY_FAILED' }] },
      breadcrumbs: [
        {
          category: 'fetch',
          type: 'http',
          data: {
            url: WEBHOOK_URL,
            'http.method': 'POST',
            'http.query': `?key=${WEBHOOK_KEY}`,
            'http.fragment': '#frag',
            status_code: 429,
          },
        },
        { category: 'console', message: 'worker started' },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(WEBHOOK_KEY);
    expect(scrubbed.breadcrumbs[0]!.data).toEqual({
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
      'http.method': 'POST',
      status_code: 429,
    });
    expect(scrubbed.breadcrumbs[1]).toEqual({ category: 'console', message: 'worker started' });
  });

  it('scrubs a breadcrumb before Sentry records it (beforeBreadcrumb)', () => {
    const breadcrumb = {
      category: 'http',
      type: 'http',
      data: {
        url: `/orders?q=13800000000`,
        'http.method': 'GET',
        'http.query': '?q=13800000000',
      },
    };

    const scrubbed = scrubSentryBreadcrumb(breadcrumb);

    expect(scrubbed).toEqual({
      category: 'http',
      type: 'http',
      data: { url: '/orders', 'http.method': 'GET' },
    });
  });

  it('leaves breadcrumbs without URL data untouched and still masks CDR tokens', () => {
    expect(scrubSentryBreadcrumb({ category: 'console', message: 'hello' })).toEqual({
      category: 'console',
      message: 'hello',
    });
    expect(
      scrubSentryBreadcrumb({ category: 'fetch', data: { url: `https://erp.example.com${PATH}` } }),
    ).toEqual({
      category: 'fetch',
      data: { url: 'https://erp.example.com/api/cdr/bundles/[token]' },
    });
  });
});

// At beforeSend / beforeSendTransaction time the SDK still carries
// `sdkProcessingMetadata` (captured scopes → client → promise buffer with
// getter-only members). Sentry deletes it when building the envelope, so it
// is never sent; walking it would throw on assignment and drop the event.
describe('SDK-internal metadata', () => {
  function sdkLikeMetadata() {
    const promiseBuffer = { pending: [] as unknown[] };
    Object.defineProperty(promiseBuffer, '$', {
      enumerable: true,
      get: () => promiseBuffer.pending,
    });
    return {
      capturedSpanScope: {
        _client: { _promiseBuffer: promiseBuffer, _options: { tunnel: PATH } },
      },
    };
  }

  it('does not throw on getter-only SDK members and leaves the metadata alone', () => {
    const metadata = sdkLikeMetadata();
    const event = {
      type: 'transaction',
      transaction: `GET ${PATH}`,
      sdkProcessingMetadata: metadata,
    };

    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event.transaction).toBe('GET /api/cdr/bundles/[token]');
    expect(event.sdkProcessingMetadata).toBe(metadata);
    expect(metadata.capturedSpanScope._client._options.tunnel).toBe(PATH);
  });

  it('does not reassign unchanged values, so read-only event members survive', () => {
    const extra = { note: 'plain text' };
    Object.defineProperty(extra, 'computed', { enumerable: true, get: () => 'no token here' });
    const event = { exception: { values: [{ value: 'NOTIFICATION_DELIVERY_FAILED' }] }, extra };

    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event.extra).toEqual({ note: 'plain text', computed: 'no token here' });
  });
});
