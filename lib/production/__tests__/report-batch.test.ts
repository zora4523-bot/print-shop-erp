import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionReportEntryType } from '@/generated/prisma/enums';

const dbMock = vi.hoisted(() => ({
  productionReport: { count: vi.fn() },
  productionProgressReport: { count: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
import { defaultReportBatch } from '../report-batch';

describe('defaultReportBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.productionReport.count.mockResolvedValue(0);
    dbMock.productionProgressReport.count.mockResolvedValue(0);
  });

  it('counts only the reporter\'s own live report rows on the piecework operation', async () => {
    dbMock.productionReport.count.mockResolvedValue(2);
    await expect(defaultReportBatch('operation', 'op-1', 'worker-1')).resolves.toBe(2);
    expect(dbMock.productionReport.count).toHaveBeenCalledWith({
      where: { operationId: 'op-1', reporterId: 'worker-1', entryType: ProductionReportEntryType.REPORT },
    });
    expect(dbMock.productionProgressReport.count).not.toHaveBeenCalled();
  });

  it('counts the reporter\'s own rows on the no-pay progress step', async () => {
    dbMock.productionProgressReport.count.mockResolvedValue(1);
    await expect(defaultReportBatch('progress', 'step-1', 'worker-1')).resolves.toBe(1);
    expect(dbMock.productionProgressReport.count).toHaveBeenCalledWith({
      where: { progressStepId: 'step-1', reporterId: 'worker-1' },
    });
    expect(dbMock.productionReport.count).not.toHaveBeenCalled();
  });

  it('starts a first-time reporter at batch 0', async () => {
    await expect(defaultReportBatch('operation', 'op-1', 'worker-new')).resolves.toBe(0);
  });
});
