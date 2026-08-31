import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionMock,
  lockMock,
  lockDayMock,
  markPaidMock,
  revalidatePathMock,
  redirectMock,
  MockSettlementError,
} = vi.hoisted(() => ({
  permissionMock: vi.fn(),
  lockMock: vi.fn(),
  lockDayMock: vi.fn(),
  markPaidMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  MockSettlementError: class extends Error {},
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionMock,
}));
vi.mock('@/lib/salary/piecework-settlement', () => ({
  lockPieceworkSettlement: lockMock,
  lockPieceworkSettlementsForDate: lockDayMock,
  markPieceworkSettlementPaid: markPaidMock,
  PieceworkSettlementError: MockSettlementError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  lockPieceworkSettlementAction,
  lockPieceworkSettlementDayAction,
  markPieceworkSettlementPaidAction,
} from '../owner-piecework-settlement';

const actor = {
  id: 'admin-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  permissionMock.mockReset().mockResolvedValue(actor);
  lockMock.mockReset();
  lockDayMock.mockReset();
  markPaidMock.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  });
});

describe('piecework settlement owner actions', () => {
  it('authenticates before locking a settlement', async () => {
    permissionMock.mockRejectedValue(new UnauthorizedError('未登录'));

    await expect(
      lockPieceworkSettlementAction(
        'worker-1',
        '2026-08-27',
        null,
        new FormData(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid day at the action boundary', async () => {
    const result = await lockPieceworkSettlementAction(
      'worker-1',
      '2026-02-31',
      null,
      new FormData(),
    );

    expect(result.status).toBe('invalid');
    expect(lockMock).not.toHaveBeenCalled();
  });

  it('locks one reporter and redirects only to the salary ledger', async () => {
    lockMock.mockResolvedValue({ reporterName: '张师傅' });

    await expect(
      lockPieceworkSettlementAction(
        'worker-1',
        '2026-08-27',
        null,
        form({ returnTo: '/owner/salary/piecework?date=2026-08-27' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(lockMock).toHaveBeenCalledWith({
      reporterId: 'worker-1',
      workDate: '2026-08-27',
      actor,
    });
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/salary/piecework?date=2026-08-27&locked=%E5%BC%A0%E5%B8%88%E5%82%85',
    );
  });

  it('returns every batch business error without claiming success', async () => {
    lockDayMock.mockResolvedValue({
      settled: [],
      errors: [
        { reporterId: 'worker-1', reporterName: '张师傅', message: '报工损坏' },
      ],
    });

    const result = await lockPieceworkSettlementDayAction(
      null,
      form({ workDate: '2026-08-27' }),
    );

    expect(result).toEqual({
      status: 'error',
      message: '张师傅：报工损坏',
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('marks a locked settlement paid and refreshes owner and self reads', async () => {
    markPaidMock.mockResolvedValue({ reporterName: '张师傅' });

    await expect(
      markPieceworkSettlementPaidAction(
        'settlement-1',
        null,
        new FormData(),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(markPaidMock).toHaveBeenCalledWith({
      settlementId: 'settlement-1',
      actor,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/worker/salary/settlement-1',
    );
  });
});
