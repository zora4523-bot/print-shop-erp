import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import {
  Role,
  SalaryPeriodStatus,
  SalaryRuleType,
  WorkerType,
  type User,
} from '../generated/prisma/client';
import { db } from './db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { todayShanghai } from './dashboard/shanghai-clock';
import { csUserLockKey } from './salary/cs-lock';
import {
  clampMonthlySalaryWindow,
  monthlySalaryWindowWithinEmployment,
  type EmploymentWindow,
} from './salary/employment';
import {
  hourlyPayrollLockKey,
  salaryIdentityLockKey,
} from './salary/hourly-lock';
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
  salaryRule: SalaryRuleClient['salaryRule'];
  salaryPeriod: {
    findFirst: (args: { where: unknown; select?: unknown }) => Promise<{
      id: string;
      periodStart: Date;
      periodEnd: Date;
      status: SalaryPeriodStatus;
    } | null>;
    findMany: (args: {
      where: { csUserId: string };
      select: {
        id: true;
        periodStart: true;
        periodEnd: true;
        status: true;
      };
      orderBy: { periodStart: 'asc' };
    }) => Promise<
      Array<{
        id: string;
        periodStart: Date;
        periodEnd: Date;
        status: SalaryPeriodStatus;
      }>
    >;
    create: (args: { data: unknown }) => Promise<unknown>;
  };
  hourlyWorkerPayroll: {
    findMany: (args: {
      where: { workerId: string };
      select: { id: true; month: true; isPaid: true };
      orderBy: { month: 'asc' };
    }) => Promise<Array<{ id: string; month: string; isPaid: boolean }>>;
    deleteMany: (args: {
      where: { workerId: string; isPaid: false };
    }) => Promise<{ count: number }>;
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
 * Identity edits invalidate every unpaid hourly derivative for the user.
 *
 * The caller already holds salaryIdentityLockKey(userId). We discover all
 * existing month coordinates, lock them in lexical YYYY-MM order, then re-read
 * before deciding. This makes a concurrent mark-paid operation linearizable:
 * either the account edit deletes the unpaid row first, or it observes the
 * committed paid snapshot and preserves it.
 */
async function invalidateUnpaidHourlyPayrollsInTx(
  tx: TxClient,
  userId: string,
  options: {
    employmentDatesChanged: boolean;
    previousEmployment: EmploymentWindow;
    nextEmployment: EmploymentWindow;
  },
): Promise<void> {
  const locators = await tx.hourlyWorkerPayroll.findMany({
    where: { workerId: userId },
    select: { id: true, month: true, isPaid: true },
    orderBy: { month: 'asc' },
  });
  if (locators.length === 0) return;

  const months = [...new Set(locators.map((row) => row.month))].sort();
  for (const month of months) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hourlyPayrollLockKey(
      userId,
      month,
    )}))`;
  }

  const currentRows = await tx.hourlyWorkerPayroll.findMany({
    where: { workerId: userId },
    select: { id: true, month: true, isPaid: true },
    orderBy: { month: 'asc' },
  });

  if (options.employmentDatesChanged) {
    const excludedPaid = currentRows.find((row) => {
      if (!row.isPaid) return false;
      return !sameEmploymentCoverageForPayrollMonth(
        row.month,
        options.previousEmployment,
        options.nextEmployment,
      );
    });
    if (excludedPaid) {
      throw new AccountInvariantError(
        `已发放的 ${excludedPaid.month} 时薪工资所覆盖的雇佣日期会变化，不能修改雇佣日期`,
      );
    }
  }

  await tx.hourlyWorkerPayroll.deleteMany({
    where: { workerId: userId, isPaid: false },
  });
}

async function assertCsPeriodHistoryWithinEmploymentInTx(
  tx: TxClient,
  csUserId: string,
  nextEmployment: EmploymentWindow,
): Promise<void> {
  const periods = await tx.salaryPeriod.findMany({
    where: { csUserId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
    },
    orderBy: { periodStart: 'asc' },
  });
  const conflict = periods.find(
    (period) =>
      !monthlySalaryWindowWithinEmployment(
        period.periodStart,
        period.periodEnd,
        nextEmployment,
      ),
  );
  if (conflict) {
    throw new AccountInvariantError(
      `已有客服工资周期 ${conflict.periodStart.toISOString().slice(0, 10)} ~ ${conflict.periodEnd.toISOString().slice(0, 10)}（${conflict.status}）超出新雇佣月份，不能修改雇佣日期`,
    );
  }
}

async function ensureInitialCsPeriodInTx(
  tx: TxClient,
  csUser: Pick<
    AccountSummary,
    'id' | 'employmentStartDate' | 'employmentEndDate'
  >,
  now: Date = new Date(),
  options: { identityAndCsLocksHeld?: boolean } = {},
): Promise<void> {
  if (!options.identityAndCsLocksHeld) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(
      csUser.id,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
      csUser.id,
    )}))`;
  }

  const month = todayShanghai(now).slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const requestedStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  // An employee whose final employment month has already passed must not get
  // a new liability. Partial first/last months remain whole monthly salary
  // months: no daily proration has been invented here.
  const firstEligibleMonth = clampMonthlySalaryWindow(
    requestedStart,
    1,
    csUser,
  );
  const activePeriod = await tx.salaryPeriod.findFirst({
    where: {
      csUserId: csUser.id,
      status: SalaryPeriodStatus.IN_PROGRESS,
    },
    select: { id: true, periodStart: true, periodEnd: true, status: true },
  });
  if (activePeriod) {
    if (
      !monthlySalaryWindowWithinEmployment(
        activePeriod.periodStart,
        activePeriod.periodEnd,
        csUser,
      )
    ) {
      throw new AccountInvariantError(
        '进行中的客服工资周期超出新雇佣区间；请先结算或修正周期',
      );
    }
    if (
      firstEligibleMonth === null ||
      (activePeriod.periodStart.getTime() <=
        firstEligibleMonth.periodEnd.getTime() &&
        activePeriod.periodEnd.getTime() >=
          firstEligibleMonth.periodStart.getTime())
    ) {
      return;
    }
    throw new AccountInvariantError(
      '客服已有进行中工资周期，但未覆盖目标雇佣月份；请先结算或修正该周期',
    );
  }
  if (firstEligibleMonth === null) return;
  // "Create an employed CS account under the current rules" does not
  // authorize freezing today's rules into a period whose employment month has
  // not begun. Leave the account without a liability until that month; order
  // sales already fail closed when no period covers their business date, and
  // the explicit CS-period workflow can create it using the then-current rule.
  if (
    firstEligibleMonth.periodStart.getTime() > requestedStart.getTime()
  ) {
    return;
  }
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
  let monthlyBase: Decimal;
  try {
    monthlyBase = new Decimal(baseRule.monthlyBase);
  } catch {
    throw new AccountInvariantError('当前客服底薪规则金额非法');
  }
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
  const window = clampMonthlySalaryWindow(
    requestedStart,
    lengthRule.months,
    csUser,
  );
  if (!window) return;
  if (monthlyBase.times(window.durationMonths).gt('9999999999.99')) {
    throw new AccountInvariantError('当前客服底薪 × 周期月数超过可保存上限');
  }
  const { periodStart, periodEnd, durationMonths } = window;
  const overlap = await tx.salaryPeriod.findFirst({
    where: {
      csUserId: csUser.id,
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
    select: { id: true, periodStart: true, periodEnd: true, status: true },
  });
  if (overlap) {
    throw new AccountInvariantError(
      '客服当前月份已有重叠的历史工资周期，请先在客服周期页面核对后再调整账号',
    );
  }

  await tx.salaryPeriod.create({
    data: {
      csUserId: csUser.id,
      periodStart,
      periodEnd,
      durationMonths,
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
    if (data.role === Role.CUSTOMER_SERVICE) {
      await ensureInitialCsPeriodInTx(txClient, created);
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
    const workerTypeChanging = nextWorkerType !== target.workerType;
    const employmentTypeChanging =
      nextEmploymentType !== target.employmentType;
    const employmentChanging =
      (nextEmploymentStartDate?.getTime() ?? null) !==
        (target.employmentStartDate?.getTime() ?? null) ||
      (nextEmploymentEndDate?.getTime() ?? null) !==
        (target.employmentEndDate?.getTime() ?? null);
    const hourlyIdentityChanging =
      roleChanging ||
      workerTypeChanging ||
      employmentTypeChanging ||
      employmentChanging;
    const currentWorkerEmploymentChanging =
      !roleChanging &&
      target.role === Role.WORKER &&
      data.role === Role.WORKER &&
      employmentChanging;
    const currentCsEmploymentChanging =
      !roleChanging &&
      target.role === Role.CUSTOMER_SERVICE &&
      data.role === Role.CUSTOMER_SERVICE &&
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
    // Settlement decides whether to create a successor period from the user's
    // latest role/active state while holding this same lock. Serialize role
    // transitions involving CUSTOMER_SERVICE before updating the row, or a
    // concurrent settlement could read the old role and create an unintended
    // next salary period after the account has been reassigned.
    if (
      (target.role === Role.CUSTOMER_SERVICE ||
        data.role === Role.CUSTOMER_SERVICE)
    ) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${csUserLockKey(
        id,
      )}))`;
    }
    if (currentCsEmploymentChanging) {
      await assertCsPeriodHistoryWithinEmploymentInTx(txClient, id, {
        employmentStartDate: nextEmploymentStartDate,
        employmentEndDate: nextEmploymentEndDate,
      });
    }
    // Global order: identity -> CS (when applicable) -> worker-month(s).
    // Invalidating all unpaid rows also covers zero-attendance COOK monthly
    // salary, whose amount can become stale solely from an identity change.
    if (hourlyIdentityChanging) {
      await invalidateUnpaidHourlyPayrollsInTx(txClient, id, {
        // Paid rows are immutable historical snapshots across role changes.
        // Only a direct edit of a current worker's employment dates can
        // retroactively alter the exact eligible dates of that paid month.
        employmentDatesChanged: currentWorkerEmploymentChanging,
        previousEmployment: {
          employmentStartDate: target.employmentStartDate,
          employmentEndDate: target.employmentEndDate,
        },
        nextEmployment: {
          employmentStartDate: nextEmploymentStartDate,
          employmentEndDate: nextEmploymentEndDate,
        },
      });
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
    if (
      (roleChanging || employmentChanging) &&
      data.role === Role.CUSTOMER_SERVICE &&
      updated.isActive
    ) {
      await ensureInitialCsPeriodInTx(txClient, updated, new Date(), {
        identityAndCsLocksHeld: true,
      });
    }
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
      await ensureInitialCsPeriodInTx(txClient, updated, new Date(), {
        identityAndCsLocksHeld: true,
      });
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
