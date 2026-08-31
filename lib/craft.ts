import {
  type Craft,
  type MachineType,
  WorkerType,
} from '../generated/prisma/client';
import { resolveBusinessCode } from './business-code';
import { db } from './db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { acquirePriceRuleSnapshotWriteLock } from './price/rule-snapshot-lock';

// Thrown when a mutation is refused for a reason the UI should surface,
// not a generic 500. Same pattern as AccountInvariantError in lib/account.ts.
export class CraftInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CraftInvariantError';
  }
}

export type CraftSummary = Pick<
  Craft,
  | 'id'
  | 'name'
  | 'code'
  | 'isOutsource'
  | 'defaultWorkerType'
  | 'defaultMachineType'
  | 'sortOrder'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

export type CraftOrderOption = Pick<
  Craft,
  'id' | 'name' | 'code' | 'isOutsource'
> & {
  isLowFrequency: boolean;
};

const LOW_FREQUENCY_SORT_ORDER = 900;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  isOutsource: true,
  defaultWorkerType: true,
  defaultMachineType: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Stable order for list views: active first, then by sortOrder, then by
// name as a tiebreaker. Foreman / sales pick from this list during order
// entry (future slice), so putting active-and-early crafts at the top
// matters.
export async function listCrafts(): Promise<CraftSummary[]> {
  return db.craft.findMany({
    select: SUMMARY_SELECT,
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function listCraftsPage(opts: {
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<CraftSummary>> {
  const total = await db.craft.count();
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.craft.findMany({
    select: SUMMARY_SELECT,
    orderBy: [
      { isActive: 'desc' },
      { sortOrder: 'asc' },
      { name: 'asc' },
      { id: 'asc' },
    ],
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows, total, window);
}

export async function listActiveCraftOrderOptions(): Promise<
  CraftOrderOption[]
> {
  const rows = await db.craft.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      isOutsource: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
  return rows.map(({ sortOrder, ...craft }) => ({
    ...craft,
    isLowFrequency: sortOrder >= LOW_FREQUENCY_SORT_ORDER,
  }));
}

export async function getCraftSummary(id: string): Promise<CraftSummary | null> {
  return db.craft.findUnique({ where: { id }, select: SUMMARY_SELECT });
}

export type CreateCraftData = {
  name: string;
  code: string | null;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  sortOrder: number;
};

export async function createCraft(data: CreateCraftData): Promise<CraftSummary> {
  const code = await resolveBusinessCode('CRAFT', data.code);
  const assignment = normalizeCraftAssignment(data);
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    return tx.craft.create({
      data: {
        name: data.name,
        code,
        isOutsource: data.isOutsource,
        ...assignment,
        sortOrder: data.sortOrder,
        isActive: true,
      },
      select: SUMMARY_SELECT,
    });
  });
}

// Activation is owned by setCraftActive, not this update path — see
// lib/account.ts for the rationale.
export type UpdateCraftData = {
  name: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  sortOrder: number;
};

export async function updateCraft(
  id: string,
  data: UpdateCraftData,
): Promise<CraftSummary> {
  const assignment = normalizeCraftAssignment(data);

  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.craft.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) throw new CraftInvariantError('目标工艺不存在');

    return tx.craft.update({
      where: { id },
      data: {
        name: data.name,
        isOutsource: data.isOutsource,
        ...assignment,
        sortOrder: data.sortOrder,
      },
      select: SUMMARY_SELECT,
    });
  });
}

function normalizeCraftAssignment(data: {
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
}): {
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
} {
  if (data.isOutsource) {
    return {
      defaultWorkerType: null,
      defaultMachineType: data.defaultMachineType,
    };
  }
  if (!data.defaultWorkerType) {
    throw new CraftInvariantError('自产工艺必须选择接单岗位');
  }
  if (data.defaultWorkerType === WorkerType.COOK) {
    throw new CraftInvariantError('厨师不能作为生产工艺的接单岗位');
  }
  if (
    data.defaultWorkerType === WorkerType.MACHINE &&
    !data.defaultMachineType
  ) {
    throw new CraftInvariantError('开机工艺必须选择机型');
  }
  if (
    data.defaultWorkerType !== WorkerType.MACHINE &&
    data.defaultMachineType
  ) {
    throw new CraftInvariantError('非开机岗位不应设置机型');
  }
  return {
    defaultWorkerType: data.defaultWorkerType,
    defaultMachineType:
      data.defaultWorkerType === WorkerType.MACHINE
        ? data.defaultMachineType
        : null,
  };
}

// Soft-delete only. Crafts are referenced by ProductionTask rows; a hard
// delete would break historical tasks / salary records that reference the
// craft by id. Operators flip isActive to hide from new-order pickers.
export async function setCraftActive(
  id: string,
  isActive: boolean,
): Promise<CraftSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.craft.findUnique({
      where: { id },
      select: SUMMARY_SELECT,
    });
    if (!target) throw new CraftInvariantError('目标工艺不存在');
    if (target.isActive === isActive) return target;

    return tx.craft.update({
      where: { id },
      data: { isActive },
      select: SUMMARY_SELECT,
    });
  });
}
