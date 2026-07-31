import { z } from 'zod';
import {
  MachineType,
  Role,
  SalaryAdjustmentType,
  SalaryRuleType,
  WorkerType,
  type Prisma,
} from '../../generated/prisma/client';
import { db } from '../db';
import type { MachineRuleWithBase } from './rules';

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:\.\d{1,4})?$/, '请输入非负数字，最多 4 位小数');

export const workerMachineRuleInputSchema = z
  .object({
    workerId: z.string().trim().min(1, '请选择师傅'),
    machineType: z.nativeEnum(MachineType),
    dailyBase: moneyString,
    pieceRate: moneyString,
    boardRate: moneyString,
    smallOrderThreshold: z
      .union([z.literal(''), z.string().trim().regex(/^\d{1,9}$/, '请输入正整数')]),
    smallOrderFlatPrice: moneyString,
    smallOrderInclusive: z.boolean().default(false),
    largeOrderSetupFee: moneyString.default('0'),
    multiplierFactors: z.array(
      z.enum(['DOUBLE_SIDED', 'DOUBLE_COLOR']),
    ),
    effectiveFrom: z
      .string()
      .trim()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
        '请选择完整的生效日期和时间',
      )
      .transform((value) => new Date(`${value}:00+08:00`))
      .refine((value) => !Number.isNaN(value.getTime()), {
        message: '生效时间不合法',
      }),
    remark: z.string().trim().max(200, '备注最多 200 字').optional(),
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
  createdById: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:piecework-rule:${input.workerId}:${input.machineType}`}))`;

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

    return tx.workerMachineSalaryRule.create({
      data: {
        workerId: input.workerId,
        machineType: input.machineType,
        ruleValue: input.ruleValue as unknown as Prisma.InputJsonValue,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: nextRule?.effectiveFrom ?? null,
        remark: input.remark,
        createdById: input.createdById,
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
  });
}
