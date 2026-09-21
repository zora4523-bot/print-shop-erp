import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, OrderStatus, DesignFileType } from '../../generated/prisma/enums';

const { dbMock, txMock, headMock, ossCtorMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    orderItem: { findFirst: vi.fn() },
    orderItemDesign: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    orderLog: { create: vi.fn() },
    order: { update: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      orderItem: { findFirst: vi.fn() },
      orderItemDesign: { findUnique: vi.fn() },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    },
    headMock: vi.fn(),
    ossCtorMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('ali-oss', () => {
  class MockOSS {
    constructor(opts: unknown) {
      ossCtorMock(opts);
    }
    head = headMock;
  }
  return { default: MockOSS };
});

import {
  OrderDesignError,
  assertCanUploadDesign,
  recordOrderItemDesign,
  removeOrderItemDesign,
} from '../order-design';

const configuredEnv = {
  OSS_ACCESS_KEY_ID: 'ak',
  OSS_ACCESS_KEY_SECRET: 'sk',
  OSS_STS_ROLE_ARN: 'acs:ram::111:role/uploader',
  OSS_BUCKET: 'my-bucket',
  OSS_REGION: 'oss-cn-shenzhen',
} as unknown as NodeJS.ProcessEnv;

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const goodKey = `design/o1/i1/image-${UUID}.jpg`;

const salesActor = { id: 'sales1', role: Role.SALES };
const ownerActor = { id: 'owner1', role: Role.ADMIN };

const baseInput = {
  orderId: 'o1',
  orderItemId: 'i1',
  objectKey: goodKey,
  fileType: DesignFileType.IMAGE,
  fileName: 'design.jpg',
};

const draftItem = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  order: {
    id: 'o1',
    status: OrderStatus.DRAFT,
    submitterId: 'sales1',
    ...over,
  },
});

const headOk = (contentLength: string) => ({
  res: { status: 200, headers: { 'content-length': contentLength } },
});

beforeEach(() => {
  dbMock.orderItem.findFirst.mockReset().mockResolvedValue(draftItem());
  dbMock.orderItemDesign.findUnique.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  txMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  txMock.orderItem.findFirst.mockReset().mockResolvedValue(draftItem());
  txMock.orderItemDesign.create.mockReset().mockResolvedValue({ id: 'd1' });
  txMock.orderItemDesign.delete.mockReset().mockResolvedValue({ id: 'd1' });
  txMock.orderItemDesign.findUnique.mockReset();
  txMock.orderLog.create.mockReset().mockResolvedValue({ id: 'log1' });
  headMock.mockReset().mockResolvedValue(headOk('2048'));
  ossCtorMock.mockReset();
});

describe('assertCanUploadDesign', () => {
  it('blocks uploads while a modification approval is pending', async () => {
    const item = draftItem();
    dbMock.orderItem.findFirst.mockResolvedValue({
      ...item,
      order: { ...item.order, _count: { changeRequests: 1 } },
    });
    await expect(
      assertCanUploadDesign('order-1', 'item-1', salesActor),
    ).rejects.toThrow('待审批');
  });


  it('款式不存在 / 非 DRAFT / 非本人 → 拒绝；ADMIN 放行', async () => {
    dbMock.orderItem.findFirst.mockResolvedValue(null);
    await expect(
      assertCanUploadDesign('o1', 'i1', salesActor),
    ).rejects.toBeInstanceOf(OrderDesignError);

    dbMock.orderItem.findFirst.mockResolvedValue(
      draftItem({ status: OrderStatus.SUBMITTED }),
    );
    await expect(assertCanUploadDesign('o1', 'i1', salesActor)).rejects.toThrow(
      /草稿或驳回状态/,
    );

    dbMock.orderItem.findFirst.mockResolvedValue(
      draftItem({ submitterId: 'someone-else' }),
    );
    await expect(assertCanUploadDesign('o1', 'i1', salesActor)).rejects.toThrow(
      /自己创建/,
    );
    await expect(
      assertCanUploadDesign('o1', 'i1', ownerActor),
    ).resolves.toBeUndefined();
  });
});

