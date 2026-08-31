import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  EmploymentType,
  Role,
  WorkerType,
  MachineType,
  SalaryPeriodStatus,
} from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    salaryRule: { findFirst: ReturnType<typeof vi.fn> };
    salaryPeriod: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    salaryRule: { findFirst: vi.fn() },
    salaryPeriod: { findFirst: vi.fn(), create: vi.fn() },
    // $executeRaw is only used to acquire the advisory lock; no return value.
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    // $transaction runs the callback with the same mock as tx so every
    // lib-layer call inside the transaction observes the same findUnique /
    // update / count state we set up.
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  listUsers,
  listUsersPage,
  createUser,
  updateUser,
  setUserActive,
  resetUserPassword,
  AccountInvariantError,
} from '../account';

const baseActor = { id: 'owner-self', role: Role.ADMIN };

const makeUser = (over: Partial<{
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  role: Role;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  isActive: boolean;
}> = {}) => ({
  id: 'user-1',
  username: 'u1',
  displayName: 'User',
  phone: null,
  role: Role.SALES,
  workerType: null,
  machineType: null,
  isActive: true,
  createdAt: new Date('2026-04-22T00:00:00Z'),
  updatedAt: new Date('2026-04-22T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(dbMock.user)) fn.mockReset();
  dbMock.salaryRule.findFirst.mockReset().mockImplementation(
    async (args: { where: { ruleKey: string } }) => {
      if (args.where.ruleKey === 'CS_BASE_SALARY') {
        return { ruleValue: { monthlyBase: 2000 } };
      }
      if (args.where.ruleKey === 'CS_PERIOD_LENGTH') {
        return { ruleValue: { months: 4 } };
      }
      return null;
    },
  );
  dbMock.salaryPeriod.findFirst.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.create.mockReset().mockResolvedValue({ id: 'period-1' });
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
});

describe('listUsers', () => {
  it('orders active users deterministically when timestamps tie', async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    await listUsers();
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { isActive: 'desc' },
          { createdAt: 'asc' },
          { username: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('does not select the password column', async () => {
    dbMock.user.findMany.mockResolvedValue([]);
    await listUsers();
    const call = dbMock.user.findMany.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.password).toBeUndefined();
  });

  it('searches and bounds the account-management page at the database', async () => {
    dbMock.user.count.mockResolvedValue(45);
    dbMock.user.findMany.mockResolvedValue([makeUser()]);

    const result = await listUsersPage({
      q: '  师傅03  ',
      page: 3,
      pageSize: 20,
    });

    const where = {
      OR: [
        { username: { contains: '师傅03', mode: 'insensitive' } },
        { displayName: { contains: '师傅03', mode: 'insensitive' } },
        { phone: { contains: '师傅03', mode: 'insensitive' } },
      ],
    };
    expect(dbMock.user.count).toHaveBeenCalledWith({ where });
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 40,
        take: 20,
        orderBy: [
          { isActive: 'desc' },
          { createdAt: 'asc' },
          { username: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
    expect(result).toMatchObject({
      total: 45,
      page: 3,
      pageSize: 20,
      pageCount: 3,
    });
  });
});

describe('createUser', () => {
  it('hashes the password via bcrypt and stores the hash, not plaintext', async () => {
    dbMock.user.create.mockResolvedValue(makeUser({ role: Role.SALES }));
    await createUser({
      username: 'alice',
      password: 'plaintext-9chars',
      displayName: 'Alice',
      role: Role.SALES,
    });
    const call = dbMock.user.create.mock.calls[0][0];
    const stored = call.data.password as string;
    expect(stored).not.toBe('plaintext-9chars');
    expect(await bcrypt.compare('plaintext-9chars', stored)).toBe(true);
  });

  it('coerces workerType / machineType to null for non-WORKER roles', async () => {
    dbMock.user.create.mockResolvedValue(makeUser({ role: Role.SALES }));
    await createUser({
      username: 'bob',
      password: 'plaintext-9chars',
      displayName: 'Bob',
      role: Role.SALES,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
    });
    const data = dbMock.user.create.mock.calls[0][0].data;
    expect(data.workerType).toBeNull();
    expect(data.machineType).toBeNull();
  });

  it('never persists employee fields for an external sales account', async () => {
    dbMock.user.create.mockResolvedValue(makeUser({ role: Role.SALES }));
    await createUser({
      username: 'external-sales',
      password: 'plaintext-9chars',
      displayName: '外部销售',
      role: Role.SALES,
      employmentType: EmploymentType.FULL_TIME,
      employmentStartDate: new Date('2026-08-01T00:00:00.000Z'),
      employmentEndDate: new Date('2026-08-02T00:00:00.000Z'),
    });

    expect(dbMock.user.create.mock.calls[0]![0].data).toMatchObject({
      employmentType: null,
      employmentStartDate: null,
      employmentEndDate: null,
    });
  });

  it('keeps workerType / machineType for WORKER + MACHINE', async () => {
    dbMock.user.create.mockResolvedValue(makeUser({ role: Role.WORKER }));
    await createUser({
      username: 'wu',
      password: 'plaintext-9chars',
      displayName: 'Wu',
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.WINDMILL,
    });
    const data = dbMock.user.create.mock.calls[0][0].data;
    expect(data.role).toBe(Role.WORKER);
    expect(data.workerType).toBe(WorkerType.MACHINE);
    expect(data.machineType).toBe(MachineType.WINDMILL);
  });

  it('does not write retired worker-to-craft capability metadata', async () => {
    dbMock.user.create.mockResolvedValue(
      makeUser({ role: Role.WORKER }),
    );

    await createUser({
      username: 'multi',
      password: 'plaintext-9chars',
      displayName: '多能师傅',
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
    });

    const data = dbMock.user.create.mock.calls[0][0].data;
    expect(data.machineType).toBe(MachineType.HAND_PRESS);
    expect(data).not.toHaveProperty('machineCapabilities');
    expect(data).not.toHaveProperty('craftCapabilities');
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('drops machineType when workerType is not MACHINE', async () => {
    dbMock.user.create.mockResolvedValue(makeUser({ role: Role.WORKER }));
    await createUser({
      username: 'pk',
      password: 'plaintext-9chars',
      displayName: 'Pack',
      role: Role.WORKER,
      workerType: WorkerType.PACKER,
      machineType: MachineType.WINDMILL,
    });
    const data = dbMock.user.create.mock.calls[0][0].data;
    expect(data.workerType).toBe(WorkerType.PACKER);
    expect(data.machineType).toBeNull();
  });

  it('stores phone only when non-empty', async () => {
    dbMock.user.create.mockResolvedValue(makeUser());
    await createUser({
      username: 'a',
      password: 'plaintext-9chars',
      displayName: 'A',
      role: Role.SALES,
      phone: '',
    });
    expect(dbMock.user.create.mock.calls[0][0].data.phone).toBeNull();

    await createUser({
      username: 'b',
      password: 'plaintext-9chars',
      displayName: 'B',
      role: Role.SALES,
      phone: '13800138000',
    });
    expect(dbMock.user.create.mock.calls[1][0].data.phone).toBe('13800138000');
  });

  it('creates the initial four-month salary period in the same transaction for CS', async () => {
    dbMock.user.create.mockResolvedValue(
      makeUser({ id: 'cs-1', role: Role.CUSTOMER_SERVICE }),
    );
    await createUser({
      username: 'cs',
      password: 'plaintext-9chars',
      displayName: '客服',
      role: Role.CUSTOMER_SERVICE,
    });

    expect(dbMock.salaryPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        csUserId: 'cs-1',
        durationMonths: 4,
        monthlyBase: '2000.00',
        status: 'IN_PROGRESS',
      }),
    });
    const data = dbMock.salaryPeriod.create.mock.calls[0][0].data;
    expect(data.periodStart.getUTCDate()).toBe(1);
  });

  it('rolls back CS account creation when salary rules are missing', async () => {
    dbMock.user.create.mockResolvedValue(
      makeUser({ id: 'cs-1', role: Role.CUSTOMER_SERVICE }),
    );
    dbMock.salaryRule.findFirst.mockResolvedValue(null);

    await expect(
      createUser({
        username: 'cs',
        password: 'plaintext-9chars',
        displayName: '客服',
        role: Role.CUSTOMER_SERVICE,
      }),
    ).rejects.toThrow(/客服底薪或周期规则/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('uses the same 1..24 month policy as manual CS-period creation', async () => {
    dbMock.user.create.mockResolvedValue(
      makeUser({ id: 'cs-1', role: Role.CUSTOMER_SERVICE }),
    );
    dbMock.salaryRule.findFirst.mockImplementation(
      async (args: { where: { ruleKey: string } }) => {
        if (args.where.ruleKey === 'CS_BASE_SALARY') {
          return { ruleValue: { monthlyBase: 2000 } };
        }
        if (args.where.ruleKey === 'CS_PERIOD_LENGTH') {
          return { ruleValue: { months: 25 } };
        }
        return null;
      },
    );

    await expect(
      createUser({
        username: 'cs',
        password: 'plaintext-9chars',
        displayName: '客服',
        role: Role.CUSTOMER_SERVICE,
      }),
    ).rejects.toThrow(/1 到 24/);
    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
  });

  it('rejects an active period that does not cover today instead of silently leaving a gap', async () => {
    dbMock.user.create.mockResolvedValue(
      makeUser({ id: 'cs-1', role: Role.CUSTOMER_SERVICE }),
    );
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'future-period',
      periodStart: new Date('2027-01-01T00:00:00.000Z'),
      periodEnd: new Date('2027-04-30T00:00:00.000Z'),
      status: SalaryPeriodStatus.IN_PROGRESS,
    });

    await expect(
      createUser({
        username: 'cs',
        password: 'plaintext-9chars',
        displayName: '客服',
        role: Role.CUSTOMER_SERVICE,
      }),
    ).rejects.toThrow(/未覆盖今天/);

    expect(dbMock.salaryPeriod.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        csUserId: 'cs-1',
        OR: expect.arrayContaining([
          { status: SalaryPeriodStatus.IN_PROGRESS },
        ]),
      }),
    );
  });
});

describe('updateUser invariants', () => {
  const ownerSelf = makeUser({ id: 'owner-self', role: Role.ADMIN });
  const ownerOther = makeUser({ id: 'owner-other', role: Role.ADMIN });
  const salesPerson = makeUser({ id: 'sales-1', role: Role.SALES });

  it('wraps the check + write in a transaction and holds the owner advisory lock (Codex round 13 / P1)', async () => {
    dbMock.user.findUnique.mockResolvedValue(salesPerson);
    dbMock.user.update.mockResolvedValue(makeUser({ id: 'sales-1' }));

    await updateUser(
      'sales-1',
      { displayName: 'Bob', role: Role.SALES },
      baseActor,
    );

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    // First tx-scoped call is the advisory lock — ensures the critical
    // section is serialized against concurrent ADMIN mutations.
    expect(dbMock.$executeRaw).toHaveBeenCalled();
    const firstCall = dbMock.$executeRaw.mock.calls[0];
    const templateText = (firstCall[0] as TemplateStringsArray).join('?');
    expect(templateText).toMatch(/pg_advisory_xact_lock/);
  });

  it('refuses to demote the last active ADMIN', async () => {
    dbMock.user.findUnique.mockResolvedValue(ownerOther);
    dbMock.user.count.mockResolvedValue(0); // no other active ADMIN

    await expect(
      updateUser(
        'owner-other',
        {
          displayName: 'X',
          role: Role.SALES, // demote
        },
        baseActor,
      ),
    ).rejects.toBeInstanceOf(AccountInvariantError);

    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('allows demoting one ADMIN when another active ADMIN exists', async () => {
    dbMock.user.findUnique.mockResolvedValue(ownerOther);
    dbMock.user.count.mockResolvedValue(1); // some other ADMIN
    dbMock.user.update.mockResolvedValue(makeUser({ id: 'owner-other', role: Role.SALES }));

    await expect(
      updateUser('owner-other', { displayName: 'X', role: Role.SALES }, baseActor),
    ).resolves.toBeDefined();
  });

  it('refuses to change the actor OWN role (self lockout guard)', async () => {
    dbMock.user.findUnique.mockResolvedValue(ownerSelf);
    dbMock.user.count.mockResolvedValue(99); // plenty of other OWNERs — irrelevant

    await expect(
      updateUser('owner-self', { displayName: 'X', role: Role.SALES }, baseActor),
    ).rejects.toThrowError(/不能修改自己的角色/);
  });

  it('never writes isActive through the update path', async () => {
    dbMock.user.findUnique.mockResolvedValue(salesPerson);
    dbMock.user.update.mockResolvedValue(salesPerson);
    await updateUser('sales-1', { displayName: 'Y', role: Role.SALES }, baseActor);
    const data = dbMock.user.update.mock.calls[0][0].data as Record<string, unknown>;
    expect('isActive' in data).toBe(false);
    expect(data).not.toHaveProperty('machineCapabilities');
    expect(data).not.toHaveProperty('craftCapabilities');
  });

  it('allows editing another active user when invariants are fine', async () => {
    dbMock.user.findUnique.mockResolvedValue(salesPerson);
    dbMock.user.update.mockResolvedValue(makeUser({ id: 'sales-1', displayName: 'New' }));

    const result = await updateUser(
      'sales-1',
      { displayName: 'New', role: Role.SALES, phone: '13800138000' },
      baseActor,
    );
    expect(result.displayName).toBe('New');
    expect(dbMock.user.update.mock.calls[0][0].data.phone).toBe('13800138000');
  });

  it('serializes a CS role change with salary-period settlement before updating the user', async () => {
    const cs = makeUser({ id: 'cs-1', role: Role.CUSTOMER_SERVICE });
    dbMock.user.findUnique.mockResolvedValue(cs);
    dbMock.user.update.mockResolvedValue(
      makeUser({ id: 'cs-1', role: Role.SALES }),
    );

    await updateUser(
      'cs-1',
      { displayName: '客服', role: Role.SALES },
      baseActor,
    );

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.$executeRaw.mock.calls[1]?.[1]).toBe(
      'print-shop-erp:cs-user:cs-1',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]!).toBeLessThan(
      dbMock.user.update.mock.invocationCallOrder[0]!,
    );
  });

  it('throws when the target does not exist', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(
      updateUser('nope', { displayName: 'X', role: Role.SALES }, baseActor),
    ).rejects.toThrowError(/不存在/);
  });
});

describe('setUserActive invariants', () => {
  const ownerSelf = makeUser({ id: 'owner-self', role: Role.ADMIN });
  const ownerOther = makeUser({ id: 'owner-other', role: Role.ADMIN });

  it('also runs inside the transaction + advisory lock (Codex round 13 / P1)', async () => {
    const inactive = makeUser({ id: 'inactive', isActive: false, role: Role.SALES });
    dbMock.user.findUnique.mockResolvedValue(inactive);
    dbMock.user.update.mockResolvedValue({ ...inactive, isActive: true });

    await setUserActive('inactive', true, baseActor);

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    const firstCall = dbMock.$executeRaw.mock.calls[0];
    expect((firstCall[0] as TemplateStringsArray).join('?')).toMatch(/pg_advisory_xact_lock/);
  });

  it('serializes CS deactivation with settlement before updating the user', async () => {
    const activeCs = makeUser({
      id: 'cs-1',
      isActive: true,
      role: Role.CUSTOMER_SERVICE,
    });
    dbMock.user.findUnique.mockResolvedValue(activeCs);
    dbMock.user.update.mockResolvedValue({ ...activeCs, isActive: false });

    await setUserActive('cs-1', false, baseActor);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.$executeRaw.mock.calls[1]?.[1]).toBe(
      'print-shop-erp:cs-user:cs-1',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]!).toBeLessThan(
      dbMock.user.update.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses self-deactivation even when other OWNERs exist', async () => {
    dbMock.user.findUnique.mockResolvedValue(ownerSelf);
    dbMock.user.count.mockResolvedValue(5);

    await expect(setUserActive('owner-self', false, baseActor)).rejects.toThrowError(
      /不能停用自己的账号/,
    );
  });

  it('refuses to deactivate the last active ADMIN', async () => {
    dbMock.user.findUnique.mockResolvedValue(ownerOther);
    dbMock.user.count.mockResolvedValue(0);

    await expect(setUserActive('owner-other', false, baseActor)).rejects.toBeInstanceOf(
      AccountInvariantError,
    );
  });

  it('allows reactivating without invariant checks', async () => {
    const inactive = makeUser({ id: 'inactive', isActive: false, role: Role.SALES });
    dbMock.user.findUnique.mockResolvedValue(inactive);
    dbMock.user.update.mockResolvedValue({ ...inactive, isActive: true });

    await expect(setUserActive('inactive', true, baseActor)).resolves.toBeDefined();
    expect(dbMock.user.update).toHaveBeenCalled();
  });

  it('is a no-op when the target is already in the desired state', async () => {
    const active = makeUser({ id: 'active', isActive: true });
    dbMock.user.findUnique.mockResolvedValue(active);

    const result = await setUserActive('active', true, baseActor);
    expect(result).toBe(active);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});

describe('resetUserPassword', () => {
  it('hashes the new password and updates the target', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
    dbMock.user.update.mockResolvedValue({ id: 'user-1' });
    await resetUserPassword('user-1', 'new-one-1234');
    const data = dbMock.user.update.mock.calls[0][0].data;
    expect(data.password).not.toBe('new-one-1234');
    expect(await bcrypt.compare('new-one-1234', data.password)).toBe(true);
  });

  it('throws when the target does not exist', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(resetUserPassword('nope', 'x'.repeat(10))).rejects.toThrowError(/不存在/);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});
