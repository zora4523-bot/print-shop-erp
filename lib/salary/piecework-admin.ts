import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  MachineType,
  Role,
  SalaryAdjustmentType,
  SalaryRuleType,
  WorkerType,
  type Prisma,
} from '../../generated/prisma/client';
import { db } from '../db';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { RULE_CENTER_HREFS } from '../navigation/rule-center';
import {
  machineRuleLockKey,
  type MachineRuleWithBase,
} from './rules';

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:\.\d{1,4})?$/, '请输入非负数字，最多 4 位小数');

const storedMoneyString = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:\.\d{1,2})?$/, '请输入非负金额，最多 2 位小数');

const MAX_REPORT_COUNT_PER_FIELD = 10_000_000;
const REPORT_COUNT_FIELD_COUNT = 3;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseShanghaiLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, 0, 0);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return new Date(calendar.getTime() - SHANGHAI_OFFSET_MS);
}

export const workerMachineRuleInputSchema = z
  .object({
    workerId: z.string().trim().min(1, '请选择师傅'),
    machineType: z.nativeEnum(MachineType, {
      error: '请选择有效的机型',
    }),
    dailyBase: storedMoneyString,
    pieceRate: moneyString,
    boardRate: moneyString,
    smallOrderThreshold: z
      .union([
        z.literal(''),
        z.string().trim().regex(/^[1-9]\d{0,8}$/, '请输入正整数'),
      ]),
    smallOrderFlatPrice: storedMoneyString,
    smallOrderInclusive: z.boolean().default(false),
    largeOrderSetupFee: storedMoneyString.default('0'),
    multiplierFactors: z
      .array(
        z.enum(['DOUBLE_SIDED', 'DOUBLE_COLOR'], {
          error: '请选择有效的计件倍率条件',
        }),
      )
      .max(2, '倍率因子最多 2 项')
      .refine(
        (factors) => new Set(factors).size === factors.length,
        '倍率因子不能重复',
      ),
    effectiveFrom: z
      .string()
      .trim()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
        '请选择完整的生效日期和时间',
      )
      .transform((value, ctx) => {
        const parsed = parseShanghaiLocalDateTime(value);
        if (!parsed) {
          ctx.addIssue({ code: 'custom', message: '生效时间不合法' });
          return z.NEVER;
        }
        return parsed;
      }),
    remark: z.string().trim().max(200, '备注最多 200 字').optional(),
  })
  .superRefine((input, ctx) => {
    // ProductionTask.pieceworkAmount and DailyWorkerSalary amounts are
    // Decimal(10,2). A report accepts completed + defect + rework independently,
    // so the real worst case is 3 × 10,000,000 presses, not OrderItem.quantity.
    // Include every configured ×2 factor plus the one-board/setup terms.
    const maxStoredAmount = new Decimal('99999999.99');
    const multiplier = new Decimal(2).pow(
      new Set(input.multiplierFactors).size,
    );
    const maxTaskAmount = new Decimal(input.pieceRate)
      .times(MAX_REPORT_COUNT_PER_FIELD * REPORT_COUNT_FIELD_COUNT)
      .times(multiplier)
      .plus(new Decimal(input.boardRate).times(multiplier))
      .plus(new Decimal(input.largeOrderSetupFee));
    for (const [path, value] of [
      ['dailyBase', input.dailyBase],
      ['smallOrderFlatPrice', input.smallOrderFlatPrice],
    ] as const) {
      if (new Decimal(value).gt(maxStoredAmount)) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: '金额超过工资字段可保存上限 99,999,999.99 元',
        });
      }
    }
    if (maxTaskAmount.toDecimalPlaces(2).gt(maxStoredAmount)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pieceRate'],
        message: '该规则在最大工单数量和倍率下会使计件金额溢出，请降低单价',
      });
    }
  })
  .transform((input) => ({
    workerId: input.workerId,
    machineType: input.machineType,
    effectiveFrom: input.effectiveFrom,
    remark: input.remark || null,
    ruleValue: {
      dailyBase: input.dailyBase,
      pieceRate: input.pieceRate,
      boardRate: input.boardRate,
      smallOrderThreshold:
        input.smallOrderThreshold === ''
          ? null
          : Number(input.smallOrderThreshold),
      smallOrderFlatPrice: input.smallOrderFlatPrice,
      smallOrderInclusive: input.smallOrderInclusive,
      largeOrderSetupFee: input.largeOrderSetupFee,
      multiplierFactors: input.multiplierFactors,
    } satisfies MachineRuleWithBase,
  }));

