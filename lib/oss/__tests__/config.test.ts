import { describe, it, expect } from 'vitest';
import { readOssConfig } from '../config';

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Explicitly undefined keys are omitted; empty string stays so we can
  // verify "blank after trim" handling.
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base as NodeJS.ProcessEnv;
}

describe('readOssConfig', () => {
  it('reports missing when nothing is set', () => {
    const r = readOssConfig(envWith({}));
    expect(r.configured).toBe(false);
    if (!r.configured) {
      expect(r.missing).toEqual([
        'OSS_ACCESS_KEY_ID',
        'OSS_ACCESS_KEY_SECRET',
        'OSS_STS_ROLE_ARN',
        'OSS_BUCKET',
        'OSS_REGION',
      ]);
    }
  });

  it('reports partial missing', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_BUCKET: 'my-bucket',
      }),
    );
    expect(r.configured).toBe(false);
    if (!r.configured) {
      expect(r.missing).toContain('OSS_ACCESS_KEY_SECRET');
      expect(r.missing).toContain('OSS_REGION');
      expect(r.missing).not.toContain('OSS_ACCESS_KEY_ID');
      expect(r.missing).not.toContain('OSS_BUCKET');
    }
  });

  it('treats whitespace-only values as missing', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: '   ',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'b',
        OSS_REGION: 'oss-cn-shenzhen',
      }),
    );
    expect(r.configured).toBe(false);
    if (!r.configured) expect(r.missing).toEqual(['OSS_ACCESS_KEY_ID']);
  });

  it('returns a full config when every required var is set', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.accessKeyId).toBe('ak');
      expect(r.cfg.bucket).toBe('my-bucket');
      expect(r.cfg.region).toBe('oss-cn-shenzhen');
    }
  });

  it('derives endpoint + bucketUrl + publicBaseUrl when optional vars are blank', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.endpoint).toBe('https://oss-cn-shenzhen.aliyuncs.com');
      expect(r.cfg.bucketUrl).toBe('https://my-bucket.oss-cn-shenzhen.aliyuncs.com');
      expect(r.cfg.publicBaseUrl).toBe('https://my-bucket.oss-cn-shenzhen.aliyuncs.com');
    }
  });

  it('honors explicit OSS_ENDPOINT and OSS_PUBLIC_BASE_URL overrides', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
        OSS_ENDPOINT: 'https://internal-oss.example.com',
        OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.endpoint).toBe('https://internal-oss.example.com');
      expect(r.cfg.publicBaseUrl).toBe('https://cdn.example.com');
    }
  });

  it('derives bucketUrl from OSS_ENDPOINT override (VPC / internal host, Codex round 31 / P2)', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
        OSS_ENDPOINT: 'https://oss-cn-shenzhen-internal.aliyuncs.com',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.endpoint).toBe('https://oss-cn-shenzhen-internal.aliyuncs.com');
      expect(r.cfg.bucketUrl).toBe(
        'https://my-bucket.oss-cn-shenzhen-internal.aliyuncs.com',
      );
    }
  });

  it('preserves port and protocol from OSS_ENDPOINT (HTTP-only or custom port)', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
        OSS_ENDPOINT: 'http://oss.internal:9000',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.bucketUrl).toBe('http://my-bucket.oss.internal:9000');
    }
  });

  it('throws when OSS_ENDPOINT is not a valid URL', () => {
    expect(() =>
      readOssConfig(
        envWith({
          OSS_ACCESS_KEY_ID: 'ak',
          OSS_ACCESS_KEY_SECRET: 'sk',
          OSS_STS_ROLE_ARN: 'arn',
          OSS_BUCKET: 'my-bucket',
          OSS_REGION: 'oss-cn-shenzhen',
          OSS_ENDPOINT: 'not a url',
        }),
      ),
    ).toThrowError(/OSS_ENDPOINT 不是合法 URL/);
  });

  it('keeps bucketUrl on the OSS virtual-hosted host even when publicBaseUrl is a CDN (Codex round 30 / P2)', () => {
    // A CDN / custom domain is read-only; browser uploads must still
    // target the bucket's OSS host. Regression test to ensure future
    // edits don't accidentally point uploadUrl at the CDN.
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: 'ak',
        OSS_ACCESS_KEY_SECRET: 'sk',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'my-bucket',
        OSS_REGION: 'oss-cn-shenzhen',
        OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.bucketUrl).toBe('https://my-bucket.oss-cn-shenzhen.aliyuncs.com');
      expect(r.cfg.publicBaseUrl).toBe('https://cdn.example.com');
      // Not equal — that's the point.
      expect(r.cfg.bucketUrl).not.toBe(r.cfg.publicBaseUrl);
    }
  });

  it('trims values', () => {
    const r = readOssConfig(
      envWith({
        OSS_ACCESS_KEY_ID: ' ak ',
        OSS_ACCESS_KEY_SECRET: ' sk ',
        OSS_STS_ROLE_ARN: ' arn ',
        OSS_BUCKET: ' b ',
        OSS_REGION: ' r ',
      }),
    );
    expect(r.configured).toBe(true);
    if (r.configured) {
      expect(r.cfg.accessKeyId).toBe('ak');
      expect(r.cfg.bucket).toBe('b');
    }
  });
});
