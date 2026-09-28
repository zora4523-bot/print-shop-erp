import { pieceworkScheduleCancellationEnabled } from '@/lib/salary/piecework-cancellation';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalaryRuleSettings } from '@/lib/salary/rule-admin';
import { SalaryRuleSettingsForm } from '@/components/business/salary/SalaryRuleSettingsForm';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { formatDateTimeLocalShanghai } from '@/lib/format/dates';

import { listPieceworkAdminBooks } from '@/lib/salary/piecework-admin';
import { PieceworkPriceBookForm } from '@/components/business/salary/PieceworkPriceBookForm';

export const metadata = { title: '员工工资规则' };

export default async function EmployeePayRulesPage() {
  await requirePermission('salary:rule:manage');
  const [rules, books] = await Promise.all([listSalaryRuleSettings(), listPieceworkAdminBooks()]);
  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="员工工资规则"
        effect="effective-dated"
        subtitle="员工工价与生效日期"
      />
      <PieceworkPriceBookForm cancellationEnabled={pieceworkScheduleCancellationEnabled()} books={books} now={new Date().toISOString()} />
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">其他薪酬规则</h2>
        <p className="mt-1 text-sm text-muted-foreground">新版本不影响已结算工资。</p>
        <div className="mt-5"><SalaryRuleSettingsForm rules={rules} defaultEffectiveFrom={formatDateTimeLocalShanghai(new Date())} /></div>
      </section>
    </div>
  );
}
