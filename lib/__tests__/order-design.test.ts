import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, OrderStatus, DesignFileType } from '../../generated/prisma/enums';

const { dbMock, txMock, headMock, ossCtorMock } = vi.hoisted(() => {
  const tx = {
    orderItemDesign: { create: vi.fn(), delete: vi.fn() },
    orderLog: { create: vi.fn() },
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
const ownerActor = { id: 'owner1', role: Role.OWNER };

const baseInput = {
  orderId: 'o1',
  orderItemId: 'i1',
  objectKey: goodKey,
  fileType: DesignFileType.IMAGE,
  fileName: 'design.jpg',
  fileSize: 1024,
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

beforeEach(() => {
  dbMock.orderItem.findFirst.mockReset().mockResolvedValue(draftItem());
  dbMock.orderItemDesign.findUnique.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  txMock.orderItemDesign.create.mockReset().mockResolvedValue({ id: 'd1' });
  txMock.orderItemDesign.delete.mockReset().mockResolvedValue({ id: 'd1' });
  txMock.orderLog.create.mockReset().mockResolvedValue({ id: 'log1' });
  headMock.mockReset().mockResolvedValue({ status: 200 });
  ossCtorMock.mockReset();
});

describe('recordOrderItemDesign', () => {
  it('happy path：HEAD 确认后写 design 行 + OrderLog（同 tx）', async () => {
    await recordOrderItemDesign(baseInput, salesActor, configuredEnv);

    expect(headMock).toHaveBeenCalledWith(goodKey);
    expect(txMock.orderItemDesign.create.mock.calls[0][0].data).toMatchObject({
      orderItemId: 'i1',
      fileType: DesignFileType.IMAGE,
      fileUrl: `https://my-bucket.oss-cn-shenzhen.aliyuncs.com/${goodKey}`,
      fileName: 'design.jpg',
      fileSize: BigInt(1024),
      uploadedBy: 'sales1',
    });
    expect(txMock.orderLog.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'o1',
      operatorId: 'sales1',
      action: 'UPDATE',
      remark: '上传设计图：design.jpg',
    });
  });

  it('OSS 未配置 → OrderDesignError', async () => {
    await expect(
      recordOrderItemDesign(baseInput, salesActor, {} as NodeJS.ProcessEnv),
    ).rejects.toBeInstanceOf(OrderDesignError);
    expect(headMock).not.toHaveBeenCalled();
  });

  it('objectKey 指向别的工单/款式 → 拒绝', async () => {
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

  it('非 DRAFT 状态 → 拒绝（提交后的增删属于 A05）', async () => {
    dbMock.orderItem.findFirst.mockResolvedValue(
      draftItem({ status: OrderStatus.SUBMITTED }),
    );
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/草稿状态/);
  });

  it('SALES 非本人工单 → 拒绝；OWNER 全局放行', async () => {
    dbMock.orderItem.findFirst.mockResolvedValue(
      draftItem({ submitterId: 'someone-else' }),
    );
    await expect(
      recordOrderItemDesign(baseInput, salesActor, configuredEnv),
    ).rejects.toThrow(/自己创建/);

    await recordOrderItemDesign(baseInput, ownerActor, configuredEnv);
    expect(txMock.orderItemDesign.create).toHaveBeenCalledTimes(1);
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

  it('fileSize 非法 → 拒绝', async () => {
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        recordOrderItemDesign(
          { ...baseInput, fileSize: bad },
          salesActor,
          configuredEnv,
        ),
      ).rejects.toBeInstanceOf(OrderDesignError);
    }
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

  it('happy path：删行 + OrderLog，返回 orderId', async () => {
    dbMock.orderItemDesign.findUnique.mockResolvedValue(designRow());
    const r = await removeOrderItemDesign('d1', salesActor);
    expect(r.orderId).toBe('o1');
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

  it('非 DRAFT / 非本人 → 拒绝', async () => {
    dbMock.orderItemDesign.findUnique.mockResolvedValue(
      designRow({ status: OrderStatus.SUBMITTED }),
    );
    await expect(removeOrderItemDesign('d1', salesActor)).rejects.toThrow(
      /草稿状态/,
    );

    dbMock.orderItemDesign.findUnique.mockResolvedValue(
      designRow({ submitterId: 'someone-else' }),
    );
    await expect(removeOrderItemDesign('d1', salesActor)).rejects.toThrow(
      /自己创建/,
    );
    expect(txMock.orderItemDesign.delete).not.toHaveBeenCalled();
  });
});
