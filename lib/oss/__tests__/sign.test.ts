import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ali-oss 的 STS 客户端 + OSS 客户端（预签 PUT URL 用）：单测只
// 验证我们这层的契约（参数校验、objectKey 构造、session policy 收缩、
// 错误折叠），不真调阿里云。
const { assumeRoleMock, stsCtorMock, ossCtorMock, signatureUrlMock } =
  vi.hoisted(() => ({
    assumeRoleMock: vi.fn(),
    stsCtorMock: vi.fn(),
    ossCtorMock: vi.fn(),
    signatureUrlMock: vi.fn(),
  }));
vi.mock('ali-oss', () => {
  class MockSTS {
    constructor(opts: unknown) {
      stsCtorMock(opts);
    }
    assumeRole = assumeRoleMock;
  }
  class MockOSS {
    static STS = MockSTS;
    constructor(opts: unknown) {
      ossCtorMock(opts);
    }
    signatureUrl = signatureUrlMock;
  }
  return { default: MockOSS };
});

import { signDesignUpload } from '../sign';
import { DesignFileType } from '../../../generated/prisma/enums';

const validParams = {
  userId: 'u1',
  orderId: 'o1',
  orderItemId: 'i1',
  fileType: DesignFileType.IMAGE,
  fileName: 'design.jpg',
  fileSize: 1024,
  mimeType: 'image/jpeg',
} as const;

const configuredEnv = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  stsCtorMock.mockReset();
  ossCtorMock.mockReset();
  signatureUrlMock
    .mockReset()
    .mockReturnValue('https://my-bucket.oss-cn-shenzhen.aliyuncs.com/signed-put?sig=x');
  assumeRoleMock.mockReset().mockResolvedValue({
    credentials: {
      AccessKeyId: 'STS.mock-ak',
      AccessKeySecret: 'mock-temp-sk',
      SecurityToken: 'mock-token',
      Expiration: '2026-07-05T13:00:00Z',
    },
  });
});

