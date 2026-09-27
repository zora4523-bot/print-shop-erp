import { z } from 'zod';
import {
  Prisma,
  SalaryRuleType,
} from '../../generated/prisma/client';
import { parseStrictShanghaiDateTimeLocal } from '@/lib/auth/schemas';
import { writeAuditLogInTx, type AuditActor } from '@/lib/audit-log';
import { db } from '@/lib/db';
import {
  acquireSalaryRuleSnapshotWriteLock,
  salaryRuleLockKey,
} from './rules';
import {
  SALARY_RULE_CATALOG,
  SALARY_RULE_KEYS,
  type SalaryRuleKey,
  type SalaryRuleValue,
} from './rule-catalog';

export type { SalaryRuleKey, SalaryRuleValue } from './rule-catalog';

export { salaryRuleLockKey } from './rules';

// This module is the only write path for the shared (non-piecework) salary
// rules.  A role decides who receives a salary; this rule dictionary only
// decides the formula.  Keeping the dictionary explicit prevents a packing
// rate from accidentally becoming a sales commission or vice versa.

const timeText = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须为 HH:mm');

const ruleKeySchema = z.enum(SALARY_RULE_KEYS);

export type SalaryRuleDefinition = {
  key: SalaryRuleKey;
  ruleType: SalaryRuleType;
  label: string;
  description: string;
};

const RULE_TYPE_BY_KEY: Record<SalaryRuleKey, SalaryRuleType> = {
  WORK_HOURS: SalaryRuleType.WORKER_HOURLY,
};

export const SALARY_RULE_DEFINITIONS: readonly SalaryRuleDefinition[] =
  SALARY_RULE_CATALOG.map((entry) => ({
    ...entry,
    ruleType: RULE_TYPE_BY_KEY[entry.key],
  }));

const definitionByKey = new Map(
  SALARY_RULE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

const baseInput = z.object({
  ruleKey: ruleKeySchema,
  effectiveFrom: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = parseStrictShanghaiDateTimeLocal(value);
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: '请选择合法的上海时间' });
        return z.NEVER;
      }
      return parsed;
    }),
  remark: z.string().trim().max(200, '备注最多 200 字').optional(),
});

const salaryRuleVersionRawSchema = z.discriminatedUnion('ruleKey', [
  baseInput.extend({
    ruleKey: z.literal('WORK_HOURS'),
    morningStart: timeText,
    morningEnd: timeText,
    afternoonStart: timeText,
    afternoonEnd: timeText,
    otStart: timeText,
  }),
]);

export const salaryRuleVersionInputSchema = salaryRuleVersionRawSchema
  .superRefine((input, ctx) => {
    if (input.ruleKey === 'WORK_HOURS') {
      const morningStart = timeMinutes(input.morningStart);
      const morningEnd = timeMinutes(input.morningEnd);
      const afternoonStart = timeMinutes(input.afternoonStart);
      const afternoonEnd = timeMinutes(input.afternoonEnd);
      const otStart = timeMinutes(input.otStart);
      if (morningStart >= morningEnd) {
        ctx.addIssue({ code: 'custom', path: ['morningEnd'], message: '上午下班时间必须晚于上班时间' });
      }
      if (afternoonStart >= afternoonEnd) {
        ctx.addIssue({ code: 'custom', path: ['afternoonEnd'], message: '下午下班时间必须晚于上班时间' });
      }
      if (morningEnd > afternoonStart) {
        ctx.addIssue({ code: 'custom', path: ['afternoonStart'], message: '下午上班时间不能早于上午下班时间' });
      }
      if (otStart < afternoonEnd) {
        ctx.addIssue({ code: 'custom', path: ['otStart'], message: '加班起点不能早于下午下班时间' });
      }
    }
  })
  .transform((input): SalaryRuleVersionInput => {
    const common = {
      ruleKey: input.ruleKey,
      effectiveFrom: input.effectiveFrom,
      remark: input.remark || null,
    };
    switch (input.ruleKey) {
      case 'WORK_HOURS':
        return {
          ...common,
          ruleValue: {
            morning: { start: input.morningStart, end: input.morningEnd },
            afternoon: { start: input.afternoonStart, end: input.afternoonEnd },
            otStart: input.otStart,
          },
        };
    }
  });

export type SalaryRuleVersionInput = {
  ruleKey: SalaryRuleKey;
  effectiveFrom: Date;
  remark: string | null;
  ruleValue: SalaryRuleValue;
};

