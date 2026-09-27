import type { MutationResult } from '@/lib/admin/action-helpers';

export type PurchaseMutationResult = MutationResult & { creationConflict?: boolean };
