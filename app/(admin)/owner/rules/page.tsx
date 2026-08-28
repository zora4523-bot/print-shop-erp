import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { RULE_CENTER_DEFAULT_HREF } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '规则配置中心 · 红包印刷 ERP',
};

export default async function RuleCenterPage() {
  await requirePermission('dict:price:manage');
  redirect(RULE_CENTER_DEFAULT_HREF);
}
