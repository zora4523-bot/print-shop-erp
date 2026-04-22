import { Role } from '../../generated/prisma/client';

// Canonical Chinese label for each Role enum. Keep in sync with SPEC §2.1.
export const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: '老板',
  [Role.FOREMAN]: '车间主管',
  [Role.SALES]: '销售',
  [Role.CUSTOMER_SERVICE]: '客服',
  [Role.WORKER]: '师傅',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}
