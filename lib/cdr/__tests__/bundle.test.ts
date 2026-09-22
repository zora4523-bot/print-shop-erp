import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { findMany: vi.fn() },
    orderItemDesign: { findMany: vi.fn() },
    $transaction: vi.fn(),
    // 链接有效期现在从 Setting 读（cdr_link_expire_hours）
    setting: { findUnique: vi.fn() },
    designBundle: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

const { uploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('../zip', () => ({ uploadBundleZip: uploadMock }));

const { enqueueBackgroundJobMock } = vi.hoisted(() => ({
  enqueueBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('@/lib/background-jobs/repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));

import {
  BundleExpiredError,
  BundleNotFoundError,
  CdrBundleError,
  consumeBundle,
  createBundle,
  enqueueBundle,
  processQueuedBundle,
  listEligibleOrders,
  listRecentBundles,
} from '../bundle';
import { hashBundleAccessToken } from '../access-token';

beforeEach(() => {
  Object.values(dbMock.order).forEach((fn) => fn.mockReset());
  Object.values(dbMock.designBundle).forEach((fn) => fn.mockReset());
  uploadMock.mockReset();
  enqueueBackgroundJobMock.mockReset();
  dbMock.$transaction.mockReset().mockImplementation(async (callback) =>
    callback(dbMock),
  );
  // Default: bundle.update succeeds
  dbMock.designBundle.update.mockResolvedValue({});
  dbMock.designBundle.delete.mockResolvedValue({});
  // 默认「没有配置行」→ 退回内置默认 24 小时，即这些用例原本的行为。
  dbMock.setting.findUnique.mockReset().mockResolvedValue(null);
});

describe('listEligibleOrders', () => {
  it('查 submittedAt 在 [from, to+1) 闭区间且至少 1 个 CDR design 的工单', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listEligibleOrders({ from: '2026-05-05' });
    const args = dbMock.order.findMany.mock.calls[0][0];
    // [Shanghai 5/5 0:00, 5/6 0:00) = UTC [5/4 16:00, 5/5 16:00)
    expect((args.where.submittedAt.gte as Date).toISOString()).toBe(
      '2026-05-04T16:00:00.000Z',
    );
    expect((args.where.submittedAt.lt as Date).toISOString()).toBe(
      '2026-05-05T16:00:00.000Z',
    );
    expect(args.where.items).toEqual({
      some: { designs: { some: { fileType: 'CDR' } } },
    });
    expect(args.orderBy).toEqual({ submittedAt: 'asc' });
  });

  it('to 不传 → 默认 = from（单日）', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listEligibleOrders({ from: '2026-05-05' });
    const args = dbMock.order.findMany.mock.calls[0][0];
    // 单日窗口正好 24h
    expect(
      (args.where.submittedAt.lt as Date).getTime() -
        (args.where.submittedAt.gte as Date).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
  });

  it('to 多日 → 区间扩到 to 当日结束（半开 lt = to+1d 0:00）', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listEligibleOrders({ from: '2026-05-01', to: '2026-05-05' });
    const args = dbMock.order.findMany.mock.calls[0][0];
    expect((args.where.submittedAt.gte as Date).toISOString()).toBe(
      '2026-04-30T16:00:00.000Z',
    );
    // 5/5 当日结束 = 5/6 0:00 Shanghai = 5/5 16:00 UTC
    expect((args.where.submittedAt.lt as Date).toISOString()).toBe(
      '2026-05-05T16:00:00.000Z',
    );
  });

  it('cdrCount = 所有 item.designs[].length 之和', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        orderNo: 'O-1',
        customerRef: '苹果福',
        submittedAt: new Date('2026-05-05T08:00:00Z'),
        items: [
          { designs: [{ id: 'd1' }, { id: 'd2' }] },
          { designs: [{ id: 'd3' }] },
        ],
      },
    ]);
    const r = await listEligibleOrders({ from: '2026-05-05' });
    expect(r).toEqual([
      {
        id: 'o1',
        orderNo: 'O-1',
        customerRef: '苹果福',
        submittedAt: new Date('2026-05-05T08:00:00Z'),
        cdrCount: 3,
      },
    ]);
  });

  it('非法 YYYY-MM-DD（如 2026-02-31）→ throw CdrBundleError', async () => {
    await expect(
      listEligibleOrders({ from: '2026-02-31' }),
    ).rejects.toBeInstanceOf(CdrBundleError);
    await expect(
      listEligibleOrders({ from: 'not-a-date' }),
    ).rejects.toBeInstanceOf(CdrBundleError);
  });
});

