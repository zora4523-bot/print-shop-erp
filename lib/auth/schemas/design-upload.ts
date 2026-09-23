// 设计图直传（SPEC §H）：签发上传凭证与登记 OrderItemDesign 的入参。
// 对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { DesignFileType } from '../../../generated/prisma/enums';
import { designFileNameIssue } from '../../oss/design-file-name';

// 签发阶段的文件名规则由 lib/oss/sign.ts 校验并按字段返回（fieldErrors.fileName）。
export const signDesignUploadSchema = z.object({
  orderId: z.string().trim().min(1).max(64),
  orderItemId: z.string().trim().min(1).max(64),
  fileType: z.nativeEnum(DesignFileType),
  fileName: z.string().trim().min(1).max(256),
  fileSize: z.number().int().min(1),
  mimeType: z.string().trim().min(1).max(128),
});

// fileSize 不收客户端申报值——lib 层以 OSS HEAD 的 Content-Length 为准。
// 签发与登记是两次独立调用，登记时按同一规则重校文件名：它会原样成为
// CDR 下载包里的 ZIP 条目名。
export const recordDesignUploadSchema = z
  .object({
    orderId: z.string().trim().min(1).max(64),
    orderItemId: z.string().trim().min(1).max(64),
    objectKey: z.string().trim().min(1).max(512),
    fileType: z.nativeEnum(DesignFileType),
    fileName: z.string().trim().min(1).max(256),
  })
  .superRefine((value, ctx) => {
    const issue = designFileNameIssue(value.fileName, value.fileType);
    if (issue) ctx.addIssue({ code: 'custom', path: ['fileName'], message: issue });
  });
