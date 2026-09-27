'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import {
  recordDesignUploadSchema,
  signDesignUploadSchema,
} from '@/lib/auth/schemas';
import { signDesignUpload } from '@/lib/oss/sign';
import type { SignUploadResult } from '@/lib/oss/types';
import {
  OrderDesignError,
  assertCanUploadDesign,
  recordOrderItemDesign,
  removeOrderItemDesign,
} from '@/lib/order-design';
import { invalidFromIssues } from '@/lib/admin/action-helpers';

// Client form submits a small JSON payload; Zod validates shape before
// we commit server resources. Keep the UI call site thin: POST { orderId,
// orderItemId, fileType, fileName, fileSize, mimeType } → SignUploadResult.
export async function signDesignUploadAction(raw: unknown): Promise<SignUploadResult> {
  // Open to every role that can create / edit orders + their designs.
  // Per SPEC §2.2 'design:upload' covers SALES / ADMIN
  // / ADMIN.
  const user = await requirePermission('design:upload');

  const parsed = signDesignUploadSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  // 铸凭证前先过授权闸：目标款式必须真实存在、工单为草稿或驳回、actor 有权
  // 编辑。否则任何有 design:upload 权限的人都能对任意 id 铸 STS 凭证
  // 往 bucket 写孤儿对象。
  try {
    await assertCanUploadDesign(
      parsed.data.orderId,
      parsed.data.orderItemId,
      { id: user.id, role: user.role },
    );
  } catch (err) {
    if (err instanceof OrderDesignError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  // signDesignUpload 自身把 STS 失败与配置解析失败都折叠成
  // { status: 'error' }，四态 union 对 UI 穷尽——不需要 try/catch 翻译层。
  return signDesignUpload({
    userId: user.id,
    ...parsed.data,
  });
}

// ── 浏览器 PUT 成功后：登记 OrderItemDesign 行 ──────────────────────

export type DesignMutationResult =
  | { ok: true }
  | { ok: false; message: string };

export async function recordDesignUploadAction(
  raw: unknown,
): Promise<DesignMutationResult> {
  const user = await requirePermission('design:upload');
  const parsed = recordDesignUploadSchema.safeParse(raw);
  if (!parsed.success) {
    // 文件名规则的自定义提示可直接给用户看；其余是形状错误，统一兜底。
    const fileNameIssue = parsed.error.issues.find(
      (issue) => issue.code === 'custom' && issue.path[0] === 'fileName',
    );
    return { ok: false, message: fileNameIssue?.message ?? '参数校验失败' };
  }
  try {
    await recordOrderItemDesign(parsed.data, { id: user.id, role: user.role });
  } catch (err) {
    if (err instanceof OrderDesignError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
  revalidatePath(`/orders/${parsed.data.orderId}`);
  return { ok: true };
}

const deleteOrderItemDesignSchema = z.object({
  designId: z.string().trim().min(1).max(64),
});

export async function deleteOrderItemDesignAction(
  raw: unknown,
): Promise<DesignMutationResult> {
  const user = await requirePermission('design:upload');
  const parsed = deleteOrderItemDesignSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: '参数校验失败' };
  }
  let orderId: string;
  try {
    const result = await removeOrderItemDesign(parsed.data.designId, {
      id: user.id,
      role: user.role,
    });
    orderId = result.orderId;
  } catch (err) {
    if (err instanceof OrderDesignError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