describe('createBundle', () => {
  function setupOrders(orders: Array<{
    id: string;
    orderNo: string;
    designs: Array<{ id: string; fileName: string; fileUrl: string }>;
  }>) {
    dbMock.order.findMany.mockResolvedValue(
      orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        items: [{ designs: o.designs }],
      })),
    );
  }

  it('orderIds 空 → CdrBundleError', async () => {
    await expect(
      createBundle(
        { from: '2026-05-05', orderIds: [], baseUrl: 'http://localhost:3000' },
        { id: 'u1' },
      ),
    ).rejects.toBeInstanceOf(CdrBundleError);
  });

  it('某 orderId 不在窗口内 / 不存在 → CdrBundleError', async () => {
    dbMock.order.findMany.mockResolvedValue([]); // 一个都没找到
    await expect(
      createBundle(
        {
          from: '2026-05-05',
          orderIds: ['ghost'],
          baseUrl: 'http://localhost:3000',
        },
        { id: 'u1' },
      ),
    ).rejects.toThrow(/不在所选日期窗口/);
  });

  it('找到工单但全部无 CDR → CdrBundleError + 占位 row 已 delete', async () => {
    setupOrders([{ id: 'o1', orderNo: 'O-1', designs: [] }]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    await expect(
      createBundle(
        {
          from: '2026-05-05',
          orderIds: ['o1'],
          baseUrl: 'http://localhost:3000',
        },
        { id: 'u1' },
      ),
    ).rejects.toThrow(/没有 CDR 设计文件/);
    // 占位 bundle 还没创建（CDR 检查在 create 之前）
    expect(dbMock.designBundle.create).not.toHaveBeenCalled();
  });

  it('链接有效期来自 Setting：占位过期时间和传给 zip 的时长都跟着走', async () => {
    // 「Setting 表只写不读」的回归门禁：之前 24 小时在 bundle.ts 和 zip.ts
    // 里各写死一份（占位行、预签 URL、mock 路径共三处），
    // seed 里的 cdr_link_expire_hours 改成什么都没有效果。
    dbMock.setting.findUnique.mockResolvedValue({ value: { hours: 72 } });
    setupOrders([
      {
        id: 'o1',
        orderNo: 'O-1',
        designs: [{ id: 'd1', fileName: 'a.cdr', fileUrl: 'https://x/a.cdr' }],
      },
    ]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    uploadMock.mockResolvedValue({
      zipFileUrl: 'mock://bundle/b1.zip',
      expiresAt: new Date('2026-05-08T00:00:00Z'),
      isMock: true,
    });

    const before = Date.now();
    await createBundle(
      { from: '2026-05-05', orderIds: ['o1'], baseUrl: 'https://erp.example.com' },
      { id: 'u1' },
    );

    // ① 传给 OSS 适配层的时长
    expect(uploadMock.mock.calls[0][1]).toEqual({ expireHours: 72 });

    // ② 占位行的过期时间也用同一个阈值（打包失败时留下的就是这一行）
    const placeholderExpiry = (
      dbMock.designBundle.create.mock.calls[0][0].data.expiresAt as Date
    ).getTime();
    expect(placeholderExpiry - before).toBeGreaterThanOrEqual(72 * 3600_000 - 5_000);
    expect(placeholderExpiry - before).toBeLessThanOrEqual(72 * 3600_000 + 5_000);
  });

  it('happy path：write DesignBundle + 调 uploadBundleZip + 二次 update zipFileUrl/downloadUrl/expiresAt', async () => {
    setupOrders([
      {
        id: 'o1',
        orderNo: 'O-1',
        designs: [
          { id: 'd1', fileName: 'a.cdr', fileUrl: 'https://x/a.cdr' },
          { id: 'd2', fileName: 'b.cdr', fileUrl: 'https://x/b.cdr' },
        ],
      },
    ]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    uploadMock.mockResolvedValue({
      zipFileUrl: 'mock://bundle/b1.zip',
      expiresAt: new Date('2026-05-06T00:00:00Z'),
      isMock: true,
    });
    const r = await createBundle(
      {
        from: '2026-05-05',
        orderIds: ['o1'],
        baseUrl: 'https://erp.example.com',
      },
      { id: 'u1' },
    );
    expect(r.bundleId).toBe('b1');
    expect(r.fileCount).toBe(2);
    expect(r.isMock).toBe(true);
    // 绝对 URL（base 由调用方提供，通常 action 层从 request headers 推；
    // Codex round 119 high → round 121 medium）
    expect(r.downloadUrl).toMatch(/^https:\/\/erp\.example\.com\/api\/cdr\/bundles\/[A-Za-z0-9_-]{43}$/);
    expect(r.relativePath).toMatch(/^\/api\/cdr\/bundles\/[A-Za-z0-9_-]{43}$/);

    // create 第一次：占位 row（zipFileUrl/downloadUrl 空字符串）
    const createData = dbMock.designBundle.create.mock.calls[0][0].data;
    expect(createData.createdById).toBe('u1');
    expect(createData.orderIds).toEqual(['o1']);
    expect(createData.designIds).toEqual(['d1', 'd2']);
    expect(createData.zipFileUrl).toBe('');

    // upload 调用：files 数组
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uploadInput = uploadMock.mock.calls[0][0] as {
      bundleId: string;
      files: Array<{ orderNo: string; fileName: string; fileUrl: string }>;
    };
    expect(uploadInput.bundleId).toBe('b1');
    expect(uploadInput.files).toHaveLength(2);
    expect(uploadInput.files[0]!.orderNo).toBe('O-1');

    // update 第二次：写真 zipFileUrl + downloadUrl + expiresAt
    const updateCall = dbMock.designBundle.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'b1' });
    expect(updateCall.data.zipFileUrl).toBe('mock://bundle/b1.zip');
    expect(updateCall.data.downloadUrl).toBe('');
    expect(updateCall.data.expiresAt).toEqual(new Date('2026-05-06T00:00:00Z'));
  });

  it('baseUrl 末尾 / 自动剥（避免 erp.example.com//api/...）', async () => {
    setupOrders([
      {
        id: 'o1',
        orderNo: 'O-1',
        designs: [{ id: 'd1', fileName: 'a.cdr', fileUrl: 'https://x' }],
      },
    ]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    uploadMock.mockResolvedValue({
      zipFileUrl: 'mock://bundle/b1.zip',
      expiresAt: new Date('2026-05-06T00:00:00Z'),
      isMock: true,
    });
    const r = await createBundle(
      {
        from: '2026-05-05',
        orderIds: ['o1'],
        baseUrl: 'https://erp.example.com///',
      },
      { id: 'u1' },
    );
    expect(r.downloadUrl).toMatch(/^https:\/\/erp\.example\.com\/api\/cdr\/bundles\/[A-Za-z0-9_-]{43}$/);
  });

  it('uploadBundleZip 失败 → 删占位 + CdrBundleError 友好文案', async () => {
    setupOrders([
      {
        id: 'o1',
        orderNo: 'O-1',
        designs: [{ id: 'd1', fileName: 'a.cdr', fileUrl: 'https://x' }],
      },
    ]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    uploadMock.mockRejectedValue(new Error('AccessDenied: 403'));

    await expect(
      createBundle(
        {
          from: '2026-05-05',
          orderIds: ['o1'],
          baseUrl: 'http://localhost:3000',
        },
        { id: 'u1' },
      ),
    ).rejects.toThrow(/CDR 打包上传失败：AccessDenied/);
    // 占位行清理
    expect(dbMock.designBundle.delete).toHaveBeenCalledWith({
      where: { id: 'b1' },
    });
    consoleSpy.mockRestore();
  });
});

describe('enqueueBundle durable path', () => {
  it('persists bundle and HEAVY job in one transaction', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        orderNo: 'O-1',
        items: [
          {
            designs: [
              { id: 'd1', fileName: 'a.cdr', fileUrl: 'https://x/a.cdr' },
            ],
          },
        ],
      },
    ]);
    dbMock.designBundle.create.mockResolvedValue({ id: 'b1' });
    dbMock.designBundle.update.mockResolvedValue({});
    enqueueBackgroundJobMock.mockResolvedValue({
      job: { id: 'job-1' },
      created: true,
      requeued: false,
    });

    await expect(
      enqueueBundle(
        {
          from: '2026-05-05',
          orderIds: ['o1'],
          baseUrl: 'https://erp.example.com',
        },
        { id: 'u1' },
      ),
    ).resolves.toMatchObject({
      bundleId: 'b1',
      jobId: 'job-1',
      fileCount: 1,
    });

    expect(enqueueBackgroundJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CDR_BUNDLE',
        queue: 'HEAVY',
        dedupeKey: 'cdr-bundle:b1',
        payload: { bundleId: 'b1' },
      }),
      dbMock,
    );
    expect(dbMock.designBundle.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { backgroundJobId: 'job-1' },
    });
  });
});

