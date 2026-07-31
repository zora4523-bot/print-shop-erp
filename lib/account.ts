import bcrypt from 'bcryptjs';
import {
  Role,
  WorkerType,
  type Craft,
  type MachineType,
  type User,
} from '../generated/prisma/client';
import { db } from './db';

// Thrown when a mutation would break a system invariant (not an auth issue
// per se — the caller has permission, but the operation itself is refused).
export class AccountInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountInvariantError';
  }
}

// Every administrator mutation grabs the same PG advisory lock
// inside its transaction. Advisory locks are per-transaction (`_xact_`),
// cheap, and fully serialize concurrent mutations that care about the same
// invariant. Without the lock, two transactions against different ADMIN
// rows can both observe "one other active administrator" and both commit,
// stranding the system with zero active administrators.
const ADMIN_INVARIANT_LOCK_KEY = 'print-shop-erp:account:admin-invariant';

// Minimal shape of the Prisma client we use inside $transaction callbacks.
// Prisma's TransactionClient type isn't easily importable from the rust-free
// generator, so we list only the methods we actually call. Keeping this
// explicit also makes the lib surface auditable.
type TxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  user: {
    findUnique: (args: { where: { id: string }; select?: unknown }) => Promise<AccountSummary | null>;
    create: (args: { data: unknown; select?: unknown }) => Promise<AccountSummary>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<AccountSummary>;
    count: (args?: { where?: unknown }) => Promise<number>;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<WorkerCapabilityCraft[]>;
  };
};

async function acquireAdminInvariantLock(tx: TxClient): Promise<void> {
  // hashtext(text) → int4, the argument form pg_advisory_xact_lock expects.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_INVARIANT_LOCK_KEY}))`;
}

export type AccountSummary = Pick<
  User,
  | 'id'
  | 'username'
  | 'displayName'
  | 'phone'
  | 'role'
  | 'workerType'
  | 'machineType'
  | 'machineCapabilities'
  | 'isActive'
  | 'employmentType'
  | 'employmentStartDate'
  | 'employmentEndDate'
  | 'createdAt'
  | 'updatedAt'
> & {
  craftCapabilities: Array<{ craftId: string }>;
};

export type WorkerCapabilityCraft = Pick<
  Craft,
  | 'id'
  | 'name'
  | 'isActive'
  | 'isOutsource'
  | 'defaultWorkerType'
  | 'defaultMachineType'
  | 'inHouseMachineTypes'
>;

