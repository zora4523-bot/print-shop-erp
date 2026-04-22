import { type Craft, type MachineType } from '../generated/prisma/client';
import { db } from './db';

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
  | 'defaultMachineType'
  | 'sortOrder'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  isOutsource: true,
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

export async function getCraftSummary(id: string): Promise<CraftSummary | null> {
  return db.craft.findUnique({ where: { id }, select: SUMMARY_SELECT });
}

export type CreateCraftData = {
  name: string;
  code: string;
  isOutsource: boolean;
  defaultMachineType: MachineType | null;
  sortOrder: number;
};

export async function createCraft(data: CreateCraftData): Promise<CraftSummary> {
  return db.craft.create({
    data: {
      name: data.name,
      code: data.code,
      isOutsource: data.isOutsource,
      defaultMachineType: data.defaultMachineType,
      sortOrder: data.sortOrder,
      isActive: true,
    },
    select: SUMMARY_SELECT,
  });
}

// Activation is owned by setCraftActive, not this update path — see
// lib/account.ts for the rationale.
export type UpdateCraftData = {
  name: string;
  code: string;
  isOutsource: boolean;
  defaultMachineType: MachineType | null;
  sortOrder: number;
};

export async function updateCraft(
  id: string,
  data: UpdateCraftData,
): Promise<CraftSummary> {
  const target = await getCraftSummary(id);
  if (!target) throw new CraftInvariantError('目标工艺不存在');

  return db.craft.update({
    where: { id },
    data: {
      name: data.name,
      code: data.code,
      isOutsource: data.isOutsource,
      defaultMachineType: data.defaultMachineType,
      sortOrder: data.sortOrder,
    },
    select: SUMMARY_SELECT,
  });
}

// Soft-delete only. Crafts are referenced by ProductionTask rows; a hard
// delete would break historical tasks / salary records that reference the
// craft by id. Operators flip isActive to hide from new-order pickers.
export async function setCraftActive(
  id: string,
  isActive: boolean,
): Promise<CraftSummary> {
  const target = await getCraftSummary(id);
  if (!target) throw new CraftInvariantError('目标工艺不存在');
  if (target.isActive === isActive) return target;

  return db.craft.update({
    where: { id },
    data: { isActive },
    select: SUMMARY_SELECT,
  });
}
