'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { creationIdentitySchema, formKindSchema, supplementSchema } from '@/lib/form-drafts/model';
import { getCreationRequest } from '@/lib/form-drafts/creation-request';
import { describeCreationDifferences } from '@/lib/form-drafts/creation-status';
import { resolveActiveSupplement } from '@/lib/form-drafts/supplement-catalog';

const statusSchema = creationIdentitySchema.extend({ kind: formKindSchema, payload: z.unknown().optional() });

export async function getFormCreationStatusAction(raw: unknown) {
  // Both form kinds require ADMIN today, but retain their explicit permissions.
  const parsed = statusSchema.safeParse(raw);
  const actor = await requirePermission(parsed.success && parsed.data.kind === 'bom-new' ? 'bom:manage' : 'purchase:manage');
  if (!parsed.success) throw new Error('录入信息不完整，请保留内容并重新打开新建页面');
  const { kind, payload, ...identity } = parsed.data;
  const record = await getCreationRequest(kind, { ...identity, actorId: actor.id });
  if (!record) return { status: 'not-created' as const };
  const differences = payload === undefined ? [] : await describeCreationDifferences(kind, record.facts, record.payloadHash, payload);
  return { status: 'created' as const, differences, href: `${kind === 'purchase-new' ? '/owner/purchases' : '/owner/boms'}/${record.entityId}` };
}

/** Revalidate the returned ID against the current authorized, active catalog. */
export async function resolveSupplementAction(raw: unknown) {
  const parsed = z.object({ context: supplementSchema, entityId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(raw);
  await requirePermission(parsed.success && parsed.data.context.origin === 'bom-new' ? 'bom:manage' : 'purchase:manage');
  if (!parsed.success) return { status: 'invalid' as const, message: '补充资料的返回信息不完整，请手动选择资料' };
  const { context, entityId } = parsed.data;
  await requirePermission(context.entityType === 'SUPPLIER' ? 'party:manage' : context.entityType === 'MATERIAL' ? 'material:manage' : 'dict:product:manage');
  return resolveActiveSupplement(context, entityId);
}