describe('consumeBundle', () => {
  const token = 'A'.repeat(43);
  const tokenHash = hashBundleAccessToken(token);
  it('id 不存在 → BundleNotFoundError', async () => {
    dbMock.designBundle.findUnique.mockResolvedValue(null);
    await expect(consumeBundle('B'.repeat(43))).rejects.toBeInstanceOf(
      BundleNotFoundError,
    );
  });

  it('已过期 → BundleExpiredError', async () => {
    dbMock.designBundle.findUnique.mockResolvedValue({
      id: 'b1',
      accessTokenHash: tokenHash,
      revokedAt: null,
      zipObjectKey: 'bundles/b1.zip',
      status: 'READY',
      zipFileUrl: 'mock://bundle/b1.zip',
      expiresAt: new Date('2026-05-04T00:00:00Z'), // 已过
      downloadCount: 0,
    });
    await expect(
      consumeBundle(token, new Date('2026-05-05T00:00:00Z')),
    ).rejects.toBeInstanceOf(BundleExpiredError);
  });

  it('未过期 → 返 row + 增 downloadCount（best-effort）', async () => {
    dbMock.designBundle.findUnique.mockResolvedValue({
      id: 'b1',
      accessTokenHash: tokenHash,
      revokedAt: null,
      zipObjectKey: 'bundles/b1.zip',
      status: 'READY',
      zipFileUrl: 'mock://bundle/b1.zip',
      expiresAt: new Date('2026-05-06T00:00:00Z'),
      downloadCount: 5,
    });
    const r = await consumeBundle(token, new Date('2026-05-05T00:00:00Z'));
    expect(r.id).toBe('b1');
    expect(dbMock.designBundle.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { downloadCount: { increment: 1 } },
    });
  });

  it('downloadCount 自增写入失败不影响下载（best-effort）', async () => {
    dbMock.designBundle.findUnique.mockResolvedValue({
      id: 'b1',
      accessTokenHash: tokenHash,
      revokedAt: null,
      zipObjectKey: 'bundles/b1.zip',
      status: 'READY',
      zipFileUrl: 'https://oss/b1.zip',
      expiresAt: new Date('2026-05-06T00:00:00Z'),
      downloadCount: 0,
    });
    dbMock.designBundle.update.mockRejectedValue(new Error('connection lost'));
    await expect(
      consumeBundle(token, new Date('2026-05-05T00:00:00Z')),
    ).resolves.toBeDefined();
  });
});

