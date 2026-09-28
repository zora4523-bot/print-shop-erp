'use client';

/** A usability guard against copied tabs, never authorization or deduplication. */
export function claimDraft(actorId: string, draftId: string, onConflict: () => void) {
  if (typeof BroadcastChannel === 'undefined') return { ready: Promise.resolve(false), close() {} };
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(`erp:form-owner:${actorId}:${draftId}`); }
  catch { return { ready: Promise.resolve(false), close() {} }; }
  const documentId = crypto.randomUUID();
  let conflict = false;
  let closed = false;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!message || typeof message !== 'object' || !('documentId' in message) || message.documentId === documentId || !('type' in message)) return;
    if (message.type === 'probe') channel.postMessage({ type: 'owner', documentId });
    if (message.type === 'owner' || message.type === 'claim') {
      conflict = true;
      onConflict();
    }
  };
  channel.postMessage({ type: 'probe', documentId });
  const ready = new Promise<boolean>((resolve) => {
    // Finite discovery window. An unresponsive background tab is still covered
    // by the server's request-key lock; silence is not a uniqueness guarantee.
    setTimeout(() => {
      if (!closed) channel.postMessage({ type: 'claim', documentId });
      resolve(!closed && !conflict);
    }, 200);
  });
  return { ready, close() { closed = true; channel.close(); } };
}
