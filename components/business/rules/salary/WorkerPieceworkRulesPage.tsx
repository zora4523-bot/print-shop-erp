import type { MachineType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { listPieceworkRuleManagementData } from '@/lib/salary/piecework-admin';
import type { MachineRuleWithBase } from '@/lib/salary/rules';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { WorkerMachineRuleForm } from '@/components/business/salary/WorkerMachineRuleForm';
import { Badge } from '@/components/ui/badge';
import { TableEmptyState } from '@/components/ui-business';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';

export const metadata = { title: '计件规则' };

function localDateTimeValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function displayRule(rule: unknown): MachineRuleWithBase {
  return rule as MachineRuleWithBase;
}

function isKnownMachineType(value: string): value is MachineType {
  return Object.prototype.hasOwnProperty.call(MACHINE_TYPE_LABELS, value);
}

function machineRuleLabel(value: string): string {
  return isKnownMachineType(value)
    ? MACHINE_TYPE_LABELS[value]
    : '配置异常';
}

export default async function WorkerPieceworkRulesPage() {
  await requirePermission('salary:rule:manage');
  const data = await listPieceworkRuleManagementData();
  const defaultsByMachine: Partial<Record<MachineType, {
    dailyBase: string;
    pieceRate: string;
    boardRate: string;
    smallOrderThreshold: string;
    smallOrderFlatPrice: string;
    smallOrderInclusive: boolean;
    largeOrderSetupFee: string;
    multiplierFactors: string[];
  }>> = {};
  for (const global of data.globalRules) {
    if (!isKnownMachineType(global.ruleKey)) continue;
    const value = displayRule(global.ruleValue);
    defaultsByMachine[global.ruleKey] = {
      dailyBase: String(value.dailyBase),
      pieceRate: String(value.pieceRate),
      boardRate: String(value.boardRate),
      smallOrderThreshold: value.smallOrderThreshold === null ? '' : String(value.smallOrderThreshold),
      smallOrderFlatPrice: String(value.smallOrderFlatPrice ?? 0),
      smallOrderInclusive: value.smallOrderInclusive ?? false,
      largeOrderSetupFee: String(value.largeOrderSetupFee ?? 0),
      multiplierFactors: [...value.multiplierFactors],
    };
  }

  const workers = data.workers.flatMap((worker) => {
    const machines =
      worker.machineCapabilities.length > 0
        ? worker.machineCapabilities
        : worker.machineType
          ? [worker.machineType]
          : [];
    return machines.map((machineType) => ({
      ...worker,
      machineType,
      optionKey: `${worker.id}:${machineType}`,
    }));
  });

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="计件规则"
        effect="effective-dated"
        subtitle="个人规则优先；新规则按生效时间用于后续报工。"
      />

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">新增个人规则版本</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          选择师傅后带出机型默认值。
        </p>
        <WorkerMachineRuleForm
          workers={workers}
          defaultsByMachine={defaultsByMachine}
          defaultEffectiveFrom={localDateTimeValue(new Date())}
        />
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">当前机型统一规则</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {data.globalRules.map((global) => {
            const rule = displayRule(global.ruleValue);
            return (
              <div key={global.id} className="rounded-lg border p-4 text-sm">
                <div className="flex items-center justify-between">
                  <strong>{machineRuleLabel(global.ruleKey)}</strong>
                  <Badge variant="outline">默认</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <RuleRow label="每日保底" value={`¥ ${rule.dailyBase}`} />
                  <RuleRow label="每下" value={`¥ ${rule.pieceRate}`} />
                  <RuleRow label="每板" value={`¥ ${rule.boardRate}`} />
                  <RuleRow label="小单阈值" value={rule.smallOrderThreshold === null ? '不启用' : `${rule.smallOrderInclusive ? '≤' : '<'} ${rule.smallOrderThreshold}`} />
                  <RuleRow label="小单固定" value={rule.smallOrderThreshold === null ? '—' : `¥ ${rule.smallOrderFlatPrice ?? 0}`} />
                  <RuleRow label="大单装板费" value={`¥ ${rule.largeOrderSetupFee ?? 0}`} />
                  <RuleRow label="倍率" value={formatMultipliers(rule.multiplierFactors)} />
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="p-5">
          <h2 className="font-semibold">个人规则版本记录</h2>
        </div>
        <div
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="个人计件规则版本"
          tabIndex={0}
        >
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">师傅</th>
                <th className="px-4 py-2 text-left">机型</th>
                <th className="px-4 py-2 text-right">保底</th>
                <th className="px-4 py-2 text-right">每下</th>
                <th className="px-4 py-2 text-right">每板</th>
                <th className="px-4 py-2 text-left">生效区间</th>
                <th className="px-4 py-2 text-left">备注 / 创建人</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.personalRules.map((entry) => {
                const rule = displayRule(entry.ruleValue);
                return (
                  <tr key={entry.id}>
                    <td className="px-4 py-3">{entry.worker.displayName}<p className="text-xs text-muted-foreground">{entry.worker.username}</p></td>
                    <td className="px-4 py-3">{machineRuleLabel(entry.machineType)}</td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">{String(rule.dailyBase)}</td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">{String(rule.pieceRate)}</td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">{String(rule.boardRate)}</td>
                    <td className="px-4 py-3 text-xs">{formatDateTimeShanghai(entry.effectiveFrom)} → {entry.effectiveTo ? formatDateTimeShanghai(entry.effectiveTo) : '长期'}</td>
                    <td className="px-4 py-3 text-xs">{entry.remark ?? '—'}<p className="text-muted-foreground">{entry.createdBy.displayName}</p></td>
                  </tr>
                );
              })}
              {data.personalRules.length === 0 ? (
                <TableEmptyState
                  colSpan={7}
                  title="暂无个人规则"
                  description="当前全部使用机型统一规则。"
                />
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="font-sans tabular-nums">{value}</dd></div>;
}

function formatMultipliers(factors: readonly string[]): string {
  if (factors.length === 0) return '无';
  return factors
    .map((factor) => {
      if (factor === 'DOUBLE_SIDED') return '双面 ×2';
      if (factor === 'DOUBLE_COLOR') return '双色 ×2';
      return '配置异常';
    })
    .join('、');
}