export class SalaryRuleAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalaryRuleAdminError';
  }
}

export function parseSalaryRuleVersionFormData(formData: FormData) {
  return salaryRuleVersionInputSchema.safeParse({
    ruleKey: formData.get('ruleKey'),
    effectiveFrom: formData.get('effectiveFrom'),
    remark: formData.get('remark') || undefined,
    morningStart: formData.get('morningStart'),
    morningEnd: formData.get('morningEnd'),
    afternoonStart: formData.get('afternoonStart'),
    afternoonEnd: formData.get('afternoonEnd'),
    otStart: formData.get('otStart'),
  });
}

export type SalaryRuleSettingsData = Record<
  SalaryRuleKey,
  | {
      id: string;
      ruleType: SalaryRuleType;
      ruleValue: SalaryRuleValue;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      remark: string | null;
    }
  | null
>;

export async function listSalaryRuleSettings(now = new Date()): Promise<SalaryRuleSettingsData> {
  const rows = await db.salaryRule.findMany({
    where: {
      OR: SALARY_RULE_DEFINITIONS.map((definition) => ({
        ruleType: definition.ruleType,
        ruleKey: definition.key,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      })),
    },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      ruleType: true,
      ruleKey: true,
      ruleValue: true,
      effectiveFrom: true,
      effectiveTo: true,
      remark: true,
    },
  });

  const out = Object.fromEntries(
    SALARY_RULE_DEFINITIONS.map((definition) => [definition.key, null]),
  ) as SalaryRuleSettingsData;
  for (const row of rows) {
    const key = row.ruleKey as SalaryRuleKey;
    const definition = definitionByKey.get(key);
    if (!definition || definition.ruleType !== row.ruleType || out[key]) continue;
    out[key] = {
      id: row.id,
      ruleType: row.ruleType,
      ruleValue: row.ruleValue as unknown as SalaryRuleValue,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      remark: row.remark,
    };
  }
  return out;
}

export async function createSalaryRuleVersion(
  input: SalaryRuleVersionInput,
  actor: AuditActor,
) {
  const definition = definitionByKey.get(input.ruleKey);
  if (!definition) throw new SalaryRuleAdminError('不支持的工资规则键');

  return db.$transaction(async (tx) => {
    await acquireSalaryRuleSnapshotWriteLock(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryRuleLockKey(
      definition.ruleType,
      input.ruleKey,
    )}))`;

    const duplicate = await tx.salaryRule.findUnique({
      where: {
        ruleType_ruleKey_effectiveFrom: {
          ruleType: definition.ruleType,
          ruleKey: input.ruleKey,
          effectiveFrom: input.effectiveFrom,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new SalaryRuleAdminError('该规则在同一生效时间已有版本');
    }

    const next = await tx.salaryRule.findFirst({
      where: {
        ruleType: definition.ruleType,
        ruleKey: input.ruleKey,
        effectiveFrom: { gt: input.effectiveFrom },
      },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });

    const previous = await tx.salaryRule.findMany({
      where: {
        ruleType: definition.ruleType,
        ruleKey: input.ruleKey,
        effectiveFrom: { lt: input.effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveFrom } }],
      },
      select: { id: true, ruleValue: true, effectiveFrom: true, effectiveTo: true, remark: true },
    });

    await tx.salaryRule.updateMany({
      where: { id: { in: previous.map((rule) => rule.id) } },
      data: { effectiveTo: input.effectiveFrom },
    });

    const created = await tx.salaryRule.create({
      data: {
        ruleType: definition.ruleType,
        ruleKey: input.ruleKey,
        ruleValue: input.ruleValue as unknown as Prisma.InputJsonValue,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: next?.effectiveFrom ?? null,
        remark: input.remark,
      },
      select: {
        id: true,
        ruleType: true,
        ruleKey: true,
        ruleValue: true,
        effectiveFrom: true,
        effectiveTo: true,
        remark: true,
      },
    });

    await writeAuditLogInTx(tx, {
      actor,
      action: 'CREATE_VERSION',
      entityType: 'SalaryRule',
      entityId: created.id,
      before: previous.length === 1 ? previous[0] : { closedVersions: previous },
      after: created,
      requestMetadata: {
        source: 'owner-salary-rules.createSalaryRuleVersion',
        ruleType: definition.ruleType,
        ruleKey: input.ruleKey,
      },
    });
    return created;
  });
}
