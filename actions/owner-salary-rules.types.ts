import type { MutationResult } from '@/lib/admin/action-helpers';

export type SalaryRuleVersionMutationResult =
  | (Extract<MutationResult, { status: 'success' }> & { ruleId: string })
  | Exclude<MutationResult, { status: 'success' }>;
