import bcrypt from 'bcryptjs';
import { Role, type User } from '../generated/prisma/client';
import { db } from './db';

// Thrown when a mutation would break a system invariant (not an auth issue
// per se — the caller has permission, but the operation itself is refused).
export class AccountInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountInvariantError';
  }
}

// Tag this constant so every OWNER mutation grabs the same PG advisory lock
// inside its transaction. Advisory locks are per-transaction (`_xact_`),
// cheap, and fully serialize concurrent mutations that care about the same
// invariant. Without the lock, two transactions against different OWNER
// rows can both observe "one other active owner" and both commit,
// stranding the system with zero active OWNERs (Codex round 13 / P1).
const OWNER_INVARIANT_LOCK_KEY = 'print-shop-erp:account:owner-invariant';

// Minimal shape of the Prisma client we use inside $transaction callbacks.
// Prisma's TransactionClient type isn't easily importable from the rust-free
// generator, so we list only the methods we actually call. Keeping this
// explicit also makes the lib surface auditable.
type TxClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  user: {
    findUnique: (args: { where: { id: string }; select?: unknown }) => Promise<AccountSummary | null>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<AccountSummary>;
    count: (args?: { where?: unknown }) => Promise<number>;
  };
};

async function acquireOwnerInvariantLock(tx: TxClient): Promise<void> {
  // hashtext(text) → int4, the argument form pg_advisory_xact_lock expects.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${OWNER_INVARIANT_LOCK_KEY}))`;
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

// ─────────────────────────────────────────────────────────────────────────
// Invariants: the system must never end up in a state where no active OWNER
// can log in. Mutations that would violate this get rejected with an
// AccountInvariantError — the caller decides whether to surface the message
// or map to a generic "操作被拒绝" in the UI.
// ─────────────────────────────────────────────────────────────────────────

// Runs inside a transaction that already holds the owner-invariant lock, so
// a concurrent request can't slip an update between our check and write.
async function assertNotStrandingSystemInTx(
  tx: TxClient,
  target: AccountSummary,
  next: { isActive?: boolean; role?: Role },
) {
  const stillActive = next.isActive ?? target.isActive;
  const stillOwner = (next.role ?? target.role) === Role.OWNER;

  // If after the change the target is still an active OWNER, nothing to check.
  if (stillActive && stillOwner) return;

  const wasActiveOwner = target.isActive && target.role === Role.OWNER;
  if (!wasActiveOwner) return;

  const remaining = await tx.user.count({
    where: {
      role: Role.OWNER,
      isActive: true,
      NOT: { id: target.id },
    },
  });
  if (remaining === 0) {
    throw new AccountInvariantError(
      '系统至少需要 1 位活跃 OWNER，无法通过此操作让最后一位 OWNER 失活或降级',
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
      ? '不能修改自己的角色，请让另一位 OWNER 操作'
      : '不能停用自己的账号，请让另一位 OWNER 操作';
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
};

export async function createUser(data: CreateUserData): Promise<AccountSummary> {
  const hashed = await bcrypt.hash(data.password, 10);
  return db.user.create({
    data: {
      username: data.username,
      password: hashed,
      displayName: data.displayName,
      phone: data.phone?.length ? data.phone : null,
      role: data.role,
      workerType: data.role === Role.WORKER ? (data.workerType ?? null) : null,
      machineType:
        data.role === Role.WORKER && data.workerType === 'MACHINE'
          ? (data.machineType ?? null)
          : null,
      isActive: true,
    },
    select: SUMMARY_SELECT,
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
};

export async function updateUser(
  id: string,
  data: UpdateUserData,
  actor: { id: string; role: Role },
): Promise<AccountSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
    await acquireOwnerInvariantLock(txClient);

    const target = await txClient.user.findUnique({
      where: { id },
      select: SUMMARY_SELECT,
    });
    if (!target) throw new AccountInvariantError('目标账号不存在');

    const roleChanging = data.role !== target.role;

    if (roleChanging) assertNotSelfTarget(target, actor, 'role-change');

    // isActive isn't part of this update, but demoting the last active
    // OWNER still has to be blocked — assertNotStrandingSystemInTx reads
    // target.isActive when `next.isActive` is omitted, preserving the
    // guard.
    await assertNotStrandingSystemInTx(txClient, target, { role: data.role });

    return txClient.user.update({
      where: { id },
      data: {
        displayName: data.displayName,
        phone: data.phone?.length ? data.phone : null,
        role: data.role,
        workerType: data.role === Role.WORKER ? (data.workerType ?? null) : null,
        machineType:
          data.role === Role.WORKER && data.workerType === 'MACHINE'
            ? (data.machineType ?? null)
            : null,
      },
      select: SUMMARY_SELECT,
    });
  });
}

export async function setUserActive(
  id: string,
  isActive: boolean,
  actor: { id: string; role: Role },
): Promise<AccountSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TxClient;
    await acquireOwnerInvariantLock(txClient);

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