describe('recordOrderItemDesign', () => {
  it('happy path：锁 + fresh-read + HEAD 权威 size 写行 + OrderLog（同 tx）', async () => {
    await recordOrderItemDesign(baseInput, salesActor, configuredEnv);

    expect(headMock).toHaveBeenCalledWith(goodKey);
    // 与 submit/cancel 同一把 order-cascade advisory lock
    const lockSql = txMock.$executeRaw.mock.calls[0];
    expect(lockSql[0].join('?')).toContain('pg_advisory_xact_lock');
    expect(lockSql[1]).toBe('print-shop-erp:order-cascade:o1');
    // fileSize 来自 HEAD Content-Length，不是客户端申报
    expect(txMock.orderItemDesign.create.mock.calls[0][0].data).toMatchObject({
      orderItemId: 'i1',
      fileType: DesignFileType.IMAGE,
      fileUrl: `https://my-bucket.oss-cn-shenzhen.aliyuncs.com/${goodKey}`,
      fileName: 'design.jpg',
      fileSize: BigInt(2048),
      uploadedBy: 'sales1',
    });
    expect(txMock.orderLog.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'o1',
      operatorId: 'sales1',
      action: 'UPDATE',
      remark: '上传设计图：design.jpg',
    });
  });

  it('TOCTOU：预检时 DRAFT、锁内 fresh-read 已 SUBMITTED → 拒绝且不写行', async () => {
    dbMock.orderItem.findFirst.mockResolvedValue(draftItem()); // 预检通过
    txMock.orderItem.findFirst.mockResolvedValue(
      draftItem({ status: OrderStatus.SUBMITTED }), // 锁内已被提交
    );
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/草稿或驳回状态/);
    expect(txMock.orderItemDesign.create).not.toHaveBeenCalled();
  });

  it('OSS 未配置 → OrderDesignError', async () => {
    await expect(
      recordOrderItemDesign(baseInput, salesActor, {} as NodeJS.ProcessEnv),
    ).rejects.toBeInstanceOf(OrderDesignError);
    expect(headMock).not.toHaveBeenCalled();
  });

  it('objectKey 指向别的工单/款式/前缀 → 拒绝', async () => {
    for (const bad of [
      `design/o2/i1/image-${UUID}.jpg`, // 别的工单
      `design/o1/i2/image-${UUID}.jpg`, // 别的款式
      `bundles/x.zip`, // 完全别的前缀
      `design/o1/i1/../../../etc`, // 注入
    ]) {
      await expect(
        recordOrderItemDesign(
          { ...baseInput, objectKey: bad },
          salesActor,
          configuredEnv,
        ),
      ).rejects.toBeInstanceOf(OrderDesignError);
    }
    expect(txMock.orderItemDesign.create).not.toHaveBeenCalled();
  });

  it('objectKey 扩展名与 fileType 不匹配 → 拒绝（CDR 声明配 .jpg 路径）', async () => {
    await expect(
      recordOrderItemDesign(
        { ...baseInput, fileType: DesignFileType.CDR },
        salesActor,
        configuredEnv,
      ),
    ).rejects.toBeInstanceOf(OrderDesignError);
  });

  it('HEAD 失败（对象没传上去）→ 拒绝且不写库', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    headMock.mockRejectedValue(new Error('NoSuchKey'));
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/尚未上传成功/);
    expect(txMock.orderItemDesign.create).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('HEAD 实际大小超过类型上限 → 拒绝（申报小文件、实传大文件被抓）', async () => {
    headMock.mockResolvedValue(headOk(String(11 * 1024 * 1024))); // IMAGE 上限 10 MiB
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/超过大小上限/);
    expect(txMock.orderItemDesign.create).not.toHaveBeenCalled();
  });

  it('HEAD 缺 Content-Length → 拒绝', async () => {
    headMock.mockResolvedValue({ res: { status: 200, headers: {} } });
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/无法确认/);
  });
});

