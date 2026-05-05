import { describe, it, expect } from 'vitest';
import { deriveBaseUrlFromHeaders } from '../base-url';

describe('deriveBaseUrlFromHeaders', () => {
  it('proto + host 都齐 → 直接拼', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: null,
        host: 'erp.example.com',
      }),
    ).toBe('https://erp.example.com');
  });

  it('forwardedHost 优先于 host', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: 'erp.example.com',
        host: 'internal.local',
      }),
    ).toBe('https://erp.example.com');
  });

  it('multi-proxy hop list `https, http` → 取第一个 https', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https, http',
        forwardedHost: null,
        host: 'erp.example.com',
      }),
    ).toBe('https://erp.example.com');
  });

  it('multi-proxy host hop list `public, internal.local` → 取第一个 public', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: 'erp.example.com, internal.local',
        host: null,
      }),
    ).toBe('https://erp.example.com');
  });

  it('proto 缺失 → fallback localhost（不默认 http 给错的降级链）', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: null,
        forwardedHost: null,
        host: 'erp.example.com',
      }),
    ).toBe('http://localhost:3000');
  });

  it('proto 非法（不是 http / https）→ fallback', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'gopher',
        forwardedHost: null,
        host: 'erp.example.com',
      }),
    ).toBe('http://localhost:3000');
  });

  it('host 含空格（注入尝试）→ 拒绝 fallback', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: 'erp.example.com proxy.evil.com',
        host: null,
      }),
    ).toBe('http://localhost:3000');
  });

  it('host 含端口 → OK（://erp.example.com:8443）', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: 'erp.example.com:8443',
        host: null,
      }),
    ).toBe('https://erp.example.com:8443');
  });

  it('IPv6 字面量带方括号（带端口）→ OK（Codex round 123）', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: '[2001:db8::1]:8443',
        host: null,
      }),
    ).toBe('https://[2001:db8::1]:8443');
  });

  it('IPv6 loopback `[::1]:3000` → OK', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'http',
        forwardedHost: '[::1]:3000',
        host: null,
      }),
    ).toBe('http://[::1]:3000');
  });

  it('IPv6 不带方括号（裸 `::1`）→ 拒绝 fallback（URL 标准要求方括号）', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'http',
        forwardedHost: '::1',
        host: null,
      }),
    ).toBe('http://localhost:3000');
  });

  it('IPv4-mapped IPv6 `[::ffff:127.0.0.1]:3000` → OK，URL parser 折叠成 `[::ffff:7f00:1]`（Codex round 124）', () => {
    // WHATWG URL 解析器对 IPv4-mapped IPv6 做 canonicalization：
    // `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`（IPv4 段 hex-fold）。
    // 这是 authoritative 形态，外协拿到任一 URL parser 都能解析回同一个 host。
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'http',
        forwardedHost: '[::ffff:127.0.0.1]:3000',
        host: null,
      }),
    ).toBe('http://[::ffff:7f00:1]:3000');
  });

  it('非法 IPv6（如 `[abc]` / `[2001:db8:::1]`）→ URL parser 拒绝 fallback', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: '[abc]',
        host: null,
      }),
    ).toBe('http://localhost:3000');
    expect(
      deriveBaseUrlFromHeaders({
        proto: 'https',
        forwardedHost: '[2001:db8:::1]',
        host: null,
      }),
    ).toBe('http://localhost:3000');
  });

  it('host 含 path / `?` / `@` / `\\` 注入字符 → fallback', () => {
    for (const evil of [
      'erp.example.com/evil',
      'erp.example.com?x=1',
      'user@erp.example.com',
      'erp.example.com\\evil',
      'erp.example.com#frag',
    ]) {
      expect(
        deriveBaseUrlFromHeaders({
          proto: 'https',
          forwardedHost: evil,
          host: null,
        }),
      ).toBe('http://localhost:3000');
    }
  });

  it('两个 header 都空 → fallback localhost', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: null,
        forwardedHost: null,
        host: null,
      }),
    ).toBe('http://localhost:3000');
  });

  it('空白逗号分隔（首项空） → fallback', () => {
    expect(
      deriveBaseUrlFromHeaders({
        proto: ', https',
        forwardedHost: null,
        host: 'erp.example.com',
      }),
    ).toBe('http://localhost:3000');
  });
});
