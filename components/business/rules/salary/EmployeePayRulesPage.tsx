import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalaryRuleSettings } from '@/lib/salary/rule-admin';
import { SalaryRuleSettingsForm } from '@/components/business/salary/SalaryRuleSettingsForm';
import { PageHeader } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = { title: '员工工资规则' };

function localDateTimeValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export default async function EmployeePayRulesPage() {
  await requirePermission('salary:rule:manage');
  const rules = await listSalaryRuleSettings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="员工工资规则"
        actions={<Link href={RULE_CENTER_HREFS.workerPiecework} className={buttonVariants({ variant: 'outline' })}>师傅计件规则</Link>}
      />
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">新增规则版本</h2>
        <p className="mt-1 text-sm text-muted-foreground">新版本不影响已结算工资。</p>
        <div className="mt-5"><SalaryRuleSettingsForm rules={rules} defaultEffectiveFrom={localDateTimeValue(new Date())} /></div>
      </section>
    </div>
  );
}
