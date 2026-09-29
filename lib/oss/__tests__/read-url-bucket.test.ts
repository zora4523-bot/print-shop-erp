import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DESIGN_THUMBNAIL_PROCESS,
  READ_URL_BUCKET_SECONDS,
  READ_URL_MIN_REMAINING_SECONDS,
  designReadUrlExpiresAt,
  signDesignReadUrl,
} from '../read-url';

// 真实 ali-oss 签名（纯本地 HMAC，不发网络请求），验证桶内 URL 稳定。
const env = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;
const fileUrl = 'https://my-bucket.oss-cn-shenzhen.aliyuncs.com/design/o1/i1/image-x.jpg';

// 选一个桶边界作为基准时刻
const BASE = 1_900_000_000 - (1_900_000_000 % READ_URL_BUCKET_SECONDS);

function signAt(seconds: number, opts?: { thumbnail?: boolean }) {
  vi.setSystemTime(seconds * 1000);
  return signDesignReadUrl(fileUrl, env, opts);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('designReadUrlExpiresAt', () => {
  it('剩余有效期不低于下限、不超过下限 + 桶长', () => {
    for (let t = BASE; t < BASE + 2 * READ_URL_BUCKET_SECONDS; t += 37) {
      const remaining = designReadUrlExpiresAt(t) - t;
      expect(remaining).toBeGreaterThanOrEqual(READ_URL_MIN_REMAINING_SECONDS);
      expect(remaining).toBeLessThan(READ_URL_MIN_REMAINING_SECONDS + READ_URL_BUCKET_SECONDS);
      expect(designReadUrlExpiresAt(t) % READ_URL_BUCKET_SECONDS).toBe(0);
    }
  });
});

describe('signDesignReadUrl 时间桶', () => {
  it('同一桶内两次签名 URL 完全相同', () => {
    vi.useFakeTimers();
    const a = signAt(BASE + 1);
    const b = signAt(BASE + READ_URL_BUCKET_SECONDS - READ_URL_MIN_REMAINING_SECONDS - 1);
    expect(a).toBe(b);
    const expires = Number(new URL(a).searchParams.get('Expires'));
    expect(expires % READ_URL_BUCKET_SECONDS).toBe(0);
  });

  it('跨桶后 Expires 前移、URL 变化', () => {
    vi.useFakeTimers();
    const a = signAt(BASE + 1);
    const b = signAt(BASE + READ_URL_BUCKET_SECONDS + 1);
    expect(a).not.toBe(b);
    expect(Number(new URL(b).searchParams.get('Expires'))).toBe(
      Number(new URL(a).searchParams.get('Expires')) + READ_URL_BUCKET_SECONDS,
    );
  });

  it('桶末尾签出的 URL 仍保留至少一半有效期', () => {
    vi.useFakeTimers();
    const t = BASE + READ_URL_BUCKET_SECONDS - READ_URL_MIN_REMAINING_SECONDS;
    const expires = Number(new URL(signAt(t)).searchParams.get('Expires'));
    expect(expires - t).toBeGreaterThanOrEqual(READ_URL_MIN_REMAINING_SECONDS);
  });

  it('缩略图带 x-oss-process 且与原图签名不同', () => {
    vi.useFakeTimers();
    const full = signAt(BASE + 1);
    const thumb = signAt(BASE + 1, { thumbnail: true });
    const u = new URL(thumb);
    expect(u.searchParams.get('x-oss-process')).toBe(DESIGN_THUMBNAIL_PROCESS);
    expect(u.searchParams.get('Signature')).not.toBe(new URL(full).searchParams.get('Signature'));
  });
});
