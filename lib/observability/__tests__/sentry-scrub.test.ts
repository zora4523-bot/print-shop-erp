import { describe, expect, it } from 'vitest';
import { redactCdrBundleToken, scrubSentryEvent } from '../sentry-scrub';

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
