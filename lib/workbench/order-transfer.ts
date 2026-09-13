import { z } from 'zod';
import {
  workbenchItemQuoteSchema,
  type WorkbenchItemQuoteInput,
} from '@/lib/workbench/item-quote';

const transferSchema = workbenchItemQuoteSchema.extend({
  expiresAt: z.number().int().positive(),
});
const TRANSFER_TTL_MS = 30 * 60 * 1000;
export function workbenchTransferKey(scope: string, id: string): string {
  return `workbench-order:${scope}:${id}`;
}
export function saveWorkbenchTransfer(
  storage: Pick<Storage, 'setItem'>,
  scope: string,
  input: WorkbenchItemQuoteInput,
): string {
  const parsed = workbenchItemQuoteSchema.parse(input);
  const id = globalThis.crypto.randomUUID();
  storage.setItem(
    workbenchTransferKey(scope, id),
    JSON.stringify({ ...parsed, expiresAt: Date.now() + TRANSFER_TTL_MS }),
  );
  return id;
}
/** Browser storage is untrusted. Only item facts survive; never quote amounts. */
export function readWorkbenchTransfer(
  storage: Pick<Storage, 'getItem'>,
  scope: string,
  id: string,
): WorkbenchItemQuoteInput | null {
  if (!/^[\da-f-]{36}$/i.test(id)) return null;
  const raw = storage.getItem(workbenchTransferKey(scope, id));
  if (!raw || raw.length > 20000) return null;
  try {
    const parsed = transferSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) return null;
    return { item: parsed.data.item };
  } catch {
    return null;
  }
}