describe('removeOrderItemDesign', () => {
  const designRow = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    fileName: 'design.jpg',
    orderItem: {
      orderId: 'o1',
      order: { status: OrderStatus.DRAFT, submitterId: 'sales1', ...over },
    },
  });

  beforeEach(() => {
    dbMock.orderItemDesign.findUnique.mockResolvedValue({
      id: 'd1',
      orderItem: { orderId: 'o1' },
    });
    txMock.orderItemDesign.findUnique.mockResolvedValue(designRow());
  });

  it('happy path：锁内 fresh-read → 删行 + OrderLog，返回 orderId', async () => {
    const r = await removeOrderItemDesign('d1', salesActor);
    expect(r.orderId).toBe('o1');
    expect(txMock.$executeRaw.mock.calls[0][1]).toBe(
      'print-shop-erp:order-cascade:o1',
    );
    expect(txMock.orderItemDesign.delete).toHaveBeenCalledWith({
      where: { id: 'd1' },
    });
    expect(txMock.orderLog.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'o1',
      action: 'UPDATE',
      remark: '删除设计图：design.jpg',
    });
  });

  it('设计图不存在 → OrderDesignError', async () => {
    dbMock.orderItemDesign.findUnique.mockResolvedValue(null);
    await expect(removeOrderItemDesign('missing', salesActor)).rejects.toThrow(
      /不存在/,
    );
  });

  it('锁内 fresh-read 非 DRAFT / 非本人 → 拒绝', async () => {
    txMock.orderItemDesign.findUnique.mockResolvedValue(
      designRow({ status: OrderStatus.SUBMITTED }),
    );
    await expect(removeOrderItemDesign('d1', salesActor)).rejects.toThrow(
      /草稿或驳回状态/,
    );

    txMock.orderItemDesign.findUnique.mockResolvedValue(
      designRow({ submitterId: 'someone-else' }),
    );
    await expect(removeOrderItemDesign('d1', salesActor)).rejects.toThrow(
      /自己创建/,
    );
    expect(txMock.orderItemDesign.delete).not.toHaveBeenCalled();
  });
});

describe('rejected artwork correction', () => {
  it('allows the owner to upload while rejected, increments versions and archives added file facts', async () => {
    txMock.orderItem.findFirst.mockResolvedValue(draftItem({ status: OrderStatus.REJECTED }));
    dbMock.orderItem.findFirst.mockResolvedValue(draftItem({ status: OrderStatus.REJECTED }));
    txMock.orderItemDesign.create.mockResolvedValue({ id: 'new-design', fileUrl: 'https://example.test/new.jpg' });
    await recordOrderItemDesign(baseInput, salesActor, configuredEnv);
    expect(txMock.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { revision: { increment: 1 }, editVersion: { increment: 1 } } });
    expect(txMock.orderLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ changedFields: { design: { before: null, after: expect.objectContaining({ id: 'new-design', fileSize: '2048' }) } } }) }));
  });
  it('archives removed rejected artwork instead of losing its identity and object URL', async () => {
    dbMock.orderItemDesign.findUnique.mockResolvedValue({ id: 'old', orderItem: { orderId: 'o1' } });
    txMock.orderItemDesign.findUnique.mockResolvedValue({ id: 'old', orderItemId: 'i1', fileName: 'old.jpg', fileUrl: 'https://example.test/old.jpg', fileType: DesignFileType.IMAGE, fileSize: BigInt(123), orderItem: { orderId: 'o1', order: { status: OrderStatus.REJECTED, submitterId: salesActor.id } } });
    await removeOrderItemDesign('old', salesActor);
    expect(txMock.orderLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ changedFields: { design: { before: expect.objectContaining({ id: 'old', fileUrl: 'https://example.test/old.jpg', fileSize: '123' }), after: null } } }) }));
  });
  it('does not let another salesperson correct rejected artwork', async () => {
    dbMock.orderItem.findFirst.mockResolvedValue(draftItem({ status: OrderStatus.REJECTED, submitterId: 'other' }));
    await expect(assertCanUploadDesign('o1', 'i1', salesActor)).rejects.toThrow('只能修改自己');
  });
});

it.each([OrderStatus.DRAFT, OrderStatus.SUBMITTED])('does not reveal foreign order state %s before ownership', async (status) => {
  dbMock.orderItem.findFirst.mockResolvedValue(draftItem({ status, submitterId: 'sales-other', _count: { changeRequests: 1 } }));
  await expect(assertCanUploadDesign('o1', 'i1', salesActor)).rejects.toThrow('只能修改自己创建');
});
