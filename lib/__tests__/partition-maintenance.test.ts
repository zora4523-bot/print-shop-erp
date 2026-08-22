import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getPartitionMaintenanceReadiness } from '../partition-maintenance';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('getPartitionMaintenanceReadiness', () => {
  it('normalizes blockers, bigint counts, and readiness', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        parentTable: 'public."MaterialTransaction"',
        controlColumn: 'occurredAt',
        partitionInterval: '1 month',
        retention: '36 months',
        retentionKeepTable: true,
        priority: 10,
        rationale: '物料流水长期增长',
        pgPartmanAvailable: true,
        pgPartmanInstalled: true,
        parentExists: true,
        parentIsPartitioned: false,
        controlColumnExists: true,
        primaryKeyColumns: ['id'],
        primaryKeyIncludesControlColumn: false,
        incomingForeignKeyCount: 0,
        blockers: [
          'parent_table_is_not_partitioned',
          'primary_key_does_not_include_control_column',
        ],
        createParentSql: null,
        runMaintenanceSql:
          'SELECT partman.run_maintenance(p_parent_table := \'public."MaterialTransaction"\');',
      },
      {
        parentTable: 'public."FutureAuditLog"',
        controlColumn: 'createdAt',
        partitionInterval: '1 month',
        retention: null,
        retentionKeepTable: true,
        priority: 40,
        rationale: 'future',
        pgPartmanAvailable: true,
        pgPartmanInstalled: true,
        parentExists: true,
        parentIsPartitioned: true,
        controlColumnExists: true,
        primaryKeyColumns: ['id', 'createdAt'],
        primaryKeyIncludesControlColumn: true,
        incomingForeignKeyCount: 2,
        blockers: null,
        createParentSql:
          'SELECT partman.create_parent(p_parent_table := \'public."FutureAuditLog"\', p_control := \'createdAt\', p_interval := \'1 month\');',
        runMaintenanceSql:
          'SELECT partman.run_maintenance(p_parent_table := \'public."FutureAuditLog"\');',
      },
    ]);

    const rows = await getPartitionMaintenanceReadiness();

    expect(rows[0]).toMatchObject({
      parentTable: 'public."MaterialTransaction"',
      readyForPartman: false,
      incomingForeignKeyCount: 0,
      blockers: [
        'parent_table_is_not_partitioned',
        'primary_key_does_not_include_control_column',
      ],
    });
    expect(rows[1]).toMatchObject({
      parentTable: 'public."FutureAuditLog"',
      readyForPartman: true,
      incomingForeignKeyCount: 2,
      blockers: [],
    });
  });
});
