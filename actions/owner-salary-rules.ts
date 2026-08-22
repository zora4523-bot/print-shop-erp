'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import {
  createSalaryRuleVersion,
  parseSalaryRuleVersionFormData,
  SalaryRuleAdminError,
} from '@/lib/salary/rule-admin';
import type { SalaryRuleVersionMutationResult } from './owner-salary-rules.types';

// Changes are versioned rather than updating a rule in place.  Existing
// payroll and commission records already retain their own rule snapshots;
// this ensures future calculations pick the appropriate version as well.
export async function createSalaryRuleVersionAction(
  _previous: SalaryRuleVersionMutationResult | null,
  formData: FormData,
): Promise<SalaryRuleVersionMutationResult> {
  const actor = await requirePermission('salary:rule:manage');

  const parsed = parseSalaryRuleVersionFormData(formData);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const created = await createSalaryRuleVersion(parsed.data, actor);
    revalidatePath('/owner/salary');
    revalidatePath('/owner/salary/rules');
    revalidatePath('/owner/salary/cs');
    revalidatePath('/owner/salary/hourly');
    return { status: 'success', ruleId: created.id };
  } catch (error) {
    if (error instanceof SalaryRuleAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
