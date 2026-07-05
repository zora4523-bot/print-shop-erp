'use server';

import { redirect } from 'next/navigation';
import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  mapPrismaUniqueViolation,
  revalidatePaths,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { createPartySchema, updatePartySchema } from '@/lib/auth/schemas';
import { writeAuditLog } from '@/lib/audit-log';
import {
  createParty,
  getPartySummary,
  PartyInvariantError,
  setPartyActive,
  updateParty,
} from '@/lib/party';
import type { PartyMutationResult } from './owner-parties.types';

const PARTY_CODE_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: ['code', 'Party_code_key'],
    message: '该客户/供应商编码已被占用',
  },
];

function mapUniqueViolation(err: unknown): PartyMutationResult | null {
  return mapPrismaUniqueViolation(err, PARTY_CODE_UNIQUE_VIOLATIONS);
}

function normalizePartyFormInput(formData: FormData) {
  return {
    type: getFormString(formData, 'type'),
    code: getFormString(formData, 'code'),
    name: getFormString(formData, 'name'),
    shortName: getFormStringOr(formData, 'shortName', ''),
    primaryContactName: getFormStringOr(formData, 'primaryContactName', ''),
    primaryContactPhone: getFormStringOr(formData, 'primaryContactPhone', ''),
    primaryContactWechat: getFormStringOr(formData, 'primaryContactWechat', ''),
    defaultReceiverName: getFormStringOr(formData, 'defaultReceiverName', ''),
    defaultReceiverPhone: getFormStringOr(formData, 'defaultReceiverPhone', ''),
    defaultProvince: getFormStringOr(formData, 'defaultProvince', ''),
    defaultCity: getFormStringOr(formData, 'defaultCity', ''),
    defaultDistrict: getFormStringOr(formData, 'defaultDistrict', ''),
    defaultAddressDetail: getFormStringOr(formData, 'defaultAddressDetail', ''),
  };
}

export async function createPartyAction(
  _prev: PartyMutationResult | null,
  formData: FormData,
): Promise<PartyMutationResult> {
  await requirePermission('party:manage');

  const parsed = createPartySchema.safeParse(normalizePartyFormInput(formData));
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  let createdId: string;
  try {
    const created = await createParty(parsed.data);
    createdId = created.id;
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, PartyInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePartyPaths(createdId);
  redirect(`/owner/parties/${createdId}`);
}

export async function updatePartyAction(
  id: string,
  _prev: PartyMutationResult | null,
  formData: FormData,
): Promise<PartyMutationResult> {
  const actor = await requirePermission('party:manage');

  const parsed = updatePartySchema.safeParse(normalizePartyFormInput(formData));
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    const before = await getPartySummary(id);
    const after = await updateParty(id, parsed.data);
    await writeAuditLog({
      actor,
      action: 'UPDATE',
      entityType: 'Party',
      entityId: id,
      before,
      after,
      requestMetadata: {
        source: 'owner-parties.updatePartyAction',
        route: `/owner/parties/${id}`,
      },
    });
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, PartyInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePartyPaths(id);
  return { status: 'success' };
}

export async function setPartyActiveAction(
  id: string,
  isActive: boolean,
): Promise<PartyMutationResult> {
  await requirePermission('party:manage');

  try {
    await setPartyActive(id, isActive);
  } catch (err) {
    const invariant = mapInvariantError(err, PartyInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePartyPaths(id);
  return { status: 'success' };
}

function revalidatePartyPaths(id: string) {
  revalidatePaths([
    '/owner/parties',
    `/owner/parties/${id}`,
    '/orders/new',
  ]);
}
