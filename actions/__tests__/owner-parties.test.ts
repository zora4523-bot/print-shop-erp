import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { PartyType } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  partyMock,
  auditMock,
  revalidatePathMock,
  redirectMock,
  MockPartyInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  partyMock: {
    createParty: vi.fn(),
    getPartySummary: vi.fn(),
    updateParty: vi.fn(),
    setPartyActive: vi.fn(),
  },
  auditMock: {
    writeAuditLog: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockPartyInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PartyInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/party', () => ({
  createParty: partyMock.createParty,
  getPartySummary: partyMock.getPartySummary,
  updateParty: partyMock.updateParty,
  setPartyActive: partyMock.setPartyActive,
  PartyInvariantError: MockPartyInvariantError,
}));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: auditMock.writeAuditLog,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createPartyAction,
  setPartyActiveAction,
  updatePartyAction,
} from '../owner-parties';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: 'OWNER',
  workerType: null,
  machineType: null,
};

const validParty = {
  type: 'CUSTOMER',
  code: 'CUST_001',
  name: '苹果福',
  shortName: '苹果',
  primaryContactName: '王小姐',
  primaryContactPhone: '13800000000',
  primaryContactWechat: '',
  defaultReceiverName: '王小姐',
  defaultReceiverPhone: '13800000000',
  defaultProvince: '广东',
  defaultCity: '广州',
  defaultDistrict: '番禺',
  defaultAddressDetail: '市桥街道 1 号',
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  partyMock.createParty.mockReset();
  partyMock.getPartySummary.mockReset();
  partyMock.updateParty.mockReset();
  partyMock.setPartyActive.mockReset();
  auditMock.writeAuditLog.mockReset().mockResolvedValue({ id: 'audit1' });
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createPartyAction', () => {
  it("first-line requirePermission('party:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createPartyAction(null, fd(validParty))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('party:manage');
    expect(partyMock.createParty).not.toHaveBeenCalled();
  });

  it('returns invalid on schema failure', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createPartyAction(null, fd({ ...validParty, name: '' }));
    expect(result.status).toBe('invalid');
    expect(partyMock.createParty).not.toHaveBeenCalled();
  });

  it('passes parsed party fields to lib.createParty', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    partyMock.createParty.mockResolvedValue({ id: 'party1' });

    await expect(createPartyAction(null, fd(validParty))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(partyMock.createParty).toHaveBeenCalledWith({
      type: PartyType.CUSTOMER,
      code: 'CUST_001',
      name: '苹果福',
      shortName: '苹果',
      primaryContactName: '王小姐',
      primaryContactPhone: '13800000000',
      primaryContactWechat: null,
      defaultReceiverName: '王小姐',
      defaultReceiverPhone: '13800000000',
      defaultProvince: '广东',
      defaultCity: '广州',
      defaultDistrict: '番禺',
      defaultAddressDetail: '市桥街道 1 号',
    });
    expect(redirectMock).toHaveBeenCalledWith('/owner/parties/party1');
  });

  it('maps P2002 on party code to invalid.code field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    partyMock.createParty.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );
    const result = await createPartyAction(null, fd(validParty));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该客户/供应商编码已被占用');
    }
  });
});

describe('updatePartyAction', () => {
  it('requires party:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updatePartyAction('party1', null, fd(validParty))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps PartyInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    partyMock.updateParty.mockRejectedValueOnce(
      new MockPartyInvariantError('目标客户/供应商不存在'),
    );
    const result = await updatePartyAction('party1', null, fd(validParty));
    expect(result.status).toBe('error');
  });

  it('revalidates party list, detail, and order creation picker on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    partyMock.getPartySummary.mockResolvedValue({ id: 'party1', name: '旧客户' });
    partyMock.updateParty.mockResolvedValue({ id: 'party1' });
    const result = await updatePartyAction('party1', null, fd(validParty));
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/parties');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/parties/party1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/new');
  });

  it('writes a standardized business audit log on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const before = {
      id: 'party1',
      name: '旧客户',
      primaryContact: { phone: '13800000000' },
    };
    const after = {
      id: 'party1',
      name: '苹果福',
      primaryContact: { phone: '13900000000' },
    };
    partyMock.getPartySummary.mockResolvedValue(before);
    partyMock.updateParty.mockResolvedValue(after);

    const result = await updatePartyAction('party1', null, fd(validParty));

    expect(result.status).toBe('success');
    expect(auditMock.writeAuditLog).toHaveBeenCalledWith({
      actor: ownerActor,
      action: 'UPDATE',
      entityType: 'Party',
      entityId: 'party1',
      before,
      after,
      requestMetadata: {
        source: 'owner-parties.updatePartyAction',
        route: '/owner/parties/party1',
      },
    });
  });
});

describe('setPartyActiveAction', () => {
  it('requires party:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setPartyActiveAction('party1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps invariant to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    partyMock.setPartyActive.mockRejectedValueOnce(
      new MockPartyInvariantError('目标客户/供应商不存在'),
    );
    const result = await setPartyActiveAction('party1', false);
    expect(result.status).toBe('error');
  });
});
