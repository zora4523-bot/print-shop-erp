import { describe, expect, it, vi } from 'vitest';
import { ProductionOperationStatus } from '../../../generated/prisma/enums';
import { planPreviousProductionGenerationSupersedeInTx, supersedePreviousProductionGenerationInTx } from '../generation-supersede';

// 审计 M-7：生产中批准修改申请升版后，上一代次未结束的工序再也不能报工，永远停在进行中，
// 分档烫金的计件结算因此被永久挡住。升版事务必须把旧代次终止，带分档报工的转人工核定。
const UNFINISHED = [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS];
const tieredBook = { rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: '12.0000' }] };
const flatBook = { rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: null }] };

function txMock(operations: unknown[], steps: unknown[] = []) {
  return {
    productionOperation: {
      findMany: vi.fn().mockResolvedValue(operations),
      updateMany: vi.fn().mockResolvedValue({ count: operations.length }),
    },
    productionProgressStep: {
      findMany: vi.fn().mockResolvedValue(steps),
      updateMany: vi.fn().mockResolvedValue({ count: steps.length }),
    },
  };
}

describe('supersedePreviousProductionGenerationInTx', () => {
  it('cancels unfinished older-generation rows and routes tiered foil wages to manual review', async () => {
    const tx = txMock([
      { id: 'tiered', operationType: 'PARTIAL', reports: [{ unit: 'PER_PASS', priceBook: tieredBook }] },
      { id: 'flat', operationType: 'PARTIAL', reports: [{ unit: 'PER_PASS', priceBook: flatBook }] },
      { id: 'other-unit', operationType: 'PARTIAL', reports: [{ unit: 'PER_PIECE', priceBook: tieredBook }] },
      { id: 'packing', operationType: 'PACKING', reports: [{ unit: 'PER_BAG', priceBook: { rules: [{ operationType: 'PACKING', unit: 'PER_BAG', smallOrderAmount: '1.0000' }] } }] },
      { id: 'pending', operationType: 'FULL', reports: [] },
    ], [{ id: 'step-old' }]);

    const result = await supersedePreviousProductionGenerationInTx(tx as never, 'order-1', 3);

    const superseded = { orderId: 'order-1', workOrderVersion: { lt: 3 }, status: { in: UNFINISHED } };
    expect(tx.productionOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: superseded }));
    expect(tx.productionOperation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tiered'] } },
      data: { payrollReviewRequired: true },
    });
    expect(tx.productionOperation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tiered', 'flat', 'other-unit', 'packing', 'pending'] }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(tx.productionProgressStep.findMany).toHaveBeenCalledWith({ where: superseded, select: { id: true } });
    expect(tx.productionProgressStep.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['step-old'] }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(result).toEqual({
      operationIds: ['tiered', 'flat', 'other-unit', 'packing', 'pending'],
      payrollReviewOperationIds: ['tiered'],
      progressStepIds: ['step-old'],
    });
  });

  it('writes nothing when the previous generation already finished', async () => {
    const tx = txMock([]);
    await expect(supersedePreviousProductionGenerationInTx(tx as never, 'order-1', 2)).resolves.toEqual({
      operationIds: [], payrollReviewOperationIds: [], progressStepIds: [],
    });
    expect(tx.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(tx.productionProgressStep.updateMany).not.toHaveBeenCalled();
  });

  it('plan 只读：与终止同一口径列出旧代次与需人工核定的工序，不写入', async () => {
    const tx = txMock([
      { id: 'tiered', operationType: 'PARTIAL', reports: [{ unit: 'PER_PASS', priceBook: tieredBook }] },
      { id: 'flat', operationType: 'PARTIAL', reports: [{ unit: 'PER_PASS', priceBook: flatBook }] },
    ], [{ id: 'step-old' }]);
    await expect(planPreviousProductionGenerationSupersedeInTx(tx as never, 'order-1', 3)).resolves.toEqual({
      operationIds: ['tiered', 'flat'], payrollReviewOperationIds: ['tiered'], progressStepIds: ['step-old'],
    });
    expect(tx.productionOperation.updateMany).not.toHaveBeenCalled();
    expect(tx.productionProgressStep.updateMany).not.toHaveBeenCalled();
  });
});
