import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { db } from '@/lib/db';
import { writeAuditLogInTx } from '@/lib/audit-log';
import { creationIdentitySchema, type CreationIdentity, type FormKind } from './model';

export class FormCreationError extends Error {}
export type CreationRequest = CreationIdentity & { actorId: string };
export const creationKind = (kind: FormKind) => kind === 'purchase-new' ? 'PURCHASE' as const : 'BOM' as const;
export const creationLockKey = (kind: FormKind, request: CreationRequest) => `form-create:${request.actorId}:${creationKind(kind)}:${request.clientRequestId}`;

export function creationPayloadHash(facts: Prisma.InputJsonObject) {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

async function lockRequest(tx: Prisma.TransactionClient, kind: FormKind, request: CreationRequest) {
  const parsed = creationIdentitySchema.safeParse({ draftId: request.draftId, clientRequestId: request.clientRequestId });
  if (!parsed.success) throw new FormCreationError('本次录入信息不完整，请保留内容并重新打开新建页面');
  const actor = await tx.user.findUnique({ where: { id: request.actorId }, select: {
    id: true, role: true, isActive: true, username: true, displayName: true,
  } });
  if (!actor?.isActive || !hasPermission(kind === 'purchase-new' ? 'purchase:manage' : 'bom:manage', actor.role)) throw new FormCreationError('当前账号不能创建该单据，请重新登录有权限的账号');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${creationLockKey(kind, request)}, 0))`;
  return actor;
}

function requestWhere(kind: FormKind, request: CreationRequest) {
  return { actorId_kind_clientRequestId: { actorId: request.actorId, kind: creationKind(kind), clientRequestId: request.clientRequestId } };
}

/** The caller owns the transaction. No pending receipt can survive a rollback. */
export async function createWithRequest(
  tx: Prisma.TransactionClient,
  kind: FormKind,
  request: CreationRequest,
  facts: Prisma.InputJsonObject,
  create: () => Promise<string>,
): Promise<{ entityId: string; replayed: boolean }> {
  const actor = await lockRequest(tx, kind, request);
  const payloadHash = creationPayloadHash(facts);
  const existing = await tx.formCreationRequest.findUnique({ where: requestWhere(kind, request) });
  if (existing) {
    if (existing.draftId !== request.draftId || existing.payloadHash !== payloadHash) {
      throw new FormCreationError('这份录入已创建过单据，但当前内容不同。请查看原单据，另建时选择“另建一单”');
    }
    return { entityId: (kind === 'purchase-new' ? existing.purchaseOrderId : existing.billOfMaterialId)!, replayed: true };
  }
  const entityId = await create();
  await tx.formCreationRequest.create({ data: {
    actorId: actor.id, kind: creationKind(kind), clientRequestId: request.clientRequestId,
    draftId: request.draftId, payloadHash, normalizedPayload: facts,
    ...(kind === 'purchase-new' ? { purchaseOrderId: entityId } : { billOfMaterialId: entityId }),
  } });
  await writeAuditLogInTx(tx, { actor, action: 'FORM_CREATED', entityType: kind === 'purchase-new' ? 'PurchaseOrder' : 'BillOfMaterial',
    entityId, after: facts, requestMetadata: { clientRequestId: request.clientRequestId, draftId: request.draftId } });
  return { entityId, replayed: false };
}

export async function getCreationRequest(kind: FormKind, request: CreationRequest) {
  return db.$transaction(async (tx) => {
    await lockRequest(tx, kind, request);
    const record = await tx.formCreationRequest.findUnique({ where: requestWhere(kind, request) });
    if (!record) return null;
    if (record.draftId !== request.draftId) throw new FormCreationError('录入记录不匹配，请返回原录入页面');
    return {
      entityId: (kind === 'purchase-new' ? record.purchaseOrderId : record.billOfMaterialId)!,
      facts: record.normalizedPayload,
      payloadHash: record.payloadHash,
    };
  });
}

export function readCreationIdentity(formData: FormData): CreationIdentity | undefined {
  const draftId = formData.get('draftId');
  const clientRequestId = formData.get('clientRequestId');
  if (!draftId && !clientRequestId) return undefined; // Upgrade compatibility for pre-existing forms.
  const parsed = creationIdentitySchema.safeParse({ draftId, clientRequestId });
  if (!parsed.success) throw new FormCreationError('本次录入信息不完整，请保留内容并重新打开新建页面');
  return parsed.data;
}
