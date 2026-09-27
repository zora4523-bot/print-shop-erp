import type { MutationResult } from '@/lib/admin/action-helpers';

export type BomMutationResult = MutationResult & { creationConflict?: boolean };
