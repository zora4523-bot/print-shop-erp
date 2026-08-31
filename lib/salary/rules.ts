import { SalaryRuleType } from '../../generated/prisma/enums';
import { db } from '../db';
import type { CsTiersConfig } from './cs-commission';

// 最小客户端面：既接全局 db，也接 $transaction 的 tx（结算类调用必须
// 传 tx，让规则读参与结算快照的事务隔离——见 settleCsPeriod）。直接复用
// Prisma delegate 的函数类型，避免用 unknown 重写参数后破坏函数参数逆变兼容性。
export type SalaryRuleClient = {
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

// Finance calculations read several independently versioned rows. A shared
// advisory lock lets payroll readers run concurrently while excluding the
// admin writer, so one immutable snapshot cannot mix rows from before and
// after the same rule edit under PostgreSQL READ COMMITTED.
export async function acquireSalaryRuleSnapshotReadLock(
  client: SalaryRuleSnapshotLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${SALARY_RULE_SNAPSHOT_LOCK_KEY}))`;
}

export async function acquireSalaryRuleSnapshotWriteLock(
  client: SalaryRuleSnapshotLockClient,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SALARY_RULE_SNAPSHOT_LOCK_KEY}))`;
}

// 版本化规则"当前生效"查询的**唯一实现**（此前同形 findFirst 复制
// 6 处：machine/cs/hourly/cook + cs.ts 的 tx 版）。语义：effectiveFrom
// <= now 中最新一条，且 effectiveTo 为 null 或 > now。
// ruleValue 是 Prisma Json——形状由 seed / owner 规则编辑器在写入侧
// 保证，读侧信任断言为 T。
export async function getActiveRuleValue<T>(
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
// CS (客服) rules — SPEC §5.3
// ─────────────────────────────────────────────────────────────────────
//
// Three rule keys under ruleType=CS_COMMISSION:
//   - CS_BASE_SALARY:  ruleValue = { monthlyBase: number }
//   - CS_PERIOD_LENGTH: ruleValue = { months: number }
//   - CS_TIERS:        ruleValue = { mode: 'FLAT', tiers: [...] }
//
// All three together define the commission scheme. We fetch the
// active version of each at period start / settle time and snapshot
// the tier config onto CustomerServiceCommission (via tierRate +
// totalSales, which is enough to reproduce the applied tier).

async function getActiveCsRule<T>(
  ruleKey: string,
  now: Date,
): Promise<T | null> {
  return getActiveRuleValue<T>(SalaryRuleType.CS_COMMISSION, ruleKey, now);
}

export async function getActiveCsTiers(
  now: Date = new Date(),
): Promise<CsTiersConfig | null> {
  return getActiveCsRule<CsTiersConfig>('CS_TIERS', now);
}

// ─────────────────────────────────────────────────────────────────────
// 时薪工 (CLEANER / COOK) rules — PACKER 已切换工序计件
// ─────────────────────────────────────────────────────────────────────
//
// Rule keys under WORKER_HOURLY:
//   - CLEANER_HOURLY:   { hourlyRate }
//   - COOK_SPARE_HOURLY:{ hourlyRate }  // = PACKER rate per SPEC §5.4
//   - OT_MULTIPLIER:    { multiplier }
//   - WORK_HOURS:       { morning, afternoon, otStart } — 不硬编码
//
// COOK_MONTHLY lives under its own ruleType COOK_SALARY for the same
// dictionary-family-per-rule pattern.

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

export async function getActiveCleanerHourlyRate(
  now: Date = new Date(),
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ hourlyRate: number }>(
    'CLEANER_HOURLY',
    now,
    client,
  );
  return v?.hourlyRate ?? null;
}

// COOK 空闲时间打包按 PACKER 时薪的独立规则（SPEC §5.4 "spare_pay =
// attendance.spareHours * packer_rule.hourlyRate"）。单独一条规则
// key 让管理员可以把"厨师打包兼职时薪"和主 PACKER_HOURLY 解耦调整。
export async function getActiveCookSpareHourlyRate(
  now: Date = new Date(),
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ hourlyRate: number }>(
    'COOK_SPARE_HOURLY',
    now,
    client,
  );
  return v?.hourlyRate ?? null;
}

export async function getActiveOtMultiplier(
  now: Date = new Date(),
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<number | null> {
  const v = await getActiveHourlyRule<{ multiplier: number }>(
    'OT_MULTIPLIER',
    now,
    client,
  );
  return v?.multiplier ?? null;
}

export type WorkHoursConfig = {
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

// COOK_SALARY / COOK_MONTHLY — separate ruleType from WORKER_HOURLY.
export async function getActiveCookMonthlyBase(
  now: Date = new Date(),
  client: SalaryRuleClient = db as unknown as SalaryRuleClient,
): Promise<number | null> {
  const v = await getActiveRuleValue<{ monthlyBase: number }>(
    SalaryRuleType.COOK_SALARY,
    'COOK_MONTHLY',
    now,
    client,
  );
  return v?.monthlyBase ?? null;
}
