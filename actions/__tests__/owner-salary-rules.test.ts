import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';
import { RULE_CENTER_HREFS } from '../../lib/navigation/rule-center';

const { permissionMock, ruleAdminMock, revalidateMock } = vi.hoisted(() => ({
  permissionMock: { requirePermission: vi.fn() },
  ruleAdminMock: {
    parseSalaryRuleVersionFormData: vi.fn(),
    createSalaryRuleVersion: vi.fn(),
  },
  revalidateMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permissionMock.requirePermission }));
vi.mock('@/lib/salary/rule-admin', () => ({
  parseSalaryRuleVersionFormData: ruleAdminMock.parseSalaryRuleVersionFormData,
  createSalaryRuleVersion: ruleAdminMock.createSalaryRuleVersion,
  SalaryRuleAdminError: class SalaryRuleAdminError extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

import { createSalaryRuleVersionAction } from '../owner-salary-rules';

const actor = { id: 'owner', role: Role.ADMIN, username: 'owner', displayName: '管理员' };

beforeEach(() => {
  permissionMock.requirePermission.mockReset();
  ruleAdminMock.parseSalaryRuleVersionFormData.mockReset();
  ruleAdminMock.createSalaryRuleVersion.mockReset();
  revalidateMock.mockReset();
});

describe('createSalaryRuleVersionAction', () => {
  it("checks salary:rule:manage before inspecting supplied form input", async () => {
    permissionMock.requirePermission.mockRejectedValue(new UnauthorizedError('未登录'));
    await expect(createSalaryRuleVersionAction(null, new FormData())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionMock.requirePermission).toHaveBeenCalledWith('salary:rule:manage');
    expect(ruleAdminMock.parseSalaryRuleVersionFormData).not.toHaveBeenCalled();
  });

  it('returns validation errors without a write', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    ruleAdminMock.parseSalaryRuleVersionFormData.mockReturnValue({
      success: false, error: { issues: [{ path: ['hourlyRate'], message: '金额非法' }] },
    });
    const result = await createSalaryRuleVersionAction(null, new FormData());
    expect(result).toEqual({ status: 'invalid', fieldErrors: { hourlyRate: ['金额非法'] } });
    expect(ruleAdminMock.createSalaryRuleVersion).not.toHaveBeenCalled();
  });

  it('writes a version and invalidates all affected salary pages', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    const input = { ruleKey: 'PACKER_HOURLY', effectiveFrom: new Date(), remark: null, ruleValue: { hourlyRate: 12 } };
    ruleAdminMock.parseSalaryRuleVersionFormData.mockReturnValue({ success: true, data: input });
    ruleAdminMock.createSalaryRuleVersion.mockResolvedValue({ id: 'rule-1' });
    await expect(createSalaryRuleVersionAction(null, new FormData())).resolves.toEqual({ status: 'success', ruleId: 'rule-1' });
    expect(ruleAdminMock.createSalaryRuleVersion).toHaveBeenCalledWith(input, actor);
    expect(revalidateMock).toHaveBeenCalledWith('/owner/salary/rules');
    expect(revalidateMock).toHaveBeenCalledWith('/owner/salary/hourly');
    expect(revalidateMock).toHaveBeenCalledWith(
      RULE_CENTER_HREFS.employeePay,
    );
  });
});
