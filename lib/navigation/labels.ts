import { Role } from '@/generated/prisma/enums';

export const ADMIN_DASHBOARD_TITLE = '管理工作台';

export function workbenchPageTitle(role: Role | undefined): string {
  return role === Role.ADMIN ? '销售工作台' : '工作台';
}
