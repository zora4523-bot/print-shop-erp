import OSS from 'ali-oss';
import { Role, OrderStatus, DesignFileType } from '../generated/prisma/enums';
import { db } from './db';
import { readOssConfig } from './oss/config';
import { ALLOWED_EXTENSIONS, FILE_SIZE_LIMITS } from './oss/types';

// 设计图记录层（A06 延伸：上传 UI 接线）。
//
// 浏览器完成 OSS 直传后（signDesignUploadAction → 预签 PUT），调
// recordOrderItemDesign 把对象登记为 OrderItemDesign 行。删除只删
// DB 行——策略没有 DeleteObject 权限，OSS 对象留待孤儿清理（P1 待办，
// PROGRESS 已记录）。
//
// 状态窗口：**仅 DRAFT**。提交后的设计图增删属于 A05（款式级编辑，
// needs-owner-input），业主拍板前不开口子（DECISIONS 2026-07-05）。
//
// 并发正确性：登记/删除的写事务持有与所有 Order.status 写入路径同一把
// advisory lock（print-shop-erp:order-cascade:<id>），并在锁内 fresh-read
// 重校状态/所有权——防"提交与登记并发，设计图落在已提交工单上"的
// TOCTOU（Codex upload-ui review #4）。
//
// 已知残余风险（记录在案，非本层修复）：预签 PUT URL 在其 15 分钟寿命
// 内可重复使用，登记后再次 PUT 可静默替换对象内容。窗口已通过
// (a) sign 前置 DRAFT 闸（本文件 assertCanUploadDesign）+ (b) 短凭证
// 压缩到最小；对象 ETag 固定校验属 P1（需 schema 加列）。

export class OrderDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderDesignError';
  }
}

// 与 lib/order.ts / lib/production.ts 同一命名空间——设计图登记必须和
// submit/cancel 等状态转换互斥。
function orderCascadeLockKey(orderId: string): string {
  return `print-shop-erp:order-cascade:${orderId}`;
}

type DesignTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  orderItem: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      order: { id: string; status: OrderStatus; submitterId: string };
    } | null>;
  };
  orderItemDesign: {
    create: (args: unknown) => Promise<{
      id: string;
      orderItemId: string;
      fileType: DesignFileType;
      fileUrl: string;
      fileName: string;
      uploadedAt: Date;
    }>;
    findUnique: (args: unknown) => Promise<{
      id: string;
      fileName: string;
      orderItem: {
        orderId: string;
        order: { status: OrderStatus; submitterId: string };
      };
    } | null>;
    delete: (args: unknown) => Promise<unknown>;
  };
  orderLog: { create: (args: unknown) => Promise<unknown> };
};

// objectKey 必须是 sign.ts buildObjectKey 铸出的形状，且 orderId /
// orderItemId 段与本次登记的目标一致——防止把别的工单（或任意路径）
// 的对象挂到自己名下。
function assertObjectKeyShape(
  objectKey: string,
  orderId: string,
  orderItemId: string,
  fileType: DesignFileType,
): void {
  const expectedPrefix = `design/${orderId}/${orderItemId}/`;
  if (!objectKey.startsWith(expectedPrefix)) {
    throw new OrderDesignError('文件路径与工单/款式不匹配');
  }
  const rest = objectKey.slice(expectedPrefix.length);
  const allowedExts = ALLOWED_EXTENSIONS[fileType].join('|');
  const re = new RegExp(
    `^${fileType.toLowerCase()}-[0-9a-fA-F-]{36}\\.(${allowedExts})$`,
  );
  if (!re.test(rest)) {
    throw new OrderDesignError('文件路径格式非法');
  }
}

function assertDesignEditAllowed(
  order: { status: OrderStatus; submitterId: string },
  actor: { id: string; role: Role },
): void {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderDesignError('只有草稿状态的工单可以增删设计图');
  }
  const globalOverride =
    actor.role === Role.OWNER || actor.role === Role.FOREMAN;
  if (!globalOverride && order.submitterId !== actor.id) {
    throw new OrderDesignError('只能修改自己创建的工单的设计图');
  }
}

const ORDER_ITEM_WITH_ORDER = {
  select: {
    id: true,
    order: { select: { id: true, status: true, submitterId: true } },
  },
} as const;

/**
 * 签发上传凭证前的授权闸：目标款式必须真实存在、工单是 DRAFT、且
 * actor 有权编辑。没有这道闸，任何有 design:upload 权限的人都能对
 * 任意（含他人/已提交/不存在的）orderId 铸 STS 凭证往 bucket 写孤儿
 * 对象（Codex upload-ui review #3）。
 */
export async function assertCanUploadDesign(
  orderId: string,
  orderItemId: string,
  actor: { id: string; role: Role },
): Promise<void> {
  const item = await db.orderItem.findFirst({
    where: { id: orderItemId, orderId },
    ...ORDER_ITEM_WITH_ORDER,
  });
  if (!item) throw new OrderDesignError('款式不存在或不属于该工单');
  assertDesignEditAllowed(item.order, actor);
}

