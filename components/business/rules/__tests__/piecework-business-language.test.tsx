import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPieceworkRuleManagementDataMock, requirePermissionMock } =
  vi.hoisted(() => ({
    listPieceworkRuleManagementDataMock: vi.fn(),
    requirePermissionMock: vi.fn(),
  }));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/salary/piecework-admin', () => ({
  listPieceworkRuleManagementData: listPieceworkRuleManagementDataMock,
}));
vi.mock('@/components/business/salary/WorkerMachineRuleForm', () => ({
  WorkerMachineRuleForm: () => null,
}));

import WorkerPieceworkRulesPage from '../salary/WorkerPieceworkRulesPage';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  listPieceworkRuleManagementDataMock.mockReset();
});

describe('piecework rule business language', () => {
  it('uses a neutral label for unknown rule keys and multiplier factors', async () => {
    const unknownRuleKey = 'INTERNAL_MACHINE_RULE';
    const unknownFactor = 'INTERNAL_MULTIPLIER_FACTOR';
    listPieceworkRuleManagementDataMock.mockResolvedValue({
      globalRules: [
        {
          id: 'global-1',
          ruleKey: unknownRuleKey,
          ruleValue: {
            dailyBase: 0,
            pieceRate: 0.1,
            boardRate: 20,
            smallOrderThreshold: null,
            smallOrderFlatPrice: 0,
            smallOrderInclusive: false,
            largeOrderSetupFee: 90,
            multiplierFactors: ['DOUBLE_SIDED', unknownFactor],
          },
        },
      ],
      workers: [],
      personalRules: [
        {
          id: 'personal-1',
          machineType: unknownRuleKey,
          ruleValue: {
            dailyBase: 0,
            pieceRate: 0.1,
            boardRate: 20,
          },
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
          remark: null,
          worker: { displayName: '张师傅', username: 'zhang' },
          createdBy: { displayName: '管理员' },
        },
      ],
    });

    const html = renderToStaticMarkup(await WorkerPieceworkRulesPage());

    expect(html).toContain('配置异常');
    expect(html).toContain('双面 ×2');
    expect(html).not.toContain(unknownRuleKey);
    expect(html).not.toContain(unknownFactor);
    expect(html).not.toContain('DOUBLE_SIDED');
  });
});