describe('listRecentBundles', () => {
  it('orderBy createdAt desc + take limit + count fold', async () => {
    dbMock.designBundle.findMany.mockResolvedValue([
      {
        id: 'b1',
        dateRangeFrom: new Date('2026-05-04T16:00:00Z'),
        dateRangeTo: new Date('2026-05-05T16:00:00Z'),
        orderIds: ['o1', 'o2'],
        designIds: ['d1', 'd2', 'd3'],
        zipFileUrl: 'mock://bundle/b1.zip',
        downloadUrl: '/api/cdr/bundles/b1',
        expiresAt: new Date('2026-05-06T00:00:00Z'),
        downloadCount: 2,
        createdById: 'u1',
        createdAt: new Date('2026-05-05T10:00:00Z'),
        createdBy: { displayName: '车间张主管' },
      },
    ]);
    const r = await listRecentBundles(20);
    expect(r).toHaveLength(1);
    expect(r[0]!.orderIds).toEqual(['o1', 'o2']);
    expect(r[0]!.orderCount).toBe(2);
    expect(r[0]!.fileCount).toBe(3);
    expect(r[0]!.createdByName).toBe('车间张主管');
    const args = dbMock.designBundle.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBe(20);
  });
});

it('never retries a terminal FAILED bundle into READY', async () => {
  dbMock.designBundle.findUnique.mockResolvedValue({ id: 'dead', designIds: ['d1'], status: 'FAILED' });
  await expect(processQueuedBundle('dead')).rejects.toThrow('失败');
  expect(uploadMock).not.toHaveBeenCalled();
  expect(dbMock.designBundle.update).not.toHaveBeenCalled();
});

it('does not overwrite a terminal transition during CDR upload', async () => {
  dbMock.designBundle.findUnique.mockResolvedValue({ id: 'bundle', status: 'PENDING', designIds: ['design'] });
  dbMock.orderItemDesign.findMany.mockResolvedValue([{ id: 'design', fileName: 'a.cdr', fileUrl: 'mock://a', orderItem: { order: { orderNo: 'GD-1' } } }]);
  uploadMock.mockResolvedValue({ zipFileUrl: 'mock://zip', expiresAt: new Date(), isMock: true });
  dbMock.designBundle.updateMany.mockResolvedValue({ count: 0 });
  await expect(processQueuedBundle('bundle')).rejects.toThrow('状态已变更');
  expect(dbMock.designBundle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bundle', status: 'PENDING' } }));
  expect(dbMock.designBundle.update).not.toHaveBeenCalled();
});
