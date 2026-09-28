import {
  FORM_DRAFT_LIMIT, FORM_DRAFT_PREFIX, FORM_DRAFT_TTL,
  creationIdentitySchema, draftStorageKey, parseStoredDraft, type FormDraftContext, type FormKind, type StoredDraft,
} from './model';

type StoragePort = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
type Identity = Pick<FormDraftContext, 'actorId' | 'kind' | 'draftId'>;
const completedKey = (identity: Identity) => `${draftStorageKey(identity)}:complete`;

function completion(raw: string | null) {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'number') return { at: value, clientRequestId: undefined };
    if (value && typeof value === 'object' && 'at' in value && typeof value.at === 'number') {
      return { at: value.at, clientRequestId: 'clientRequestId' in value ? value.clientRequestId : undefined };
    }
  } catch { /* Malformed tombstones are not trusted. */ }
  return null;
}

export function completedDraftIdentity(storage: StoragePort, identity: Identity) {
  if (!isDraftCompleted(storage, identity)) return null;
  const record = completion(storage.getItem(completedKey(identity)));
  const parsed = creationIdentitySchema.safeParse({ draftId: identity.draftId, clientRequestId: record?.clientRequestId });
  return parsed.success ? parsed.data : null;
}

export function isDraftCompleted(storage: StoragePort, identity: Identity, now = Date.now()): boolean {
  const raw = storage.getItem(completedKey(identity));
  if (!raw) return false;
  const at = completion(raw)?.at ?? NaN;
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= FORM_DRAFT_TTL;
}

function keys(storage: StoragePort) {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null && key.startsWith(FORM_DRAFT_PREFIX));
}

export function listDrafts(storage: StoragePort, actorId: string, kind: FormKind, now = Date.now()): StoredDraft[] {
  return keys(storage).flatMap((key) => {
    if (key.endsWith(':complete')) return [];
    const raw = storage.getItem(key);
    const draft = raw ? parseStoredDraft(raw, actorId, now) : null;
    return draft && draft.kind === kind && key === draftStorageKey(draft) && !isDraftCompleted(storage, draft, now) ? [draft] : [];
  }).sort((a, b) => b.savedAt - a.savedAt);
}

/** Call only after the server authenticated the current actor and permissions. */
export function cleanupDrafts(storage: StoragePort, actorId: string, allowed: readonly FormKind[], now = Date.now()) {
  const actorPrefix = `${FORM_DRAFT_PREFIX}${encodeURIComponent(actorId)}:`;
  const valid: Array<{ key: string; at: number }> = [];
  for (const key of keys(storage)) {
    if (!key.startsWith(actorPrefix) || !allowed.some((kind) => key.startsWith(`${actorPrefix}${kind}:`))) {
      storage.removeItem(key);
      continue;
    }
    const raw = storage.getItem(key);
    const draft = raw && !key.endsWith(':complete') ? parseStoredDraft(raw, actorId, now) : null;
    const at = key.endsWith(':complete') ? completion(raw)?.at : draft?.savedAt;
    if (at == null || !Number.isFinite(at) || at > now + 60_000 || now - at > FORM_DRAFT_TTL) storage.removeItem(key);
    else valid.push({ key, at });
  }
  // Tombstones count toward the cap too. Recent completed flows cannot be
  // resurrected by a mounted form; the hook also keeps an in-memory marker.
  for (const entry of valid.sort((a, b) => b.at - a.at).slice(FORM_DRAFT_LIMIT * 2)) storage.removeItem(entry.key);
}

export function saveDraft(storage: StoragePort, draft: StoredDraft): boolean {
  if (isDraftCompleted(storage, draft, draft.savedAt)) return false;
  const valid = parseStoredDraft(JSON.stringify(draft), draft.actorId, draft.savedAt);
  if (!valid) throw new Error('录入内容过长或格式不受支持，请在原页面保存');
  // Round trip through the whitelist schema; never persist arbitrary objects.
  storage.setItem(draftStorageKey(valid), JSON.stringify(valid));
  const all = [...listDrafts(storage, draft.actorId, 'purchase-new', draft.savedAt), ...listDrafts(storage, draft.actorId, 'bom-new', draft.savedAt)]
    .sort((a, b) => b.savedAt - a.savedAt);
  for (const old of all.slice(FORM_DRAFT_LIMIT)) storage.removeItem(draftStorageKey(old));
  return true;
}

export function completeDraft(storage: StoragePort, identity: Identity & { clientRequestId?: string }, now = Date.now()) {
  // Write the completion first. If quota prevents it, leave the existing draft
  // and let the next authoritative request-status check recover the outcome.
  storage.setItem(completedKey(identity), JSON.stringify({ at: now, clientRequestId: identity.clientRequestId }));
  storage.removeItem(draftStorageKey(identity));
}