const SUMMARY_SELECT = {
  id: true,
  username: true,
  displayName: true,
  phone: true,
  role: true,
  workerType: true,
  machineType: true,
  machineCapabilities: true,
  craftCapabilities: { select: { craftId: true } },
  isActive: true,
  employmentType: true,
  employmentStartDate: true,
  employmentEndDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers(): Promise<AccountSummary[]> {
  return db.user.findMany({
    select: SUMMARY_SELECT,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
}

export async function getUserSummary(id: string): Promise<AccountSummary | null> {
  return db.user.findUnique({ where: { id }, select: SUMMARY_SELECT });
}

export async function listWorkerCapabilityCrafts(): Promise<
  WorkerCapabilityCraft[]
> {
  return db.craft.findMany({
    where: {
      isActive: true,
      defaultWorkerType: { not: null },
      NOT: { defaultWorkerType: WorkerType.COOK },
      OR: [
        { isOutsource: false },
        { inHouseMachineTypes: { isEmpty: false } },
      ],
    },
    select: {
      id: true,
      name: true,
      isActive: true,
      isOutsource: true,
      defaultWorkerType: true,
      defaultMachineType: true,
      inHouseMachineTypes: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Invariants: the system must never end up in a state where no active ADMIN
// can log in. Mutations that would violate this get rejected with an
// AccountInvariantError — the caller decides whether to surface the message
// or map to a generic "操作被拒绝" in the UI.
// ─────────────────────────────────────────────────────────────────────────

// Runs inside a transaction that already holds the admin-invariant lock, so
// a concurrent request can't slip an update between our check and write.
async function assertNotStrandingSystemInTx(
  tx: TxClient,
  target: AccountSummary,
  next: { isActive?: boolean; role?: Role },
) {
  const stillActive = next.isActive ?? target.isActive;
  const stillAdmin = (next.role ?? target.role) === Role.ADMIN;

  // If after the change the target is still an active administrator, nothing to check.
  if (stillActive && stillAdmin) return;

  const wasActiveAdmin = target.isActive && target.role === Role.ADMIN;
  if (!wasActiveAdmin) return;

  const remaining = await tx.user.count({
    where: {
      role: Role.ADMIN,
      isActive: true,
      NOT: { id: target.id },
    },
  });
  if (remaining === 0) {
    throw new AccountInvariantError(
      '系统至少需要 1 位活跃管理员，无法通过此操作让最后一位管理员失活或降级',
    );
  }
}

function assertNotSelfTarget(
  target: AccountSummary,
  actor: { id: string; role: Role },
  action: 'role-change' | 'deactivate',
) {
  if (target.id !== actor.id) return;
  const message =
    action === 'role-change'
      ? '不能修改自己的角色，请让另一位管理员操作'
      : '不能停用自己的账号，请让另一位管理员操作';
  throw new AccountInvariantError(message);
}

// ─────────────────────────────────────────────────────────────────────────
// Mutations. All take a pre-validated input shape (Zod already ran at the
// action boundary) so this layer focuses on DB + invariants.
// ─────────────────────────────────────────────────────────────────────────

export type CreateUserData = {
  username: string;
  password: string;
  displayName: string;
  phone?: string;
  role: Role;
  workerType?: User['workerType'];
  machineType?: User['machineType'];
  machineCapabilities?: MachineType[];
  craftCapabilities?: string[];
  employmentType?: User['employmentType'];
  employmentStartDate?: User['employmentStartDate'];
  employmentEndDate?: User['employmentEndDate'];
};

export async function createUser(data: CreateUserData): Promise<AccountSummary> {
  const hashed = await bcrypt.hash(data.password, 10);
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
    const capabilityCraftIds =
      data.role === Role.WORKER ? (data.craftCapabilities ?? []) : [];
    await assertWorkerCapabilitiesInTx(txClient, {
      workerType:
        data.role === Role.WORKER ? (data.workerType ?? null) : null,
      machineCapabilities:
        data.role === Role.WORKER &&
        data.workerType === WorkerType.MACHINE
          ? (data.machineCapabilities ?? [])
          : [],
      craftIds: capabilityCraftIds,
    });
    return txClient.user.create({
      data: {
        username: data.username,
        password: hashed,
        displayName: data.displayName,
        phone: data.phone?.length ? data.phone : null,
        role: data.role,
        workerType:
          data.role === Role.WORKER ? (data.workerType ?? null) : null,
        machineType:
          data.role === Role.WORKER &&
          data.workerType === WorkerType.MACHINE
            ? (data.machineType ?? null)
            : null,
        machineCapabilities:
          data.role === Role.WORKER &&
          data.workerType === WorkerType.MACHINE
            ? (data.machineCapabilities ?? [])
            : [],
        craftCapabilities: {
          create: capabilityCraftIds.map((craftId) => ({ craftId })),
        },
        isActive: true,
        employmentType:
          data.role === Role.ADMIN ? null : (data.employmentType ?? null),
        employmentStartDate: data.employmentStartDate ?? null,
        employmentEndDate: data.employmentEndDate ?? null,
      },
      select: SUMMARY_SELECT,
    });
  });
}

// Update NEVER touches isActive. Activation is a separate action
// (setUserActive) so a basic-info edit can't silently deactivate.
export type UpdateUserData = {
  displayName: string;
  phone?: string;
  role: Role;
  workerType?: User['workerType'];
  machineType?: User['machineType'];
  machineCapabilities?: MachineType[];
  craftCapabilities?: string[];
  employmentType?: User['employmentType'];
  employmentStartDate?: User['employmentStartDate'];
  employmentEndDate?: User['employmentEndDate'];
};

export async function updateUser(
  id: string,
  data: UpdateUserData,
  actor: { id: string; role: Role },
): Promise<AccountSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
    await acquireAdminInvariantLock(txClient);

    const target = await txClient.user.findUnique({
      where: { id },
      select: SUMMARY_SELECT,
    });
    if (!target) throw new AccountInvariantError('目标账号不存在');

    const roleChanging = data.role !== target.role;

    if (roleChanging) assertNotSelfTarget(target, actor, 'role-change');

    // isActive isn't part of this update, but the last active ADMIN still has
    // to be protected — assertNotStrandingSystemInTx reads
    // target.isActive when `next.isActive` is omitted, preserving the
    // guard.
    await assertNotStrandingSystemInTx(txClient, target, { role: data.role });
    const capabilityCraftIds =
      data.role === Role.WORKER ? (data.craftCapabilities ?? []) : [];
    const machineCapabilities =
      data.role === Role.WORKER &&
      data.workerType === WorkerType.MACHINE
        ? (data.machineCapabilities ?? [])
        : [];
    await assertWorkerCapabilitiesInTx(txClient, {
      workerType:
        data.role === Role.WORKER ? (data.workerType ?? null) : null,
      machineCapabilities,
      craftIds: capabilityCraftIds,
    });

    return txClient.user.update({
      where: { id },
      data: {
        displayName: data.displayName,
        phone: data.phone?.length ? data.phone : null,
        role: data.role,
        workerType: data.role === Role.WORKER ? (data.workerType ?? null) : null,
        machineType:
          data.role === Role.WORKER &&
          data.workerType === WorkerType.MACHINE
            ? (data.machineType ?? null)
            : null,
        machineCapabilities,
        craftCapabilities: {
          deleteMany: {},
          create: capabilityCraftIds.map((craftId) => ({ craftId })),
        },
        employmentType:
          data.role === Role.ADMIN ? null : (data.employmentType ?? null),
        employmentStartDate: data.employmentStartDate ?? null,
        employmentEndDate: data.employmentEndDate ?? null,
      },
      select: SUMMARY_SELECT,
    });
  });
}

async function assertWorkerCapabilitiesInTx(
  tx: TxClient,
  input: {
    workerType: WorkerType | null;
    machineCapabilities: MachineType[];
    craftIds: string[];
  },
): Promise<void> {
  if (input.craftIds.length === 0) return;
  const crafts = await tx.craft.findMany({
    where: { id: { in: input.craftIds } },
    select: {
      id: true,
      name: true,
      isActive: true,
      isOutsource: true,
      defaultWorkerType: true,
      defaultMachineType: true,
      inHouseMachineTypes: true,
    },
  });
  if (crafts.length !== input.craftIds.length) {
    throw new AccountInvariantError('所选工艺能力包含不存在的工艺');
  }
  for (const craft of crafts) {
    if (!craft.isActive) {
      throw new AccountInvariantError(`工艺“${craft.name}”已停用`);
    }
    if (craft.isOutsource && craft.inHouseMachineTypes.length === 0) {
      throw new AccountInvariantError(`纯外协工艺“${craft.name}”不能设为师傅能力`);
    }
    if (
      !craft.defaultWorkerType ||
      craft.defaultWorkerType === WorkerType.COOK ||
      craft.defaultWorkerType !== input.workerType
    ) {
      throw new AccountInvariantError(
        `工艺“${craft.name}”与当前岗位不匹配`,
      );
    }
    if (craft.defaultWorkerType === WorkerType.MACHINE) {
      const allowedMachines =
        craft.inHouseMachineTypes.length > 0
          ? craft.inHouseMachineTypes
          : craft.defaultMachineType
            ? [craft.defaultMachineType]
            : [];
      if (
        !input.machineCapabilities.some((machine) =>
          allowedMachines.includes(machine),
        )
      ) {
        throw new AccountInvariantError(
          `工艺“${craft.name}”与所选机器能力不匹配`,
        );
      }
    }
  }
}

export async function setUserActive(
  id: string,
  isActive: boolean,
  actor: { id: string; role: Role },
): Promise<AccountSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
    await acquireAdminInvariantLock(txClient);

    const target = await txClient.user.findUnique({
      where: { id },
      select: SUMMARY_SELECT,
    });
    if (!target) throw new AccountInvariantError('目标账号不存在');

    if (target.isActive === isActive) return target;

    if (!isActive) {
      assertNotSelfTarget(target, actor, 'deactivate');
      await assertNotStrandingSystemInTx(txClient, target, { isActive: false });
    }

    return txClient.user.update({
      where: { id },
      data: { isActive },
      select: SUMMARY_SELECT,
    });
  });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new AccountInvariantError('目标账号不存在');
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id }, data: { password: hashed } });
}