describe('signDesignUpload — not-configured branch', () => {
  it('returns { status: not-configured } with missing keys when env is empty', async () => {
    const r = await signDesignUpload(validParams, {} as unknown as NodeJS.ProcessEnv);
    expect(r.status).toBe('not-configured');
    if (r.status === 'not-configured') {
      expect(r.missing).toContain('OSS_ACCESS_KEY_ID');
      expect(r.message).toMatch(/尚未配置/);
    }
  });

  it('never calls STS from the not-configured path', async () => {
    // Critical contract: a missing-env environment must NEVER attempt
    // AssumeRole. The UI relies on `not-configured` as a stable state.
    await expect(
      signDesignUpload(validParams, {} as unknown as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({ status: 'not-configured' });
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });
});

describe('signDesignUpload — validation (runs before STS signing)', () => {
  it('rejects zero / negative file size', async () => {
    const r = await signDesignUpload(
      { ...validParams, fileSize: 0 },
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.fileSize).toBeDefined();
    }
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('rejects files that exceed the per-type size limit', async () => {
    const r = await signDesignUpload(
      { ...validParams, fileSize: 11 * 1024 * 1024 }, // image limit is 10 MiB
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('accepts valid CDR (under CDR limit, .cdr extension)', async () => {
    const r = await signDesignUpload(
      {
        ...validParams,
        fileType: DesignFileType.CDR,
        fileName: 'art.cdr',
        fileSize: 90 * 1024 * 1024,
        mimeType: 'application/octet-stream',
      },
      configuredEnv,
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.objectKey).toMatch(/^design\/o1\/i1\/cdr-[0-9a-f-]+\.cdr$/);
    }
  });

  it('rejects disallowed MIME (IMAGE type, GIF mime)', async () => {
    const r = await signDesignUpload(
      { ...validParams, mimeType: 'image/gif' },
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.fieldErrors.mimeType).toBeDefined();
  });

  it('accepts JPEG / PNG / WEBP for IMAGE', async () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      await expect(
        signDesignUpload({ ...validParams, mimeType: mime }, configuredEnv),
      ).resolves.toMatchObject({ status: 'ok' });
    }
  });

  it('rejects an empty fileName', async () => {
    const r = await signDesignUpload(
      { ...validParams, fileName: '   ' },
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
  });

  it('rejects path-injection orderId / orderItemId (Codex round 29 / P1)', async () => {
    for (const bad of ['../../etc', 'a/b', 'with spaces', 'has.dot', 'c\0d']) {
      const r1 = await signDesignUpload(
        { ...validParams, orderId: bad },
        configuredEnv,
      );
      expect(r1.status, `orderId=${bad}`).toBe('invalid');
      if (r1.status === 'invalid') expect(r1.fieldErrors.orderId).toBeDefined();

      const r2 = await signDesignUpload(
        { ...validParams, orderItemId: bad },
        configuredEnv,
      );
      expect(r2.status, `orderItemId=${bad}`).toBe('invalid');
      if (r2.status === 'invalid') expect(r2.fieldErrors.orderItemId).toBeDefined();
    }
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('rejects extension / fileType mismatch — CDR upload named .jpg (Codex round 29 / P2)', async () => {
    const r = await signDesignUpload(
      {
        ...validParams,
        fileType: DesignFileType.CDR,
        fileName: 'actually-a-photo.jpg',
        fileSize: 1024,
        mimeType: 'application/octet-stream',
      },
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.fileName?.[0]).toMatch(/扩展名与类型不匹配/);
    }
  });

  it('accepts .jpg / .jpeg / .png / .webp for IMAGE, rejects other extensions', async () => {
    for (const good of ['a.jpg', 'b.JPEG', 'c.png', 'd.webp']) {
      await expect(
        signDesignUpload({ ...validParams, fileName: good }, configuredEnv),
      ).resolves.toMatchObject({ status: 'ok' });
    }
    for (const bad of ['a.gif', 'b.bmp', 'c.heic', 'noext']) {
      const r = await signDesignUpload(
        { ...validParams, fileName: bad },
        configuredEnv,
      );
      expect(r.status, bad).toBe('invalid');
    }
  });
});

describe('signDesignUpload — real STS signing', () => {
  it('returns ok with mapped credentials, bucket URLs, and design/ object key', async () => {
    const r = await signDesignUpload(validParams, configuredEnv);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.credentials).toEqual({
      accessKeyId: 'STS.mock-ak',
      accessKeySecret: 'mock-temp-sk',
      securityToken: 'mock-token',
      expiration: new Date('2026-07-05T13:00:00Z'),
    });
    expect(r.bucket).toBe('my-bucket');
    expect(r.region).toBe('oss-cn-shenzhen');
    expect(r.objectKey).toMatch(/^design\/o1\/i1\/image-[0-9a-f-]+\.jpg$/);
    // PUT 目标是 virtual-hosted bucket URL（可写），publicUrl 允许是
    // 只读 CDN（round 30）——两者都以 objectKey 结尾。
    expect(r.uploadUrl).toBe(
      `https://my-bucket.oss-cn-shenzhen.aliyuncs.com/${r.objectKey}`,
    );
    expect(r.publicUrl.endsWith(`/${r.objectKey}`)).toBe(true);
    // STS client 用长期 AK 构造（AssumeRole 的调用方身份）
    expect(stsCtorMock).toHaveBeenCalledWith({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
    });
  });

  it('mints a presigned PUT URL with the temp credentials, bound to Content-Type', async () => {
    const r = await signDesignUpload(validParams, configuredEnv);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    // 预签客户端必须用 STS 临时凭证 + config endpoint 构造
    expect(ossCtorMock).toHaveBeenCalledWith({
      accessKeyId: 'STS.mock-ak',
      accessKeySecret: 'mock-temp-sk',
      stsToken: 'mock-token',
      bucket: 'my-bucket',
      endpoint: 'https://oss-cn-shenzhen.aliyuncs.com',
      secure: true,
    });
    expect(signatureUrlMock).toHaveBeenCalledWith(r.objectKey, {
      method: 'PUT',
      expires: 3600,
      'Content-Type': 'image/jpeg',
    });
    expect(r.putUrl).toMatch(/^https:\/\//);
  });

  it('scopes the session policy to exactly the minted object key', async () => {
    const r = await signDesignUpload(validParams, configuredEnv);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const [roleArn, policy, duration, sessionName] =
      assumeRoleMock.mock.calls[0];
    expect(roleArn).toBe('acs:ram::111:role/uploader');
    expect(duration).toBe(3600);
    expect(sessionName).toBe('erp-design-upload');
    expect(policy).toEqual({
      Version: '1',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'oss:PutObject',
            'oss:AbortMultipartUpload',
            'oss:ListParts',
          ],
          Resource: [`acs:oss:*:*:my-bucket/${r.objectKey}`],
        },
      ],
    });
  });

  it('folds malformed OSS_ENDPOINT into { status: error } instead of throwing (Codex A06 #5)', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const r = await signDesignUpload(validParams, {
      ...(configuredEnv as unknown as Record<string, string>),
      OSS_ENDPOINT: 'not a url',
    } as unknown as NodeJS.ProcessEnv);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/OSS_ENDPOINT/);
    expect(assumeRoleMock).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('folds AssumeRole failure into { status: error } without leaking SDK details', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    assumeRoleMock.mockRejectedValue(
      new Error('InvalidAccessKeyId.NotFound: sk=super-secret'),
    );
    const r = await signDesignUpload(validParams, configuredEnv);
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      // 用户可见文案不含 SDK 错误正文（可能带 ARN / secret 片段）
      expect(r.message).toMatch(/凭证签发失败/);
      expect(r.message).not.toMatch(/super-secret/);
    }
    // 但 ops 日志里有原始错误
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
