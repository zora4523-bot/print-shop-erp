import type { Receipt } from '@/lib/admin/receipt';
import { creationIdentitySchema, type FormKind } from '@/lib/form-drafts/model';
import { FormCreationError, getCreationRequest } from '@/lib/form-drafts/creation-request';
import { CompletedDraftCleanup } from './FormDraftControls';

export async function VerifiedDraftReceipt({ actorId, kind, entityId, receipt }: { actorId: string; kind: FormKind; entityId: string; receipt: Receipt }) {
  const identity = creationIdentitySchema.safeParse({ draftId: receipt.createdDraft, clientRequestId: receipt.creationRequest });
  if (!identity.success) return null;
  let record;
  try { record = await getCreationRequest(kind, { actorId, ...identity.data }); }
  catch (error) { if (error instanceof FormCreationError) return null; throw error; }
  if (record?.entityId !== entityId) return null;
  return <CompletedDraftCleanup context={{ actorId, kind, sessionScope: null, ...identity.data }} />;
}
