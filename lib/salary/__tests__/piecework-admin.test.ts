import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  Role,
  WorkerType,
} from '../../../generated/prisma/client';

const { dbMock, txMock } = vi.hoisted(() => {
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
    dbMock: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createWorkerMachineSalaryRule,
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
      createdById: 'owner-1',
    });

    expect(txMock.$executeRaw).toHaveBeenCalled();
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
  });
});
