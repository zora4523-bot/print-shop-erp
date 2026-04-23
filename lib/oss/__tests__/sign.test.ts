import { describe, it, expect } from 'vitest';
import { signDesignUpload, OssNotWiredError } from '../sign';
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

describe('signDesignUpload — not-configured branch', () => {
  it('returns { status: not-configured } with missing keys when env is empty', async () => {
    const r = await signDesignUpload(validParams, {} as unknown as NodeJS.ProcessEnv);
    expect(r.status).toBe('not-configured');
    if (r.status === 'not-configured') {
      expect(r.missing).toContain('OSS_ACCESS_KEY_ID');
      expect(r.message).toMatch(/尚未配置/);
    }
  });

  it('never throws OssNotWiredError from the not-configured path', async () => {
    // Critical contract: a missing-env environment must NEVER hit the
    // STS stub. The UI relies on `not-configured` as a stable state, not
    // an exception.
    await expect(
      signDesignUpload(validParams, {} as unknown as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({ status: 'not-configured' });
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
  });

  it('rejects files that exceed the per-type size limit', async () => {
    const r = await signDesignUpload(
      { ...validParams, fileSize: 11 * 1024 * 1024 }, // image limit is 10 MiB
      configuredEnv,
    );
    expect(r.status).toBe('invalid');
  });

  it('accepts valid CDR (under CDR limit, .cdr extension)', async () => {
    // Even when the validation passes, signing itself is still stubbed
    // out — the call should throw OssNotWiredError, not return ok.
    await expect(
      signDesignUpload(
        {
          ...validParams,
          fileType: DesignFileType.CDR,
          fileName: 'art.cdr',
          fileSize: 90 * 1024 * 1024,
          mimeType: 'application/octet-stream',
        },
        configuredEnv,
      ),
    ).rejects.toBeInstanceOf(OssNotWiredError);
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
      ).rejects.toBeInstanceOf(OssNotWiredError);
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
      ).rejects.toBeInstanceOf(OssNotWiredError);
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

describe('signDesignUpload — not-wired error', () => {
  it('throws OssNotWiredError when env is complete but the STS stub is hit', async () => {
    // This is the contract we owe: env set ≠ "we've shipped signing".
    // When someone flips the last env var, they'll hit this error and
    // know they still need to wire ali-oss.
    await expect(signDesignUpload(validParams, configuredEnv)).rejects.toBeInstanceOf(
      OssNotWiredError,
    );
  });

  it('the not-wired error carries a hint about ali-oss / lib/oss/sign.ts', async () => {
    try {
      await signDesignUpload(validParams, configuredEnv);
    } catch (err) {
      expect(err).toBeInstanceOf(OssNotWiredError);
      if (err instanceof OssNotWiredError) {
        expect(err.message).toMatch(/ali-oss/);
        expect(err.message).toMatch(/lib\/oss\/sign\.ts/);
      }
    }
  });
});
