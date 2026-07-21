import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    businessAuditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  buildAuditDiff,
  sanitizeAuditPayload,
  writeAuditLog,
} from '../audit-log';

beforeEach(() => {
  dbMock.businessAuditLog.create.mockReset().mockResolvedValue({ id: 'audit1' });
});

describe('sanitizeAuditPayload', () => {
  it('masks sensitive field names recursively', () => {
    expect(
      sanitizeAuditPayload({
        name: '苹果福',
        primaryContact: {
          name: '王小姐',
          phone: '13800000000',
          wechat: 'wx123',
        },
        defaultAddress: {
          detail: '市桥街道 1 号',
        },
        password: 'secret',
      }),
    ).toEqual({
      name: '苹果福',
      primaryContact: {
        name: '王小姐',
        phone: '[MASKED]',
        wechat: '[MASKED]',
      },
      defaultAddress: '[MASKED]',
      password: '[MASKED]',
    });
  });
});

describe('buildAuditDiff', () => {
  it('compares raw values but emits masked values for sensitive fields', () => {
    const diff = buildAuditDiff(
      {
        name: '旧客户',
        primaryContact: { phone: '13800000000' },
      },
      {
        name: '新客户',
        primaryContact: { phone: '13900000000' },
      },
    );

    expect(diff).toEqual({
      name: { before: '旧客户', after: '新客户' },
      primaryContact: {
        before: { phone: '[MASKED]' },
        after: { phone: '[MASKED]' },
      },
    });
  });
});

describe('writeAuditLog', () => {
  it('writes standardized actor/action/entity/diff/request metadata payload', async () => {
    await writeAuditLog({
      actor: {
        id: 'actor-owner',
        role: Role.ADMIN,
        username: 'admin',
        displayName: '管理员',
      },
      action: 'UPDATE',
      entityType: 'Party',
      entityId: 'party1',
      before: { name: '旧客户', phone: '13800000000' },
      after: { name: '新客户', phone: '13900000000' },
      requestMetadata: {
        source: 'owner-parties.updatePartyAction',
        token: 'should-not-leak',
      },
    });

    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'actor-owner',
        actorRole: Role.ADMIN,
        actorUsername: 'admin',
        actorDisplayName: '管理员',
        action: 'UPDATE',
        entityType: 'Party',
        entityId: 'party1',
        before: { name: '旧客户', phone: '[MASKED]' },
        after: { name: '新客户', phone: '[MASKED]' },
        diff: {
          name: { before: '旧客户', after: '新客户' },
          phone: { before: '[MASKED]', after: '[MASKED]' },
        },
        requestMetadata: {
          source: 'owner-parties.updatePartyAction',
          token: '[MASKED]',
        },
      },
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        actorUsername: true,
        actorDisplayName: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        diff: true,
        requestMetadata: true,
        createdAt: true,
      },
    });
  });
});
