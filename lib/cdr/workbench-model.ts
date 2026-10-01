import { z } from 'zod';

export const CDR_WORKBENCH_PAGE_SIZE = 100;
export { cdrWorkbenchFilterSchema, cdrSelectionSchema } from '../auth/schemas/cdr-workbench';
export type { CdrWorkbenchFilter } from '../auth/schemas/cdr-workbench';
export const cdrManifestSchema = z.object({
  version: z.literal(1),
  orders: z.array(z.object({ id: z.string(), fingerprint: z.string() })),
  files: z.array(z.object({
    id: z.string(), orderNo: z.string(), fileName: z.string(), fileUrl: z.string(),
    folders: z.array(z.string()).length(3),
  })),
});
export type CdrManifest = z.infer<typeof cdrManifestSchema>;
export type CdrWorkbenchOrder = {
  id: string; orderNo: string; name: string; salesId: string; salesLabel: string;
  submittedAt: string; status: string; fileCount: number; version: string;
  issue: string | null; packageState: 'new' | 'updated' | 'unchanged' | 'unknown';
};
