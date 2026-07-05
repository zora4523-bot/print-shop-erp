import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getSecurityExtensionReadiness,
  listSecurityAuditTableReadiness,
  listSensitiveColumnReadiness,
} from '../security-readiness';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('getSecurityExtensionReadiness', () => {
  it('normalizes counts, blockers, and readiness flags', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        anonAvailable: true,
        anonInstalled: true,
        anonPreloaded: true,
        pgauditAvailable: true,
        pgauditInstalled: false,
        pgauditPreloaded: false,
        policyCount: BigInt(32),
        anonLabelPolicyCount: BigInt(6),
        anonLabelAppliedCount: BigInt(6),
        manualRedactPolicyCount: BigInt(23),
        auditOnlyPolicyCount: BigInt(3),
        missingColumnCount: BigInt(0),
        auditTableCount: BigInt(11),
        blockers: ['pgaudit_not_preloaded', 'pgaudit_not_installed'],
        recommendedAnonSteps: ['CREATE EXTENSION IF NOT EXISTS anon CASCADE;'],
        recommendedPgauditSteps: ['CREATE EXTENSION IF NOT EXISTS pgaudit;'],
      },
    ]);

    const readiness = await getSecurityExtensionReadiness();

    expect(readiness).toMatchObject({
      policyCount: 32,
      anonLabelPolicyCount: 6,
      anonLabelAppliedCount: 6,
      missingColumnCount: 0,
      auditTableCount: 11,
      readyForAnonMasking: true,
      readyForPgaudit: false,
      blockers: ['pgaudit_not_preloaded', 'pgaudit_not_installed'],
    });
  });

  it('requires all anon labels to be applied before reporting masked export readiness', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        anonAvailable: true,
        anonInstalled: true,
        anonPreloaded: true,
        pgauditAvailable: true,
        pgauditInstalled: true,
        pgauditPreloaded: true,
        policyCount: 2,
        anonLabelPolicyCount: 2,
        anonLabelAppliedCount: 1,
        manualRedactPolicyCount: 0,
        auditOnlyPolicyCount: 0,
        missingColumnCount: 0,
        auditTableCount: 1,
        blockers: null,
        recommendedAnonSteps: null,
        recommendedPgauditSteps: null,
      },
    ]);

    await expect(getSecurityExtensionReadiness()).resolves.toMatchObject({
      readyForAnonMasking: false,
      readyForPgaudit: true,
      blockers: [],
      recommendedAnonSteps: [],
      recommendedPgauditSteps: [],
    });
  });
});

describe('listSensitiveColumnReadiness', () => {
  it('returns sensitive column policy rows ordered by the database view', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        tableSchema: 'public',
        tableName: 'Order',
        columnName: 'receiverPhone',
        dataClass: 'pii',
        maskingStrategy: 'anon_security_label',
        anonMaskExpression: 'anon.partial("receiverPhone", 3, $$****$$, 4)',
        auditScope: 'READ_WRITE',
        priority: 32,
        rationale: 'receiver phone is searchable but must be masked',
        columnExists: true,
        currentAnonLabel: null,
        anonLabelApplied: false,
        applyAnonLabelSql:
          'SECURITY LABEL FOR anon ON COLUMN public."Order"."receiverPhone" IS \'MASKED WITH FUNCTION anon.partial("receiverPhone", 3, $$****$$, 4)\';',
        handlingNote: 'Apply the generated anon SECURITY LABEL.',
      },
    ]);

    await expect(listSensitiveColumnReadiness()).resolves.toEqual([
      expect.objectContaining({
        tableName: 'Order',
        columnName: 'receiverPhone',
        maskingStrategy: 'anon_security_label',
        anonLabelApplied: false,
      }),
    ]);
  });
});

describe('listSecurityAuditTableReadiness', () => {
  it('normalizes nullable array columns from the audit table view', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        tableSchema: 'public',
        tableName: 'Bill',
        auditReads: true,
        auditWrites: true,
        allColumnsExist: true,
        sensitiveColumns: null,
        auditOperations: null,
        auditGrantSql:
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Bill" TO erp_auditor;',
      },
    ]);

    await expect(listSecurityAuditTableReadiness()).resolves.toEqual([
      {
        tableSchema: 'public',
        tableName: 'Bill',
        auditReads: true,
        auditWrites: true,
        allColumnsExist: true,
        sensitiveColumns: [],
        auditOperations: [],
        auditGrantSql:
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Bill" TO erp_auditor;',
      },
    ]);
  });
});
