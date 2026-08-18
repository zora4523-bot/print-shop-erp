import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import {
  Role,
  SalaryPeriodStatus,
  SalaryRuleType,
  WorkerType,
  type Craft,
  type MachineType,
  type User,
} from '../generated/prisma/client';
import { db } from './db';
import { todayShanghai } from './dashboard/shanghai-clock';
import { computePeriodEnd } from './salary/cs';
import { csUserLockKey } from './salary/cs-lock';
import {
  acquireSalaryRuleSnapshotReadLock,
  getActiveRuleValue,
  type SalaryRuleClient,
} from './salary/rules';

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
  salaryRule: SalaryRuleClient['salaryRule'];
  salaryPeriod: {
    findFirst: (args: { where: unknown; select?: unknown }) => Promise<{
      id: string;
      periodStart: Date;
      periodEnd: Date;
      status: SalaryPeriodStatus;
    } | null>;
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

async function acquireAdminInvariantLock(tx: TxClient): Promise<void> {
  // hashtext(text) → int4, the argument form pg_advisory_xact_lock expects.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_INVARIANT_LOCK_KEY}))`;
}

async function ensureInitialCsPeriodInTx(
  tx: TxClient,
  csUserId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
    csUserId,
  )}))`;

  const month = todayShanghai(now).slice(0, 7);
  const currentDateParts = todayShanghai(now).split('-').map(Number);
  const currentDate = new Date(
    Date.UTC(currentDateParts[0], currentDateParts[1] - 1, currentDateParts[2]),
  );
  const [year, monthNumber] = month.split('-').map(Number);
  const periodStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  await acquireSalaryRuleSnapshotReadLock(tx);
  const [baseRule, lengthRule] = await Promise.all([
    getActiveRuleValue<{ monthlyBase: number | string }>(
      SalaryRuleType.CS_COMMISSION,
      'CS_BASE_SALARY',
      now,
      tx,
    ),
    getActiveRuleValue<{ months: number }>(
      SalaryRuleType.CS_COMMISSION,
      'CS_PERIOD_LENGTH',
      now,
      tx,
    ),
  ]);
  if (!baseRule || !lengthRule) {
    throw new AccountInvariantError(
      '缺少当前生效的客服底薪或周期规则，无法创建客服账号',
    );
  }
  const monthlyBase = new Decimal(baseRule.monthlyBase);
  if (
    !monthlyBase.isFinite() ||
    monthlyBase.isNegative() ||
    monthlyBase.decimalPlaces() > 2 ||
    monthlyBase.gt('99999999.99')
  ) {
    throw new AccountInvariantError('当前客服底薪规则金额非法');
  }
  if (
    !Number.isSafeInteger(lengthRule.months) ||
    lengthRule.months < 1 ||
    lengthRule.months > 24
  ) {
    throw new AccountInvariantError('当前客服周期月数规则必须是 1 到 24 的整数');
  }
  if (monthlyBase.times(lengthRule.months).gt('99999999.99')) {
    throw new AccountInvariantError('当前客服底薪 × 周期月数超过可保存上限');
  }
  const periodEnd = computePeriodEnd(periodStart, lengthRule.months);
  const overlap = await tx.salaryPeriod.findFirst({
    where: {
      csUserId,
      OR: [
        { status: SalaryPeriodStatus.IN_PROGRESS },
        {
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
        },
      ],
    },
    select: { id: true, periodStart: true, periodEnd: true, status: true },
  });
  if (overlap) {
    if (overlap.status === SalaryPeriodStatus.IN_PROGRESS) {
      if (
        overlap.periodStart.getTime() <= currentDate.getTime() &&
        overlap.periodEnd.getTime() >= currentDate.getTime()
      ) {
        return;
      }
      throw new AccountInvariantError(
        '客服已有进行中工资周期，但未覆盖今天；请先结算或修正该周期',
      );
    }
    throw new AccountInvariantError(
      '客服当前月份已有重叠的历史工资周期，请先在客服周期页面核对后再调整账号',
    );
  }

  await tx.salaryPeriod.create({
    data: {
      csUserId,
      periodStart,
      periodEnd,
      durationMonths: lengthRule.months,
      totalSales: '0.00',
      initialSales: '0.00',
      monthlyBase: monthlyBase.toFixed(2),
      status: SalaryPeriodStatus.IN_PROGRESS,
    },
  });
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
    const created = await txClient.user.create({
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
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentType ?? null)
            : null,
        employmentStartDate:
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentStartDate ?? null)
            : null,
        employmentEndDate:
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentEndDate ?? null)
            : null,
      },
      select: SUMMARY_SELECT,
    });
    if (data.role === Role.CUSTOMER_SERVICE) {
      await ensureInitialCsPeriodInTx(txClient, created.id);
    }
    return created;
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
    // Settlement decides whether to create a successor period from the user's
    // latest role/active state while holding this same lock. Serialize role
    // transitions involving CUSTOMER_SERVICE before updating the row, or a
    // concurrent settlement could read the old role and create an unintended
    // next salary period after the account has been reassigned.
    if (
      roleChanging &&
      (target.role === Role.CUSTOMER_SERVICE ||
        data.role === Role.CUSTOMER_SERVICE)
    ) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
        id,
      )}))`;
    }
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

    const updated = await txClient.user.update({
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
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentType ?? null)
            : null,
        employmentStartDate:
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentStartDate ?? null)
            : null,
        employmentEndDate:
          data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
            ? (data.employmentEndDate ?? null)
            : null,
      },
      select: SUMMARY_SELECT,
    });
    if (
      roleChanging &&
      data.role === Role.CUSTOMER_SERVICE &&
      updated.isActive
    ) {
      await ensureInitialCsPeriodInTx(txClient, updated.id);
    }
    return updated;
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

    // See updateUser: active-state changes participate in the same CS-user
    // critical section as settlement and automatic successor creation.
    if (target.role === Role.CUSTOMER_SERVICE) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
        id,
      )}))`;
    }

    const updated = await txClient.user.update({
      where: { id },
      data: { isActive },
      select: SUMMARY_SELECT,
    });
    if (isActive && target.role === Role.CUSTOMER_SERVICE) {
      await ensureInitialCsPeriodInTx(txClient, updated.id);
    }
    return updated;
  });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new AccountInvariantError('目标账号不存在');
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id }, data: { password: hashed } });
}
