import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  SalaryAdjustmentType,
} from '../../../generated/prisma/client';

vi.mock('@/lib/db', () => ({ db: {} }));

import {
  buildPieceworkWorkbook,
  machineRuleAuditValues,
} from '../piecework-xlsx';

describe('machineRuleAuditValues', () => {
  it('exports the inclusive threshold and large-order setup fee explicitly', () => {
    expect(
      machineRuleAuditValues({
        dailyBase: 120,
        pieceRate: 0.01,
        boardRate: 0,
        smallOrderThreshold: 1000,
        smallOrderInclusive: true,
        smallOrderFlatPrice: 20,
        largeOrderSetupFee: 10,
        multiplierFactors: ['DOUBLE_COLOR'],
      }),
    ).toEqual({
      dailyBase: 120,
      pieceRate: 0.01,
      boardRate: 0,
      smallOrderThreshold: 1000,
      smallOrderInclusive: '是（≤）',
      smallOrderFlatPrice: 20,
      largeOrderSetupFee: 10,
      multiplierFactors: 'DOUBLE_COLOR',
    });
  });

  it('exports a strict threshold distinctly and leaves absent thresholds blank', () => {
    expect(
      machineRuleAuditValues({
        smallOrderThreshold: 1000,
        smallOrderInclusive: false,
      }).smallOrderInclusive,
    ).toBe('否（<）');
    expect(machineRuleAuditValues({}).smallOrderInclusive).toBe('');
  });
});

describe('buildPieceworkWorkbook', () => {
  it('creates a valid OOXML zip with summary, task detail and adjustment sheets', async () => {
    const workbook = await buildPieceworkWorkbook([
      {
        id: 'salary-1',
        workerId: 'worker-1',
        date: new Date('2026-07-19T00:00:00Z'),
        machineType: MachineType.HAND_PRESS,
        baseSalary: '100.00',
        totalPieceworkAmount: '128.50',
        adjustmentAmount: '10.00',
        actualSalary: '138.50',
        taskCount: 1,
        orderCount: 1,
        calculationDetail: null,
        salaryRuleSnapshot: {},
        isPaid: false,
        paidAt: null,
        createdAt: new Date('2026-07-19T08:00:00Z'),
        worker: { displayName: '张师傅', username: 'zhang' },
        items: [
          {
            id: 'item-1',
            dailySalaryId: 'salary-1',
            productionTaskId: 'task-1',
            orderId: 'order-1',
            orderNo: '20260719-0001',
            orderItemId: 'oi-1',
            orderItemName: '红包款式 A',
            craftId: 'craft-1',
            craftName: '烫金',
            machineType: MachineType.HAND_PRESS,
            completedQty: 1000,
            defectQty: 5,
            reworkQty: 2,
            boardCount: 2,
            pressCount: 2014,
            pieceworkAmount: '128.50',
            salaryRuleSnapshot: {},
            completedAt: new Date('2026-07-19T04:00:00Z'),
            createdAt: new Date('2026-07-19T08:00:00Z'),
          },
        ],
        adjustments: [
          {
            id: 'adjustment-1',
            dailySalaryId: 'salary-1',
            type: SalaryAdjustmentType.BONUS,
            amount: '10.00',
            reason: '急单奖励',
            createdById: 'owner-1',
            createdAt: new Date('2026-07-19T09:00:00Z'),
            createdBy: { displayName: '管理员' },
          },
        ],
      },
    ] as never);

    expect(workbook.subarray(0, 2).toString()).toBe('PK');
    expect(workbook.byteLength).toBeGreaterThan(2500);
    const binary = workbook.toString('latin1');
    expect(binary).toContain('xl/worksheets/sheet1.xml');
    expect(binary).toContain('xl/worksheets/sheet2.xml');
    expect(binary).toContain('xl/worksheets/sheet3.xml');
    expect(binary).toContain('xl/workbook.xml');
  });
});
