'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { signDesignUpload, OssNotWiredError } from '@/lib/oss/sign';
import type { SignUploadResult } from '@/lib/oss/types';
import { DesignFileType } from '../generated/prisma/enums';

// Client form submits a small JSON payload; Zod validates shape before
// we commit server resources. Keep the UI call site thin: POST { orderId,
// orderItemId, fileType, fileName, fileSize, mimeType } → SignUploadResult.
const signDesignUploadSchema = z.object({
  orderId: z.string().trim().min(1).max(64),
  orderItemId: z.string().trim().min(1).max(64),
  fileType: z.nativeEnum(DesignFileType),
  fileName: z.string().trim().min(1).max(256),
  fileSize: z.number().int().min(1),
  mimeType: z.string().trim().min(1).max(128),
});

export async function signDesignUploadAction(raw: unknown): Promise<SignUploadResult> {
  // Open to every role that can create / edit orders + their designs.
  // Per SPEC §2.2 'design:upload' covers SALES / CUSTOMER_SERVICE / OWNER
  // / FOREMAN.
  const user = await requirePermission('design:upload');

  const parsed = signDesignUploadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === undefined ? '_' : String(issue.path[0]);
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'invalid', fieldErrors };
  }

  try {
    return await signDesignUpload({
      userId: user.id,
      ...parsed.data,
    });
  } catch (err) {
    if (err instanceof OssNotWiredError) {
      // The env says "ready" but the lib hasn't been plugged into a real
      // STS provider yet. Surface it as error rather than re-throw so the
      // UI gets a deterministic response and the message can be
      // surfaced verbatim during rollout.
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}
