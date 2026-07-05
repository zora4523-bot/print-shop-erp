import OSS from 'ali-oss';
import { Role, OrderStatus, DesignFileType } from '../generated/prisma/enums';
import { db } from './db';
import { readOssConfig } from './oss/config';
import { ALLOWED_EXTENSIONS } from './oss/types';

// 设计图记录层（A06 延伸：上传 UI 接线）。
//
// 浏览器完成 OSS 直传后（signDesignUploadAction → 预签 PUT），调
// recordOrderItemDesign 把对象登记为 OrderItemDesign 行。删除只删
// DB 行——策略没有 DeleteObject 权限，OSS 对象留待孤儿清理（P1 待办，
// PROGRESS 已记录）。
//
// 状态窗口：**仅 DRAFT**。提交后的设计图增删属于 A05（款式级编辑，
// needs-owner-input），业主拍板前不开口子（DECISIONS 2026-07-05）。

export class OrderDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderDesignError';
  }
}

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

async function loadOrderForDesignEdit(
  orderId: string,
  orderItemId: string,
  actor: { id: string; role: Role },
) {
  const item = await db.orderItem.findFirst({
    where: { id: orderItemId, orderId },
    select: {
      id: true,
      order: { select: { id: true, status: true, submitterId: true } },
    },
  });
  if (!item) throw new OrderDesignError('款式不存在或不属于该工单');
  assertDesignEditAllowed(item.order, actor);
  return item;
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

export type RecordOrderItemDesignInput = {
  orderId: string;
  orderItemId: string;
  objectKey: string;
  fileType: DesignFileType;
  fileName: string;
  fileSize: number;
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
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) {
    throw new OrderDesignError('文件大小无效');
  }
  const fileName = input.fileName.trim().slice(0, 256);
  if (!fileName) throw new OrderDesignError('文件名不能为空');

  await loadOrderForDesignEdit(input.orderId, input.orderItemId, actor);

  // HEAD 确认对象真的传上去了——否则客户端可以不上传直接登记，
  // 打印视图/CDR 打包会拿到 404 对象。
  const client = new OSS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    secure: cfg.endpoint.startsWith('https://'),
  });
  try {
    await client.head(input.objectKey);
  } catch (err) {
    console.error(
      '[order-design] head object failed:',
      err instanceof Error ? err.message : String(err),
    );
    throw new OrderDesignError('文件尚未上传成功，请重试上传');
  }

  return db.$transaction(async (tx) => {
    const design = await tx.orderItemDesign.create({
      data: {
        orderItemId: input.orderItemId,
        fileType: input.fileType,
        fileUrl: `${cfg.publicBaseUrl}/${input.objectKey}`,
        fileName,
        fileSize: BigInt(input.fileSize),
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
    await tx.orderLog.create({
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
  const design = await db.orderItemDesign.findUnique({
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
  if (!design) throw new OrderDesignError('设计图不存在');
  assertDesignEditAllowed(design.orderItem.order, actor);

  await db.$transaction(async (tx) => {
    await tx.orderItemDesign.delete({ where: { id: designId } });
    await tx.orderLog.create({
      data: {
        orderId: design.orderItem.orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        remark: `删除设计图：${design.fileName}`,
      },
    });
  });
  return { orderId: design.orderItem.orderId };
}
