import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const { dbMock, txMock, auditMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    workerMachineSalaryRule: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    txMock: tx,
    auditMock: { writeAuditLogInTx: vi.fn() },
    dbMock: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      user: { findMany: vi.fn() },
      salaryRule: { findMany: vi.fn() },
      workerMachineSalaryRule: { findMany: vi.fn() },
    },
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLogInTx: auditMock.writeAuditLogInTx,
}));

import {
  createWorkerMachineSalaryRule,
  listPieceworkRuleManagementData,
  salaryAdjustmentInputSchema,
  workerMachineRuleInputSchema,
} from '../piecework-admin';

function validInput() {
  return {
    workerId: 'worker-1',
    machineType: MachineType.HAND_PRESS,
    dailyBase: '120',
    pieceRate: '0.0085',
    boardRate: '5',
    smallOrderThreshold: '1000',
    smallOrderFlatPrice: '15',
    multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
    effectiveFrom: '2026-07-19T09:30',
    remark: '个人议价',
  };
}

describe('workerMachineRuleInputSchema', () => {
  it('不向管理端暴露机型和倍率的内部枚举', () => {
    const invalidMachine = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      machineType: 'INTERNAL_MACHINE_TYPE',
    });
    const invalidFactor = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      multiplierFactors: ['INTERNAL_MULTIPLIER'],
    });

    expect(invalidMachine.success).toBe(false);
    expect(invalidFactor.success).toBe(false);
    if (!invalidMachine.success && !invalidFactor.success) {
      const visibleErrors = [
        ...invalidMachine.error.issues,
        ...invalidFactor.error.issues,
      ]
        .map((issue) => issue.message)
        .join('\n');
      expect(visibleErrors).toContain('请选择有效的机型');
      expect(visibleErrors).toContain('请选择有效的计件倍率条件');
      expect(visibleErrors).not.toContain('INTERNAL_MACHINE_TYPE');
      expect(visibleErrors).not.toContain('INTERNAL_MULTIPLIER');
      expect(visibleErrors).not.toContain('DOUBLE_SIDED');
      expect(visibleErrors).not.toContain('DOUBLE_COLOR');
    }
  });

  it('interprets datetime-local as a Shanghai business instant', () => {
    const parsed = workerMachineRuleInputSchema.parse(validInput());
    expect(parsed.effectiveFrom.toISOString()).toBe('2026-07-19T01:30:00.000Z');
    expect(parsed.ruleValue).toMatchObject({
      dailyBase: '120',
      pieceRate: '0.0085',
      smallOrderThreshold: 1000,
    });
  });

  it('rejects a missing effective time instead of coercing it to 1970', () => {
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        effectiveFrom: null,
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid calendar date instead of rolling it into March', () => {
    const result = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      effectiveFrom: '2026-02-31T09:30',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: '生效时间不合法' }),
        ]),
      );
    }
  });

  it('supports no small-order threshold but rejects negative rates', () => {
    const noThreshold = workerMachineRuleInputSchema.parse({
      ...validInput(),
      smallOrderThreshold: '',
    });
    expect(noThreshold.ruleValue.smallOrderThreshold).toBeNull();
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        pieceRate: '-0.01',
      }).success,
    ).toBe(false);
  });

  it('rejects zero as a small-order threshold', () => {
    const result = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      smallOrderThreshold: '0',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['smallOrderThreshold'],
            message: '请输入正整数',
          }),
        ]),
      );
    }
  });

  it('rejects a rate that can overflow Decimal(10,2) on the largest task', () => {
    const result = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      pieceRate: '3',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['pieceRate'],
            message: expect.stringContaining('溢出'),
          }),
        ]),
      );
    }
  });

  it('uses completed + defect + rework as the rule-bound worst case', () => {
    const unsafe = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      pieceRate: '1',
      boardRate: '0',
      largeOrderSetupFee: '0',
    });
    expect(unsafe.success).toBe(false);

    const safe = workerMachineRuleInputSchema.safeParse({
      ...validInput(),
      pieceRate: '0.8',
      boardRate: '0',
      largeOrderSetupFee: '0',
    });
    expect(safe.success).toBe(true);
  });

  it('rejects duplicate multiplier factors', () => {
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        multiplierFactors: ['DOUBLE_COLOR', 'DOUBLE_COLOR'],
      }).success,
    ).toBe(false);
  });

  it('keeps fixed salary amounts at cents while allowing four-decimal unit rates', () => {
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        dailyBase: '120.001',
      }).success,
    ).toBe(false);
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        smallOrderFlatPrice: '20.001',
      }).success,
    ).toBe(false);
    expect(
      workerMachineRuleInputSchema.safeParse({
        ...validInput(),
        pieceRate: '0.0085',
        boardRate: '5.1234',
      }).success,
    ).toBe(true);
  });
});

