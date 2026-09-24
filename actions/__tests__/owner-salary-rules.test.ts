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
      success: false, error: { issues: [{ path: ['otStart'], message: '时间必须为 HH:mm' }] },
    });
    const result = await createSalaryRuleVersionAction(null, new FormData());
    expect(result).toEqual({ status: 'invalid', fieldErrors: { otStart: ['时间必须为 HH:mm'] } });
    expect(ruleAdminMock.createSalaryRuleVersion).not.toHaveBeenCalled();
  });

  it('writes a version and invalidates all affected salary pages', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    const input = { ruleKey: 'WORK_HOURS', effectiveFrom: new Date(), remark: null, ruleValue: { morning: { start: '08:00', end: '12:00' }, afternoon: { start: '13:30', end: '17:30' }, otStart: '18:00' } };
    ruleAdminMock.parseSalaryRuleVersionFormData.mockReturnValue({ success: true, data: input });
    ruleAdminMock.createSalaryRuleVersion.mockResolvedValue({ id: 'rule-1' });
    await expect(createSalaryRuleVersionAction(null, new FormData())).resolves.toEqual({ status: 'success', ruleId: 'rule-1' });
    expect(ruleAdminMock.createSalaryRuleVersion).toHaveBeenCalledWith(input, actor);
    expect(revalidateMock).not.toHaveBeenCalledWith('/owner/salary/rules');
    expect(revalidateMock).not.toHaveBeenCalledWith('/owner/salary/hourly');
    expect(revalidateMock).not.toHaveBeenCalledWith('/owner/salary/cs');
    expect(revalidateMock).toHaveBeenCalledWith(
      RULE_CENTER_HREFS.employeePay,
    );
  });
});