export type RecordOrderItemDesignInput = {
  orderId: string;
  orderItemId: string;
  objectKey: string;
  fileType: DesignFileType;
  fileName: string;
};

export async function recordOrderItemDesign(
  input: RecordOrderItemDesignInput,
  actor: { id: string; role: Role },
  env: NodeJS.ProcessEnv = process.env,
) {
  const cfgResult = readOssConfig(env);
  if (!cfgResult.configured) {
    throw new OrderDesignError('OSS 未配置，无法登记设计图');
  }
  const cfg = cfgResult.cfg;

  assertObjectKeyShape(
    input.objectKey,
    input.orderId,
    input.orderItemId,
    input.fileType,
  );
  const fileName = input.fileName.trim().slice(0, 256);
  if (!fileName) throw new OrderDesignError('文件名不能为空');

  // 便宜的预检（拦掉绝大多数非法请求），真正的守卫在 tx 锁内重校。
  await assertCanUploadDesign(input.orderId, input.orderItemId, actor);

  // HEAD 确认对象真的传上去了，并以 OSS 返回的 Content-Length 为
  // **权威文件大小**——客户端申报值可以撒谎（申报小文件拿凭证、实传
  // 大文件），这里同时兜大小上限（Codex upload-ui review #2）。
  // 网络 IO 放在 PG 事务/锁之外（项目惯例：不在 tx 里挂 OSS IO）。
  const client = new OSS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    secure: cfg.endpoint.startsWith('https://'),
  });
  let actualSize: number;
  try {
    const head = await client.head(input.objectKey);
    const raw = (head.res.headers as Record<string, string | undefined>)[
      'content-length'
    ];
    actualSize = Number(raw);
  } catch (err) {
    console.error(
      '[order-design] head object failed:',
      err instanceof Error ? err.message : String(err),
    );
    throw new OrderDesignError('文件尚未上传成功，请重试上传');
  }
  if (!Number.isSafeInteger(actualSize) || actualSize <= 0) {
    throw new OrderDesignError('无法确认已上传文件的大小，请重试上传');
  }
  if (actualSize > FILE_SIZE_LIMITS[input.fileType]) {
    throw new OrderDesignError(
      `已上传文件超过大小上限（${Math.round(FILE_SIZE_LIMITS[input.fileType] / (1024 * 1024))} MiB）`,
    );
  }

  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as DesignTxClient;
    // 与 submit/cancel 共享同一把锁 + 锁内 fresh-read：提交发生在预检
    // 之后时，这里会看到 SUBMITTED 并拒绝（TOCTOU 修复）。
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    const fresh = await txClient.orderItem.findFirst({
      where: { id: input.orderItemId, orderId: input.orderId },
      ...ORDER_ITEM_WITH_ORDER,
    });
    if (!fresh) throw new OrderDesignError('款式不存在或不属于该工单');
    assertDesignEditAllowed(fresh.order, actor);

    const design = await txClient.orderItemDesign.create({
      data: {
        orderItemId: input.orderItemId,
        fileType: input.fileType,
        fileUrl: `${cfg.publicBaseUrl}/${input.objectKey}`,
        fileName,
        fileSize: BigInt(actualSize),
        uploadedBy: actor.id,
      },
      select: {
        id: true,
        orderItemId: true,
        fileType: true,
        fileUrl: true,
        fileName: true,
        uploadedAt: true,
      },
    });
    await txClient.orderLog.create({
      data: {
        orderId: input.orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        remark: `上传设计图：${fileName}`,
      },
    });
    return design;
  });
}

export async function removeOrderItemDesign(
  designId: string,
  actor: { id: string; role: Role },
) {
  // 预读只为拿 orderId 构造锁 key；守卫在锁内 fresh-read 上执行。
  const existing = await db.orderItemDesign.findUnique({
    where: { id: designId },
    select: { id: true, orderItem: { select: { orderId: true } } },
  });
  if (!existing) throw new OrderDesignError('设计图不存在');
  const orderId = existing.orderItem.orderId;

  await db.$transaction(async (tx) => {
    const txClient = tx as unknown as DesignTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;
    const fresh = await txClient.orderItemDesign.findUnique({
      where: { id: designId },
      select: {
        id: true,
        fileName: true,
        orderItem: {
          select: {
            orderId: true,
            order: { select: { status: true, submitterId: true } },
          },
        },
      },
    });
    if (!fresh) throw new OrderDesignError('设计图不存在');
    assertDesignEditAllowed(fresh.orderItem.order, actor);

    await txClient.orderItemDesign.delete({ where: { id: designId } });
    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        remark: `删除设计图：${fresh.fileName}`,
      },
    });
  });
  return { orderId };
}
