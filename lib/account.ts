import bcrypt from 'bcryptjs';
import {
  Role,
  WorkerType,
  type User,
} from '../generated/prisma/client';
import { db } from './db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { type EmploymentWindow } from './salary/employment';
import { salaryIdentityLockKey } from './salary/hourly-lock';

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
  hourlyWorkerPayroll: {
    findMany: (args: {
      where: { workerId: string };
      select: { month: true };
      orderBy: { month: 'asc' };
    }) => Promise<Array<{ month: string }>>;
  };
};

async function acquireAdminInvariantLock(tx: TxClient): Promise<void> {
  // hashtext(text) → int4, the argument form pg_advisory_xact_lock expects.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_INVARIANT_LOCK_KEY}))`;
}

function parsePayrollMonth(month: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = Number(match?.[1]);
  const monthNumber = Number(match?.[2]);
  if (!match || monthNumber < 1 || monthNumber > 12) {
    throw new AccountInvariantError(
      `存在月份格式异常的时薪工资记录（${month}），请先核对工资数据`,
    );
  }
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

function employmentCoverageForPayrollMonth(
  month: string,
  employment: EmploymentWindow,
): { start: number; endExclusive: number } | null {
  const monthRange = parsePayrollMonth(month);
  const start = Math.max(
    monthRange.start.getTime(),
    employment.employmentStartDate?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  const endExclusive = Math.min(
    monthRange.end.getTime(),
    employment.employmentEndDate
      ? employment.employmentEndDate.getTime() + 24 * 60 * 60 * 1000
      : Number.POSITIVE_INFINITY,
  );
  return start < endExclusive ? { start, endExclusive } : null;
}

function sameEmploymentCoverageForPayrollMonth(
  month: string,
  previous: EmploymentWindow,
  next: EmploymentWindow,
): boolean {
  const before = employmentCoverageForPayrollMonth(month, previous);
  const after = employmentCoverageForPayrollMonth(month, next);
  return (
    before?.start === after?.start &&
    before?.endExclusive === after?.endExclusive
  );
}

/**
 * Historical PACKER hourly payroll rows are a read-only archive: nothing
 * recomputes them any more. A direct edit of a worker's employment dates must
 * not silently change the eligible days of an archived month.
 */
async function assertHourlyArchiveCoverageUnchangedInTx(
  tx: TxClient,
  userId: string,
  previousEmployment: EmploymentWindow,
  nextEmployment: EmploymentWindow,
): Promise<void> {
  const archived = await tx.hourlyWorkerPayroll.findMany({
    where: { workerId: userId },
    select: { month: true },
    orderBy: { month: 'asc' },
  });
  const changed = archived.find(
    (row) =>
      !sameEmploymentCoverageForPayrollMonth(
        row.month,
        previousEmployment,
        nextEmployment,
      ),
  );
  if (changed) {
    throw new AccountInvariantError(
      `历史时薪月结存档 ${changed.month} 所覆盖的雇佣日期会变化，不能修改雇佣日期`,
    );
  }
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
  | 'isActive'
  | 'employmentType'
  | 'employmentStartDate'
  | 'employmentEndDate'
  | 'createdAt'
  | 'updatedAt'
>;

const SUMMARY_SELECT = {
  id: true,
  username: true,
  displayName: true,
  phone: true,
  role: true,
  workerType: true,
  machineType: true,
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
    orderBy: [
      { isActive: 'desc' },
      { createdAt: 'asc' },
      { username: 'asc' },
      { id: 'asc' },
    ],
  });
}

export async function listUsersPage(opts: {
  q?: string | null;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<AccountSummary>> {
  const query = opts.q?.trim() ?? '';
  const where = query
    ? {
        OR: [
          { username: { contains: query, mode: 'insensitive' as const } },
          { displayName: { contains: query, mode: 'insensitive' as const } },
          { phone: { contains: query, mode: 'insensitive' as const } },
        ],
      }
    : undefined;
  const total = await db.user.count({ where });
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.user.findMany({
    where,
    select: SUMMARY_SELECT,
    orderBy: [
      { isActive: 'desc' },
      { createdAt: 'asc' },
      { username: 'asc' },
      { id: 'asc' },
    ],
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows, total, window);
}

export async function getUserSummary(id: string): Promise<AccountSummary | null> {
  return db.user.findUnique({ where: { id }, select: SUMMARY_SELECT });
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
  employmentType?: User['employmentType'];
  employmentStartDate?: User['employmentStartDate'];
  employmentEndDate?: User['employmentEndDate'];
};

export async function createUser(data: CreateUserData): Promise<AccountSummary> {
  const hashed = await bcrypt.hash(data.password, 10);
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
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

    const nextWorkerType =
      data.role === Role.WORKER ? (data.workerType ?? null) : null;
    const nextEmploymentType =
      data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
        ? (data.employmentType ?? null)
        : null;
    const nextEmploymentStartDate =
      data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
        ? (data.employmentStartDate ?? null)
        : null;
    const nextEmploymentEndDate =
      data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER
        ? (data.employmentEndDate ?? null)
        : null;
    const roleChanging = data.role !== target.role;
    const employmentChanging =
      (nextEmploymentStartDate?.getTime() ?? null) !==
        (target.employmentStartDate?.getTime() ?? null) ||
      (nextEmploymentEndDate?.getTime() ?? null) !==
        (target.employmentEndDate?.getTime() ?? null);
    const currentWorkerEmploymentChanging =
      !roleChanging &&
      target.role === Role.WORKER &&
      data.role === Role.WORKER &&
      employmentChanging;

    if (roleChanging) assertNotSelfTarget(target, actor, 'role-change');

    // isActive isn't part of this update, but the last active ADMIN still has
    // to be protected — assertNotStrandingSystemInTx reads
    // target.isActive when `next.isActive` is omitted, preserving the
    // guard.
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      id,
    )}))`;
    await assertNotStrandingSystemInTx(txClient, target, { role: data.role });
    // Archived rows are immutable snapshots across role changes. Only a direct
    // edit of a current worker's employment dates can retroactively alter the
    // eligible dates of an archived month.
    if (currentWorkerEmploymentChanging) {
      await assertHourlyArchiveCoverageUnchangedInTx(
        txClient,
        id,
        {
          employmentStartDate: target.employmentStartDate,
          employmentEndDate: target.employmentEndDate,
        },
        {
          employmentStartDate: nextEmploymentStartDate,
          employmentEndDate: nextEmploymentEndDate,
        },
      );
    }
    const updated = await txClient.user.update({
      where: { id },
      data: {
        displayName: data.displayName,
        phone: data.phone?.length ? data.phone : null,
        role: data.role,
        workerType: nextWorkerType,
        machineType:
          data.role === Role.WORKER &&
          data.workerType === WorkerType.MACHINE
            ? (data.machineType ?? null)
            : null,
        employmentType: nextEmploymentType,
        employmentStartDate: nextEmploymentStartDate,
        employmentEndDate: nextEmploymentEndDate,
      },
      select: SUMMARY_SELECT,
    });
    return updated;
  });
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

    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      id,
    )}))`;

    const updated = await txClient.user.update({
      where: { id },
      data: { isActive },
      select: SUMMARY_SELECT,
    });
    return updated;
  });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new AccountInvariantError('目标账号不存在');
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id }, data: { password: hashed } });
}
