import { describe, it, expect } from 'vitest';
import { isMockMode, uploadBundleZip } from '../zip';

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
        CDR_BUNDLE_MOCK_MODE: 'false',
        OSS_ACCESS_KEY_ID: 'k',
        OSS_ACCESS_KEY_SECRET: 's',
        OSS_STS_ROLE_ARN: 'arn',
        OSS_BUCKET: 'b',
        OSS_REGION: 'oss-cn-shenzhen',
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
});

describe('uploadBundleZip', () => {
  it('mock-mode 走占位路径，不抛 OssNotWiredError', async () => {
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
  });

  it('非 mock-mode → 当前 throws OssNotWiredError（STS SDK 接入前）', async () => {
    await expect(
      uploadBundleZip(
        {
          files: [{ orderNo: 'O-1', fileName: 'a.cdr', fileUrl: 'https://x' }],
          bundleId: 'b1',
        },
        { mockMode: false },
      ),
    ).rejects.toThrow();
  });
});
