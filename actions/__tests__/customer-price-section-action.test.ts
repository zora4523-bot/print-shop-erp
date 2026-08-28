import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const { permissionMock, updateSectionMock, revalidateMock, AdminError, ValidationError } =
  vi.hoisted(() => {
    class MockAdminError extends Error {}
    class MockValidationError extends MockAdminError {
      constructor(
        readonly issues: Array<{ path: string; message: string }>,
      ) {
        super('价目簿规则校验未通过');
      }
    }
    return {
      permissionMock: vi.fn(),
      updateSectionMock: vi.fn(),
      revalidateMock: vi.fn(),
      AdminError: MockAdminError,
      ValidationError: MockValidationError,
    };
  });

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionMock,
}));
vi.mock('@/lib/price/customer-price-book-admin', () => ({
  updateCustomerPriceSectionDraft: updateSectionMock,
  CustomerPriceBookAdminError: AdminError,
  CustomerPriceBookValidationError: ValidationError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

import { updateCustomerPriceSectionDraftAction } from '../customer-price-books';

const actor = {
  id: 'owner-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};

const validInput = {
  priceBookId: 'book-draft-v4',
  section: 'tiers' as const,
  rows: [
    {
      ruleId: 'tier-mid-1',
      expectedUpdatedAt: '2026-08-28T06:00:00.000Z',
      amount: '0.48',
      minQty: 1,
      maxQty: 750,
      includedUnits: null,
      incrementUnits: null,
      incrementAmount: null,
    },
  ],
};

describe('updateCustomerPriceSectionDraftAction', () => {
  beforeEach(() => {
    permissionMock.mockReset();
    updateSectionMock.mockReset();
    revalidateMock.mockReset();
  });

  it('权限校验后才校验和保存业务板块', async () => {
    permissionMock.mockResolvedValue(actor);
    updateSectionMock.mockResolvedValue({
      priceBookId: validInput.priceBookId,
      ruleIds: ['tier-mid-1'],
    });

    await expect(updateCustomerPriceSectionDraftAction(validInput)).resolves.toEqual({
      status: 'success',
      priceBookId: validInput.priceBookId,
      ruleIds: ['tier-mid-1'],
    });
    expect(permissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(updateSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'tiers' }),
      actor,
    );
    expect(revalidateMock).toHaveBeenCalled();
  });

  it.each([
    ['未知板块', { ...validInput, section: 'legacy-matrix' }],
    [
      '金额精度过高',
      {
        ...validInput,
        rows: [{ ...validInput.rows[0], amount: '0.48001' }],
      },
    ],
    [
      '夹带匹配条件',
      {
        ...validInput,
        rows: [
          {
            ...validInput.rows[0],
            triggerCondition: { productCodes: ['HOSTILE'] },
          },
        ],
      },
    ],
  ])('在 DAL 前拒绝%s', async (_label, raw) => {
    permissionMock.mockResolvedValue(actor);
    const result = await updateCustomerPriceSectionDraftAction(
      raw as typeof validInput,
    );
    expect(result.status).toBe('invalid');
    expect(updateSectionMock).not.toHaveBeenCalled();
  });

  it('把领域校验错误定位到对应行和字段', async () => {
    permissionMock.mockResolvedValue(actor);
    updateSectionMock.mockRejectedValue(
      new ValidationError([
        {
          path: 'rules.tier-mid-1.maxQty',
          message: '数量范围必须连续',
        },
      ]),
    );

    await expect(updateCustomerPriceSectionDraftAction(validInput)).resolves.toEqual({
      status: 'invalid',
      fieldErrors: {
        'rows.0.maxQty': ['数量范围必须连续'],
      },
    });
  });
});
