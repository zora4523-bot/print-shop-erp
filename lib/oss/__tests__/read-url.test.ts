import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ossCtorMock, signatureUrlMock } = vi.hoisted(() => ({
  ossCtorMock: vi.fn(),
  signatureUrlMock: vi.fn(),
}));
vi.mock('ali-oss', () => {
  class MockOSS {
    constructor(opts: unknown) {
      ossCtorMock(opts);
    }
    signatureUrl = signatureUrlMock;
  }
  return { default: MockOSS };
});

import { signDesignReadUrl } from '../read-url';

const configuredEnv = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;

const bucketHostUrl =
  'https://my-bucket.oss-cn-shenzhen.aliyuncs.com/design/o1/i1/image-x.jpg';

beforeEach(() => {
  ossCtorMock.mockReset();
  signatureUrlMock
    .mockReset()
    .mockReturnValue('https://signed.example/design/o1/i1/image-x.jpg?sig=y');
});

describe('signDesignReadUrl', () => {
  it('本 bucket design/* 的 URL → 30min 预签 GET', () => {
    const r = signDesignReadUrl(bucketHostUrl, configuredEnv);
    expect(signatureUrlMock).toHaveBeenCalledWith('design/o1/i1/image-x.jpg', {
      expires: 1800,
      method: 'GET',
    });
    expect(r).toMatch(/^https:\/\/signed\.example\//);
  });

  it('OSS 未配置 → 原样返回，不触碰 SDK', () => {
    const r = signDesignReadUrl(bucketHostUrl, {} as NodeJS.ProcessEnv);
    expect(r).toBe(bucketHostUrl);
    expect(ossCtorMock).not.toHaveBeenCalled();
  });

  it('malformed OSS_ENDPOINT（config throw）→ 原样返回不炸页面', () => {
    const r = signDesignReadUrl(bucketHostUrl, {
      ...(configuredEnv as unknown as Record<string, string>),
      OSS_ENDPOINT: 'not a url',
    } as unknown as NodeJS.ProcessEnv);
    expect(r).toBe(bucketHostUrl);
  });

  it('OSS_PUBLIC_BASE_URL 为 CDN 域名 → 按 CDN host 匹配并签 bucket 直连 URL', () => {
    const env = {
      ...(configuredEnv as unknown as Record<string, string>),
      OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
    } as unknown as NodeJS.ProcessEnv;
    const r = signDesignReadUrl(
      'https://cdn.example.com/design/o1/i1/image-x.jpg',
      env,
    );
    expect(signatureUrlMock).toHaveBeenCalledWith('design/o1/i1/image-x.jpg', {
      expires: 1800,
      method: 'GET',
    });
    expect(r).toMatch(/^https:\/\/signed\.example\//);
  });

  it('OSS_PUBLIC_BASE_URL 带路径前缀 → 剥前缀后取真 objectKey', () => {
    const env = {
      ...(configuredEnv as unknown as Record<string, string>),
      OSS_PUBLIC_BASE_URL: 'https://cdn.example.com/assets',
    } as unknown as NodeJS.ProcessEnv;
    signDesignReadUrl(
      'https://cdn.example.com/assets/design/o1/i1/image-x.jpg',
      env,
    );
    expect(signatureUrlMock).toHaveBeenCalledWith('design/o1/i1/image-x.jpg', {
      expires: 1800,
      method: 'GET',
    });
    // 同 host 但不在前缀下 → 原样放行
    signatureUrlMock.mockClear();
    const passthrough = 'https://cdn.example.com/other/design/o1/i1/image-x.jpg';
    expect(signDesignReadUrl(passthrough, env)).toBe(passthrough);
    expect(signatureUrlMock).not.toHaveBeenCalled();
  });

  it('配了 CDN 域名时 bucket 直连 URL 仍可签（bucketUrl 兜底匹配）', () => {
    const env = {
      ...(configuredEnv as unknown as Record<string, string>),
      OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
    } as unknown as NodeJS.ProcessEnv;
    signDesignReadUrl(bucketHostUrl, env);
    expect(signatureUrlMock).toHaveBeenCalledWith('design/o1/i1/image-x.jpg', {
      expires: 1800,
      method: 'GET',
    });
  });

  it('外部 host / 非 design 前缀 / 非法 URL → 原样返回', () => {
    for (const passthrough of [
      'https://evil.example.com/design/o1/i1/image-x.jpg', // 外部 host
      'https://my-bucket.oss-cn-shenzhen.aliyuncs.com/bundles/b1.zip', // 非 design
      'mock://bundle/x.zip', // mock 占位
      'not-a-url',
    ]) {
      expect(signDesignReadUrl(passthrough, configuredEnv)).toBe(passthrough);
    }
    expect(signatureUrlMock).not.toHaveBeenCalled();
  });
});