describe('salaryAdjustmentInputSchema', () => {
  it('requires a UUID request key for retry-safe money writes', () => {
    const valid = {
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      dailySalaryId: 'salary-1',
      type: 'BONUS',
      amount: '20.00',
      reason: '急单奖励',
    };
    expect(salaryAdjustmentInputSchema.safeParse(valid).success).toBe(true);
    expect(
      salaryAdjustmentInputSchema.safeParse({
        ...valid,
        idempotencyKey: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('listPieceworkRuleManagementData', () => {
  it('includes an active machine worker registered only through machine capabilities', async () => {
    const capabilityOnlyWorker = {
      id: 'worker-capability-only',
      displayName: '多能机师傅',
      username: 'capability-only',
      machineType: null,
      machineCapabilities: [MachineType.WINDMILL],
    };
    dbMock.user.findMany.mockResolvedValue([capabilityOnlyWorker]);
    dbMock.salaryRule.findMany.mockResolvedValue([]);
    dbMock.workerMachineSalaryRule.findMany.mockResolvedValue([]);

    const result = await listPieceworkRuleManagementData(
      new Date('2026-07-19T01:30:00Z'),
    );

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: Role.WORKER,
          workerType: WorkerType.MACHINE,
          isActive: true,
          OR: [
            { machineType: { not: null } },
            { machineCapabilities: { isEmpty: false } },
          ],
        },
      }),
    );
    expect(result.workers).toEqual([capabilityOnlyWorker]);
  });
});

describe('createWorkerMachineSalaryRule', () => {
  it('serializes the worker+machine key and closes the prior version', async () => {
    txMock.$executeRaw.mockResolvedValue(undefined);
    txMock.user.findUnique.mockResolvedValue({
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      isActive: true,
    });
    txMock.workerMachineSalaryRule.findUnique.mockResolvedValue(null);
    txMock.workerMachineSalaryRule.findFirst.mockResolvedValue(null);
    txMock.workerMachineSalaryRule.updateMany.mockResolvedValue({ count: 1 });
    txMock.workerMachineSalaryRule.create.mockResolvedValue({ id: 'rule-2' });
    const effectiveFrom = new Date('2026-07-19T01:30:00Z');

    await createWorkerMachineSalaryRule({
      workerId: 'worker-1',
      machineType: MachineType.HAND_PRESS,
      effectiveFrom,
      remark: '个人议价',
      ruleValue: workerMachineRuleInputSchema.parse(validInput()).ruleValue,
      actor: {
        id: 'owner-1',
        role: Role.ADMIN,
        username: 'owner',
        displayName: '管理员',
      },
    });

    expect(txMock.$executeRaw).toHaveBeenCalled();
    expect(txMock.$executeRaw.mock.calls[0][1]).toBe(
      'print-shop-erp:piecework-rule:worker-1:HAND_PRESS',
    );
    expect(txMock.workerMachineSalaryRule.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workerId: 'worker-1',
        machineType: MachineType.HAND_PRESS,
        effectiveFrom: { lt: effectiveFrom },
      }),
      data: { effectiveTo: effectiveFrom },
    });
    expect(txMock.workerMachineSalaryRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workerId: 'worker-1',
          effectiveFrom,
          effectiveTo: null,
          createdById: 'owner-1',
        }),
      }),
    );
    expect(auditMock.writeAuditLogInTx).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        actor: expect.objectContaining({ id: 'owner-1' }),
        action: 'CREATE',
        entityType: 'WorkerMachineSalaryRule',
        entityId: 'rule-2',
      }),
    );
  });

  it('allows a personal rule for a registered non-primary machine capability', async () => {
    txMock.$executeRaw.mockResolvedValue(undefined);
    txMock.user.findUnique.mockResolvedValue({
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      machineCapabilities: [
        MachineType.HAND_PRESS,
        MachineType.WINDMILL,
      ],
      isActive: true,
    });
    txMock.workerMachineSalaryRule.findUnique.mockResolvedValue(null);
    txMock.workerMachineSalaryRule.findFirst.mockResolvedValue(null);
    txMock.workerMachineSalaryRule.updateMany.mockResolvedValue({ count: 0 });
    txMock.workerMachineSalaryRule.create.mockResolvedValue({ id: 'rule-wind' });

    await expect(
      createWorkerMachineSalaryRule({
        workerId: 'worker-1',
        machineType: MachineType.WINDMILL,
        effectiveFrom: new Date('2026-07-20T01:30:00Z'),
        remark: '风车机支援价',
        ruleValue: workerMachineRuleInputSchema.parse(validInput()).ruleValue,
        actor: {
          id: 'owner-1',
          role: Role.ADMIN,
          username: 'owner',
          displayName: '管理员',
        },
      }),
    ).resolves.toEqual({ id: 'rule-wind' });
  });
});
