import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMonthlyBillStatus, Role } from '../../../generated/prisma/enums';

const { generateV2Mock, legacyOrderFindManyMock } = vi.hoisted(() => ({
  generateV2Mock: vi.fn(),
  legacyOrderFindManyMock: vi.fn(),
}));

vi.mock('@/lib/agent-monthly-billing/generation', () => ({
  generateAgentMonthlyBillsForPeriod: generateV2Mock,
}));
vi.mock('@/lib/db', () => ({
  db: { order: { findMany: legacyOrderFindManyMock } },
}));

import {
  generateBillsForPeriod,
  issueBill,
  LEGACY_BILL_READ_ONLY_MESSAGE,
  recordPayment,
} from '@/lib/bill';

beforeEach(() => {
  vi.clearAllMocks();
  generateV2Mock.mockResolvedValue({
    period: '2026-05',
    generated: [
      {
        billId: 'agent-bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
        status: AgentMonthlyBillStatus.DRAFT,
        orderCount: 2,
        memberSubtotal: '88.00',
        adjustmentAmount: '0.00',
        totalAmount: '88.00',
        created: true,
      },
    ],
  });
});

describe('legacy generate-bills cron cutover', () => {
  it('keeps the scheduler contract but writes only the v2 ledger', async () => {
    await expect(
      generateBillsForPeriod('2026-05', { id: 'system', role: Role.ADMIN }),
    ).resolves.toMatchObject({
      period: '2026-05',
      generated: [
        {
          billId: 'agent-bill-1',
          salesUserId: 'agent-1',
          totalAmount: '88.00',
          orderCount: 2,
        },
      ],
      errors: [],
    });
    expect(generateV2Mock).toHaveBeenCalledExactlyOnceWith(
      '2026-05',
      { id: 'system', role: Role.ADMIN },
      { fence: undefined },
    );
    expect(legacyOrderFindManyMock).not.toHaveBeenCalled();
  });

  it('routes human callers to v2 instead of reviving the legacy writer', async () => {
    await generateBillsForPeriod('2026-05', {
      id: 'admin-1',
      role: Role.ADMIN,
    });
    expect(generateV2Mock).toHaveBeenCalledExactlyOnceWith(
      '2026-05',
      { id: 'admin-1', role: Role.ADMIN },
      { fence: undefined },
    );
    expect(legacyOrderFindManyMock).not.toHaveBeenCalled();
  });

  it('fails closed for every exported legacy Bill mutation', async () => {
    await expect(
      issueBill('legacy-bill-1', { id: 'admin-1', role: Role.ADMIN }),
    ).rejects.toThrow(LEGACY_BILL_READ_ONLY_MESSAGE);
    await expect(
      recordPayment(
        'legacy-bill-1',
        '1.00',
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).rejects.toThrow(LEGACY_BILL_READ_ONLY_MESSAGE);
    expect(legacyOrderFindManyMock).not.toHaveBeenCalled();
  });
});
