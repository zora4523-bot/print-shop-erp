import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';

// Mock ali-oss client + archiver：单测验证编排（key 反推、防越权前缀、
// 同名去重、签 URL 参数），不真发 HTTP。
const {
  ossCtorMock,
  getStreamMock,
  putStreamMock,
  signatureUrlMock,
  archiveMock,
} = vi.hoisted(() => {
  const archiveMock = {
    pipe: vi.fn(),
    append: vi.fn(),
    finalize: vi.fn(),
    abort: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
  return {
    ossCtorMock: vi.fn(),
    getStreamMock: vi.fn(),
    putStreamMock: vi.fn(),
    signatureUrlMock: vi.fn(),
    archiveMock,
  };
});
vi.mock('ali-oss', () => {
  class MockOSS {
    constructor(opts: unknown) {
      ossCtorMock(opts);
    }
    getStream = getStreamMock;
    putStream = putStreamMock;
    signatureUrl = signatureUrlMock;
  }
  return { default: MockOSS };
});
vi.mock('archiver', () => ({
  ZipArchive: class {
    constructor() {
      return archiveMock as unknown as object;
    }
  },
}));

import { isMockMode, uploadBundleZip, CdrZipError } from '../zip';

const configuredEnv = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;

const designUrl = (name: string) =>
  `https://my-bucket.oss-cn-shenzhen.aliyuncs.com/design/o1/i1/${name}`;

beforeEach(() => {
  ossCtorMock.mockReset();
  getStreamMock
    .mockReset()
    .mockResolvedValue({ stream: new PassThrough().end() });
  putStreamMock.mockReset().mockResolvedValue({ name: 'bundles/x.zip' });
  signatureUrlMock
    .mockReset()
    .mockReturnValue('https://signed.example/bundles/b1.zip?sig=abc');
  archiveMock.pipe.mockReset();
  // 生产代码逐个追加条目、等 archiver 的 'entry' 事件再打开下一个 GET；
  // mock 在 append 后异步回放该事件，模拟"条目已处理完"。
  let onEntry: (() => void) | null = null;
  archiveMock.once.mockReset().mockImplementation((event: string, fn: () => void) => {
    if (event === 'entry') onEntry = fn;
    return archiveMock;
  });
  archiveMock.append.mockReset().mockImplementation(() => {
    const fire = onEntry;
    onEntry = null;
    setImmediate(() => fire?.());
    return archiveMock;
  });
  archiveMock.finalize.mockReset().mockResolvedValue(undefined);
  archiveMock.abort.mockReset();
  archiveMock.on.mockReset();
});

describe('isMockMode', () => {
  it('CDR_BUNDLE_MOCK_MODE=true → true', () => {
    expect(
      isMockMode({
        CDR_BUNDLE_MOCK_MODE: 'true',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
  it('CDR_BUNDLE_MOCK_MODE=false + OSS 配齐 → false', () => {
    expect(
      isMockMode({
        ...(configuredEnv as Record<string, string>),
        CDR_BUNDLE_MOCK_MODE: 'false',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
  it('OSS 未配齐（缺任一 key）→ true（强制 mock）', () => {
    expect(
      isMockMode({
        OSS_ACCESS_KEY_ID: 'k',
        OSS_ACCESS_KEY_SECRET: 's',
        // OSS_STS_ROLE_ARN missing
        OSS_BUCKET: 'b',
        OSS_REGION: 'oss-cn-shenzhen',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
  it('留空 + OSS 配齐 + 非生产 → true（dev/E2E 不写真 bucket）', () => {
    expect(
      isMockMode({
        ...(configuredEnv as unknown as Record<string, string>),
        NODE_ENV: 'development',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
  it('OSS_ENDPOINT 非法（readOssConfig throw）→ true（页面降级 mock 而非 500）', () => {
    expect(
      isMockMode({
        ...(configuredEnv as unknown as Record<string, string>),
        OSS_ENDPOINT: 'not a url',
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
  it('留空 + OSS 配齐 + 生产 → false（真实打包）', () => {
    expect(
      isMockMode({
        ...(configuredEnv as unknown as Record<string, string>),
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('uploadBundleZip — mock path', () => {
  it('mock-mode 走占位路径，不触碰 OSS', async () => {
    const r = await uploadBundleZip(
      {
        files: [{ orderNo: 'O-1', fileName: 'a.cdr', fileUrl: 'https://x' }],
        bundleId: 'bundle-abc',
      },
      { mockMode: true, now: new Date('2026-05-05T00:00:00Z') },
    );
    expect(r.zipFileUrl).toBe('mock://bundle/bundle-abc.zip');
    expect(r.expiresAt.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(r.isMock).toBe(true);
    expect(ossCtorMock).not.toHaveBeenCalled();
  });
});

describe('uploadBundleZip — real path', () => {
  const now = new Date('2026-07-05T00:00:00Z');

  it('拉设计文件 → 压缩 → putStream bundles/<id>.zip → 24h 预签 URL', async () => {
    const r = await uploadBundleZip(
      {
        files: [
          { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-1.cdr') },
          { orderNo: 'O-2', fileName: 'b.cdr', fileUrl: designUrl('cdr-2.cdr') },
        ],
        bundleId: 'b1',
      },
      { mockMode: false, now, env: configuredEnv },
    );

    // endpoint 必须来自 config（支持 OSS_ENDPOINT 覆盖），不能只凭
    // region 拼默认域名（Codex A06 review #1）
    expect(ossCtorMock).toHaveBeenCalledWith({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'my-bucket',
      endpoint: 'https://oss-cn-shenzhen.aliyuncs.com',
      secure: true,
    });
    expect(getStreamMock.mock.calls.map((c) => c[0])).toEqual([
      'design/o1/i1/cdr-1.cdr',
      'design/o1/i1/cdr-2.cdr',
    ]);
    expect(archiveMock.append.mock.calls.map((c) => c[1])).toEqual([
      { name: 'O-1/a.cdr' },
      { name: 'O-2/b.cdr' },
    ]);
    expect(putStreamMock).toHaveBeenCalledTimes(1);
    expect(putStreamMock.mock.calls[0][0]).toBe('bundles/b1.zip');
    expect(signatureUrlMock).not.toHaveBeenCalled();
    expect(r.zipFileUrl).toBe('bundles/b1.zip');
    expect(r.zipObjectKey).toBe('bundles/b1.zip');
    expect(r.expiresAt.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(r.isMock).toBe(false);
  });

  it('同一工单同名文件在 ZIP 内追加序号，不静默覆盖', async () => {
    await uploadBundleZip(
      {
        files: [
          { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-1.cdr') },
          { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-2.cdr') },
        ],
        bundleId: 'b1',
      },
      { mockMode: false, now, env: configuredEnv },
    );
    expect(archiveMock.append.mock.calls.map((c) => c[1])).toEqual([
      { name: 'O-1/a.cdr' },
      { name: 'O-1/(2) a.cdr' },
    ]);
  });

  it('条目名只取文件名最后一段并去掉控制/双向字符，历史脏数据也不能穿越出工单目录', async () => {
    const names = [
      '..\\..\\Startup\\a.bat',
      '../../x.cdr',
      'a\u0001b\u202Eexe.cdr',
      '..',
      'noext',
    ];
    await uploadBundleZip(
      {
        files: names.map((fileName, i) => ({
          orderNo: 'O-1',
          fileName,
          fileUrl: designUrl(`cdr-${i}.cdr`),
        })),
        bundleId: 'b1',
      },
      { mockMode: false, now, env: configuredEnv },
    );
    expect(archiveMock.append.mock.calls.map((c) => c[1])).toEqual([
      { name: 'O-1/a.bat.cdr' },
      { name: 'O-1/x.cdr' },
      { name: 'O-1/abexe.cdr' },
      { name: 'O-1/design.cdr' },
      { name: 'O-1/noext.cdr' },
    ]);
  });

  it.each([
    ['CDN 域名带路径前缀', 'https://cdn.example.com/assets', 'https://cdn.example.com/assets/design/o1/i1/cdr-1.cdr'],
    ['CDN 域名带路径前缀（末尾斜杠）', 'https://cdn.example.com/assets/', 'https://cdn.example.com/assets/design/o1/i1/cdr-1.cdr'],
    ['CDN 域名不带路径', 'https://cdn.example.com', 'https://cdn.example.com/design/o1/i1/cdr-1.cdr'],
    ['配了 CDN 后的 bucket 直连历史地址', 'https://cdn.example.com/assets', designUrl('cdr-1.cdr')],
  ])('OSS_PUBLIC_BASE_URL 为%s时按读取域剥掉路径前缀反推 objectKey', async (_label, publicBaseUrl, fileUrl) => {
    await uploadBundleZip(
      { files: [{ orderNo: 'O-1', fileName: 'a.cdr', fileUrl }], bundleId: 'b1' },
      {
        mockMode: false,
        now,
        env: { ...configuredEnv, OSS_PUBLIC_BASE_URL: publicBaseUrl } as NodeJS.ProcessEnv,
      },
    );
    expect(getStreamMock.mock.calls.map((c) => c[0])).toEqual(['design/o1/i1/cdr-1.cdr']);
  });

  it('拒绝 design/ 前缀之外的文件 URL，且不发起任何 OSS 调用', async () => {
    await expect(
      uploadBundleZip(
        {
          files: [
            {
              orderNo: 'O-1',
              fileName: 'a.cdr',
              fileUrl:
                'https://my-bucket.oss-cn-shenzhen.aliyuncs.com/salary/secret.csv',
            },
          ],
          bundleId: 'b1',
        },
        { mockMode: false, now, env: configuredEnv },
      ),
    ).rejects.toBeInstanceOf(CdrZipError);
    expect(ossCtorMock).not.toHaveBeenCalled();
    expect(putStreamMock).not.toHaveBeenCalled();
  });

  it('putStream 失败（如 bundles/* 403）→ 抛原错误且不签 URL，无 unhandled rejection', async () => {
    putStreamMock.mockRejectedValue(new Error('AccessDenied: bundles'));
    await expect(
      uploadBundleZip(
        {
          files: [
            { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-1.cdr') },
          ],
          bundleId: 'b1',
        },
        { mockMode: false, now, env: configuredEnv },
      ),
    ).rejects.toThrow('AccessDenied: bundles');
    expect(signatureUrlMock).not.toHaveBeenCalled();
  });

  it('单个设计文件拉取失败 → abort 打包并抛出', async () => {
    getStreamMock.mockRejectedValue(new Error('NoSuchKey'));
    await expect(
      uploadBundleZip(
        {
          files: [
            { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-1.cdr') },
          ],
          bundleId: 'b1',
        },
        { mockMode: false, now, env: configuredEnv },
      ),
    ).rejects.toThrow('NoSuchKey');
    expect(archiveMock.abort).toHaveBeenCalled();
    expect(signatureUrlMock).not.toHaveBeenCalled();
  });
});
