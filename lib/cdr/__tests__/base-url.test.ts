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
