import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 真实 archiver + 假 OSS client：zip.test.ts mock 了 archiver、finalize
// 直接 resolve，测不出「PUT 失败 / GET 源流中断 → finalize 永不 settle →
// HEAVY 槽被占死」。这里只替换网络层，压缩与背压都是真的。
const { getStreamMock, putStreamMock } = vi.hoisted(() => ({
  getStreamMock: vi.fn(),
  putStreamMock: vi.fn(),
}));
vi.mock('ali-oss', () => {
  class MockOSS {
    getStream = getStreamMock;
    putStream = putStreamMock;
  }
  return { default: MockOSS };
});

import { uploadBundleZip } from '../zip';

const configuredEnv = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;

const designUrl = (name: string) =>
  `https://my-bucket.oss-cn-shenzhen.aliyuncs.com/design/o1/i1/${name}`;

// 不可压缩的随机数据，远大于 archiver 读写两侧各 1MB 的缓冲：
// 下游一停止消费，压缩就被背压卡住，不能靠缓冲"蒙混"结束。
const BIG_FILE = randomBytes(3 * 1024 * 1024);
const CHUNK = 64 * 1024;
const SETTLE_DEADLINE_MS = 3_000;

function chunkedStream(buf: Buffer, cutAt?: number): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (cutAt !== undefined && offset >= cutAt) {
        // 模拟 OSS socket 被 agentkeepalive 销毁：不报错、不 end，直接 close。
        this.destroy();
        return;
      }
      if (offset >= buf.length) {
        this.push(null);
        return;
      }
      this.push(buf.subarray(offset, offset + CHUNK));
      offset += CHUNK;
    },
  });
}

function collectingPut() {
  const received: Buffer[] = [];
  const put = (_key: string, stream: Readable) =>
    new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => received.push(chunk));
      stream.on('end', () => resolve({ name: 'bundles/b1.zip' }));
      stream.on('error', reject);
    });
  return { put, received };
}

// 在限定时间内必须 settle；超时就以固定文案 reject，让"挂死"成为可断言的失败。
function withinDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`uploadBundleZip 在 ${SETTLE_DEADLINE_MS}ms 内未结束`)),
      SETTLE_DEADLINE_MS,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const twoFiles = {
  files: [
    { orderNo: 'O-1', fileName: 'a.cdr', fileUrl: designUrl('cdr-1.cdr') },
    { orderNo: 'O-2', fileName: 'b.cdr', fileUrl: designUrl('cdr-2.cdr') },
  ],
  bundleId: 'b1',
};
const realOpts = {
  mockMode: false,
  now: new Date('2026-07-05T00:00:00Z'),
  env: configuredEnv,
};

beforeEach(() => {
  getStreamMock.mockReset();
  putStreamMock.mockReset();
});

describe('uploadBundleZip — 真实 archiver 流式失败必须及时结束', () => {
  it('成功路径：整包写入 PUT，ZIP 内含各条目', async () => {
    const { put, received } = collectingPut();
    putStreamMock.mockImplementation(put);
    getStreamMock.mockImplementation(async () => ({
      stream: chunkedStream(Buffer.from('cdr-bytes')),
    }));

    const result = await withinDeadline(uploadBundleZip(twoFiles, realOpts));

    expect(result.zipObjectKey).toBe('bundles/b1.zip');
    const zip = Buffer.concat(received);
    expect(zip.includes('O-1/a.cdr')).toBe(true);
    expect(zip.includes('O-2/b.cdr')).toBe(true);
  });

  it('PUT 中途失败 → 及时 reject 原错误，并销毁正在读的设计文件流', async () => {
    const sources: Readable[] = [];
    getStreamMock.mockImplementation(async () => {
      const stream = chunkedStream(BIG_FILE);
      sources.push(stream);
      return { stream };
    });
    putStreamMock.mockImplementation(
      (_key: string, stream: Readable) =>
        new Promise((_, reject) => {
          stream.once('data', () => {
            stream.pause();
            reject(new Error('ResponseTimeoutError: bundles/b1.zip'));
          });
        }),
    );

    await expect(
      withinDeadline(uploadBundleZip(twoFiles, realOpts)),
    ).rejects.toThrow('ResponseTimeoutError: bundles/b1.zip');
    expect(sources.every((s) => s.destroyed)).toBe(true);
  });

  it('GET 源流未读完就被关闭 → 及时 reject，不把半截文件当成功', async () => {
    const { put } = collectingPut();
    putStreamMock.mockImplementation(put);
    getStreamMock.mockImplementation(async () => ({
      stream: chunkedStream(BIG_FILE, CHUNK * 4),
    }));

    await expect(
      withinDeadline(uploadBundleZip(twoFiles, realOpts)),
    ).rejects.toThrow('设计文件读取中断');
  });

  it('租约丢失（signal abort）且 PUT 停滞 → 及时以 abort 原因 reject', async () => {
    const controller = new AbortController();
    getStreamMock.mockImplementation(async () => ({
      stream: chunkedStream(BIG_FILE),
    }));
    putStreamMock.mockImplementation(
      (_key: string, stream: Readable) =>
        new Promise(() => {
          stream.once('data', () => {
            stream.pause();
            controller.abort(new Error('CDR bundle lease lost'));
          });
        }),
    );

    await expect(
      withinDeadline(
        uploadBundleZip(twoFiles, { ...realOpts, signal: controller.signal }),
      ),
    ).rejects.toThrow('CDR bundle lease lost');
  });

  it('设计文件逐个打开：上一个读完才发起下一个 GET，排队的 socket 不会空闲超时', async () => {
    const { put } = collectingPut();
    putStreamMock.mockImplementation(put);
    const events: string[] = [];
    getStreamMock.mockImplementation(async (key: string) => {
      events.push(`get:${key}`);
      const stream = chunkedStream(Buffer.alloc(CHUNK * 3, 1));
      stream.on('end', () => events.push(`end:${key}`));
      return { stream };
    });

    await withinDeadline(uploadBundleZip(twoFiles, realOpts));

    expect(events).toEqual([
      'get:design/o1/i1/cdr-1.cdr',
      'end:design/o1/i1/cdr-1.cdr',
      'get:design/o1/i1/cdr-2.cdr',
      'end:design/o1/i1/cdr-2.cdr',
    ]);
  });

  it('流式 OSS 调用显式放宽超时，不受 ali-oss 默认 60 秒总时长限制', async () => {
    const { put } = collectingPut();
    putStreamMock.mockImplementation(put);
    getStreamMock.mockImplementation(async () => ({
      stream: chunkedStream(Buffer.from('cdr-bytes')),
    }));

    await withinDeadline(uploadBundleZip(twoFiles, realOpts));

    const [putKey, , putOptions] = putStreamMock.mock.calls[0] as [
      string,
      unknown,
      { timeout: [number, number] },
    ];
    expect(putKey).toBe('bundles/b1.zip');
    // [建连超时, 响应超时]：PUT 的响应要等整包传完，必须远大于 60 秒。
    expect(putOptions.timeout[0]).toBe(60_000);
    expect(putOptions.timeout[1]).toBeGreaterThanOrEqual(60 * 60_000);
    for (const call of getStreamMock.mock.calls) {
      const getOptions = call[1] as { timeout: [number, number] };
      expect(getOptions.timeout[0]).toBe(60_000);
      expect(getOptions.timeout[1]).toBeGreaterThan(60_000);
    }
  });
});
