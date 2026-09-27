import { randomUUID } from 'node:crypto';
import type { FormDraftContext, FormKind } from './model';

export function newFormDraftContext(kind: FormKind, user: { id: string; draftSessionScope?: string }): FormDraftContext {
  return { kind, actorId: user.id, sessionScope: user.draftSessionScope ?? null, draftId: randomUUID(), clientRequestId: randomUUID() };
}
