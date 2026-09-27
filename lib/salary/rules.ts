import { SalaryRuleType } from '../../generated/prisma/enums';
import { db } from '../db';

// 最小客户端面：既接全局 db，也接 $transaction 的 tx（结算类调用必须
// 传 tx，让规则读参与结算快照的事务隔离）。直接复用
// Prisma delegate 的函数类型，避免用 unknown 重写参数后破坏函数参数逆变兼容性。
type SalaryRuleClient = {
  salaryRule: Pick<typeof db.salaryRule, 'findFirst'>;
};

export type SalaryRuleSnapshotLockClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

const SALARY_RULE_SNAPSHOT_LOCK_KEY =
  'print-shop-erp:salary-rules:snapshot';

export function salaryRuleLockKey(
  ruleType: SalaryRuleType,
  ruleKey: string,
): string {
  return `print-shop-erp:salary-rule:${ruleType}:${ruleKey}`;
}

export async function acquireSalaryRuleSnapshotWriteLock(
  client: SalaryRuleSnapshotLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SALARY_RULE_SNAPSHOT_LOCK_KEY}))`;
}

// 版本化规则"当前生效"查询的**唯一实现**。语义：effectiveFrom
// <= now 中最新一条，且 effectiveTo 为 null 或 > now。
// ruleValue 是 Prisma Json——形状由 seed / owner 规则编辑器在写入侧
// 保证，读侧信任断言为 T。
async function getActiveRuleValue<T>(
  ruleType: SalaryRuleType,
  ruleKey: string,
  now: Date,
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<T | null> {
  const rule = await client.salaryRule.findFirst({
    where: {
      ruleType,
      ruleKey,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ruleValue: true },
  });
  if (!rule) return null;
  return rule.ruleValue as unknown as T;
}

// ─────────────────────────────────────────────────────────────────────
// 考勤工时规则
// ─────────────────────────────────────────────────────────────────────
//
// Rule keys under WORKER_HOURLY:
//   - WORK_HOURS:       { morning, afternoon, otStart } — 不硬编码

async function getActiveHourlyRule<T>(
  ruleKey: string,
  now: Date,
  client: SalaryRuleClient,
): Promise<T | null> {
  return getActiveRuleValue<T>(
    SalaryRuleType.WORKER_HOURLY,
    ruleKey,
    now,
    client,
  );
}

type WorkHoursConfig = {
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
  // Hour (inclusive lower bound) at which OT starts. `>= otStart`
  // counts as OT per DECISIONS 2026-04-24.
  otStart: string;
};

// SPEC §5.4 / §3.9: 正常工时段 + 加班起始，用于考勤录入 UI 的"全勤"
// 快速填 hint；严格要求从 SalaryRule 读（注意事项 5），不得硬编码。
export async function getActiveWorkHours(
  now: Date = new Date(),
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<WorkHoursConfig | null> {
  return getActiveHourlyRule<WorkHoursConfig>('WORK_HOURS', now, client);
}
