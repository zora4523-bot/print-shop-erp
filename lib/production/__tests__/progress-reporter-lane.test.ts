import { describe, expect, it, vi } from 'vitest';
import { MachineType, Role, WorkerType } from '../../../generated/prisma/enums';
import { progressCraftIdsForReporter } from '../progress-reporter-lane';
import type { Prisma } from '../../../generated/prisma/client';

describe('progress craft lane', () => {
  const account = { role: Role.WORKER, isActive: true, workerType: WorkerType.MACHINE, machineType: MachineType.GLUE };
  function client() {
    const findMany = vi.fn().mockResolvedValue([{ id: 'gluing' }]);
    return { findMany, db: { craft: { findMany } } as unknown as Pick<Prisma.TransactionClient, 'craft'> };
  }
  it.each([
    { role: Role.ADMIN }, { isActive: false }, { workerType: null }, { machineType: null },
  ])('fails closed for an invalid or unconfigured reporter: %j', async override => {
    const { db, findMany } = client();
    expect(await progressCraftIdsForReporter(db, { ...account, ...override })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('requires matching machine lane, active in-house craft and supports configured compatible machines', async () => {
    const { db, findMany } = client();
    expect(await progressCraftIdsForReporter(db, account)).toEqual(['gluing']);
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true, isOutsource: false, defaultWorkerType: 'MACHINE', OR: [
      { inHouseMachineTypes: { has: 'GLUE' } },
      { inHouseMachineTypes: { isEmpty: true }, defaultMachineType: 'GLUE' },
    ] }, select: { id: true } });
  });
  it('non-machine lane uses job type without imposing a personal assignment', async () => {
    const { db, findMany } = client();
    await progressCraftIdsForReporter(db, { ...account, workerType: WorkerType.PACKER, machineType: null });
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true, isOutsource: false, defaultWorkerType: 'PACKER' }, select: { id: true } });
  });
});