export const salaryAdjustmentInputSchema = z.object({
  idempotencyKey: z.string().uuid('调整请求标识不合法'),
  dailySalaryId: z.string().trim().min(1, '日薪记录不能为空'),
  type: z.nativeEnum(SalaryAdjustmentType),
  amount: z
    .string()
    .trim()
    .regex(/^-?\d{1,7}(?:\.\d{1,2})?$/, '请输入金额，最多两位小数')
    .refine((value) => Number(value) !== 0, '调整金额不能为 0'),
  reason: z.string().trim().min(2, '请填写至少 2 个字的调整原因').max(200),
});

export class PieceworkRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PieceworkRuleError';
  }
}

export async function listPieceworkRuleManagementData(now = new Date()) {
  const [workers, globalRules, personalRules] = await Promise.all([
    db.user.findMany({
      where: {
        role: Role.WORKER,
        workerType: WorkerType.MACHINE,
        isActive: true,
        machineType: { not: null },
      },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        username: true,
        machineType: true,
        machineCapabilities: true,
      },
    }),
    db.salaryRule.findMany({
      where: {
        ruleType: SalaryRuleType.WORKER_MACHINE,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ ruleKey: 'asc' }, { effectiveFrom: 'desc' }],
      select: {
        id: true,
        ruleKey: true,
        ruleValue: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    db.workerMachineSalaryRule.findMany({
      orderBy: [
        { worker: { displayName: 'asc' } },
        { machineType: 'asc' },
        { effectiveFrom: 'desc' },
      ],
      select: {
        id: true,
        workerId: true,
        machineType: true,
        ruleValue: true,
        effectiveFrom: true,
        effectiveTo: true,
        remark: true,
        createdAt: true,
        worker: { select: { displayName: true, username: true } },
        createdBy: { select: { displayName: true } },
      },
    }),
  ]);

  // Keep only the newest active global version per machine. Historical
  // global versions remain in SalaryRule and are already snapshotted on tasks.
  const globalByMachine = new Map<string, (typeof globalRules)[number]>();
  for (const rule of globalRules) {
    if (!globalByMachine.has(rule.ruleKey)) {
      globalByMachine.set(rule.ruleKey, rule);
    }
  }
  return {
    workers,
    globalRules: [...globalByMachine.values()],
    personalRules,
  };
}

export async function createWorkerMachineSalaryRule(input: {
  workerId: string;
  machineType: MachineType;
  effectiveFrom: Date;
  remark: string | null;
  ruleValue: MachineRuleWithBase;
  actor: AuditActor;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machineRuleLockKey(
      input.workerId,
      input.machineType,
    )}))`;

    const worker = await tx.user.findUnique({
      where: { id: input.workerId },
      select: {
        role: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
        isActive: true,
      },
    });
    if (!worker || !worker.isActive) {
      throw new PieceworkRuleError('师傅不存在或已停用');
    }
    if (
      worker.role !== Role.WORKER ||
      worker.workerType !== WorkerType.MACHINE ||
      !(
        (worker.machineCapabilities?.length ?? 0) > 0
          ? worker.machineCapabilities
          : worker.machineType
            ? [worker.machineType]
            : []
      ).includes(input.machineType)
    ) {
      throw new PieceworkRuleError('只能为师傅已登记的机器能力设置计件规则');
    }

    const duplicate = await tx.workerMachineSalaryRule.findUnique({
      where: {
        workerId_machineType_effectiveFrom: {
          workerId: input.workerId,
          machineType: input.machineType,
          effectiveFrom: input.effectiveFrom,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new PieceworkRuleError('该师傅在同一生效时间已有规则');
    }

    const nextRule = await tx.workerMachineSalaryRule.findFirst({
      where: {
        workerId: input.workerId,
        machineType: input.machineType,
        effectiveFrom: { gt: input.effectiveFrom },
      },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });
    await tx.workerMachineSalaryRule.updateMany({
      where: {
        workerId: input.workerId,
        machineType: input.machineType,
        effectiveFrom: { lt: input.effectiveFrom },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: input.effectiveFrom } },
        ],
      },
      data: { effectiveTo: input.effectiveFrom },
    });

    const created = await tx.workerMachineSalaryRule.create({
      data: {
        workerId: input.workerId,
        machineType: input.machineType,
        ruleValue: input.ruleValue as unknown as Prisma.InputJsonValue,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: nextRule?.effectiveFrom ?? null,
        remark: input.remark,
        createdById: input.actor.id,
      },
      select: {
        id: true,
        workerId: true,
        machineType: true,
        ruleValue: true,
        effectiveFrom: true,
        effectiveTo: true,
        remark: true,
      },
    });
    await writeAuditLogInTx(tx, {
      actor: input.actor,
      action: 'CREATE',
      entityType: 'WorkerMachineSalaryRule',
      entityId: created.id,
      after: created,
      requestMetadata: {
        source: 'owner-salary.createWorkerMachineSalaryRuleAction',
        route: RULE_CENTER_HREFS.workerPiecework,
      },
    });
    return created;
  });
}
