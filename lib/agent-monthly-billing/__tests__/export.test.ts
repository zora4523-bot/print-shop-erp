import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { artifactMock, auditMock, clockMock, dbMock, enqueueMock, xlsxMock } = vi.hoisted(
  () => ({
    artifactMock: {
      agentMonthlyBillExportArtifactPath: vi.fn(
        (name: string) => `/tmp/${name}`,
      ),
      cleanupUntrackedAgentMonthlyBillExportArtifacts: vi.fn(),
      deleteAgentMonthlyBillExportArtifact: vi.fn(),
      ensureAgentMonthlyBillExportArtifactDir: vi.fn(),
      openAgentMonthlyBillExportArtifact: vi.fn(),
    },
    auditMock: vi.fn(),
    clockMock: vi.fn(),
    enqueueMock: vi.fn(),
    xlsxMock: vi.fn(),
    dbMock: {
      agentMonthlyBillExport: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      agentMonthlyBill: { findMany: vi.fn() },
      agentMonthlyBillItem: { findMany: vi.fn() },
      agentMonthlyBillAdjustment: { findMany: vi.fn() },
      agentMonthlyBillReceipt: { findMany: vi.fn() },
      agentMonthlyBillExportSnapshot: {
        createMany: vi.fn(),
        findMany: vi.fn(),
      },
      backgroundJob: { updateMany: vi.fn() },
      backgroundJobAttempt: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
  }),
);

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: auditMock }));
vi.mock('@/lib/background-jobs/repository', () => ({
  enqueueBackgroundJob: enqueueMock,
}));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: clockMock,
}));
vi.mock('@/lib/export/xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/export/xlsx')>();
  return { ...original, writeXlsxFile: xlsxMock };
});
vi.mock('@/lib/agent-monthly-billing/export-artifact', () => artifactMock);

import {
  AgentMonthlyBillExportStatus,
  AgentMonthlyBillStatus,
  BackgroundJobQueue,
  Prisma,
  Role,
} from '../../../generated/prisma/client';
import {
  AgentMonthlyBillExportActorInvalidError,
  AgentMonthlyBillExportNotFoundError,
  InvalidAgentMonthlyBillExportRequestError,
  prepareAgentMonthlyBillExportDownload,
  processQueuedAgentMonthlyBillExport,
  requestAgentMonthlyBillExport,
} from '../export';

const NOW = new Date('2026-09-02T03:00:00.000Z');
const REQUEST_KEY = '5ba4ce49-6a55-4c27-b876-f6b6edae13a4';
const actor = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: Role.ADMIN,
};

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'export-1',
    requestKey: REQUEST_KEY,
    createdById: actor.id,
    filters: { period: '2026-08', status: AgentMonthlyBillStatus.CONFIRMED },
    snapshotAt: NOW,
    schemaVersion: 1,
    status: AgentMonthlyBillExportStatus.PENDING,
    backgroundJobId: 'job-1',
    matchedBillCount: 0,
    rowCounts: null,
    artifactName: null,
    fileName: '代理商月账单.xlsx',
    byteSize: null,
    expiresAt: new Date('2026-09-03T03:00:00.000Z'),
    downloadCount: 0,
    lastErrorCode: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function snapshotPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    bill: {
      period: '2026-08',
      agentDisplayNameSnapshot: '代理商 A',
      agentUsernameSnapshot: 'agent-a',
      status: AgentMonthlyBillStatus.CONFIRMED,
      memberSubtotal: '100.00',
      adjustmentAmount: '-5.00',
      totalAmount: '95.00',
      confirmedAt: NOW.toISOString(),
      paidAt: null,
      createdAt: NOW.toISOString(),
      orderCount: 0,
    },
    items: [],
    adjustments: [],
    receipts: [],
    ...overrides,
  };
}

function snapshotSource(
  status: AgentMonthlyBillStatus = AgentMonthlyBillStatus.DRAFT,
) {
  return {
    id: 'bill-1',
    period: '2026-08',
    agentDisplayNameSnapshot: '代理商 A',
    agentUsernameSnapshot: 'agent-a',
    status,
    memberSubtotal: new Prisma.Decimal('100'),
    adjustmentAmount: new Prisma.Decimal('0'),
    totalAmount: new Prisma.Decimal('100'),
    confirmedAt: status === AgentMonthlyBillStatus.DRAFT ? null : NOW,
    paidAt: null,
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    items: [],
    adjustments: [],
    receipt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clockMock.mockResolvedValue(NOW);
  dbMock.$transaction.mockImplementation(async (callback) => callback(dbMock));
  dbMock.agentMonthlyBill.findMany.mockResolvedValue([]);
  dbMock.agentMonthlyBillExportSnapshot.createMany.mockResolvedValue({ count: 0 });
  dbMock.agentMonthlyBillExport.updateMany.mockResolvedValue({ count: 1 });
  artifactMock.cleanupUntrackedAgentMonthlyBillExportArtifacts.mockResolvedValue(0);
  artifactMock.deleteAgentMonthlyBillExportArtifact.mockResolvedValue(undefined);
  artifactMock.ensureAgentMonthlyBillExportArtifactDir.mockResolvedValue(undefined);
  xlsxMock.mockImplementation(async ({ sheets }) => {
    for (const sheet of sheets) {
      for await (const row of sheet.rows) {
        // Consume every generator so all sheets execute under the transaction.
        void row;
      }
    }
    return { byteLength: 321, sheetCount: sheets.length };
  });
});

describe('requestAgentMonthlyBillExport', () => {
  it('persists a separate ledger and enqueues a HEAVY job idempotently', async () => {
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValue(null);
    dbMock.agentMonthlyBillExport.create.mockResolvedValue(
      exportRow({ backgroundJobId: null }),
    );
    enqueueMock.mockResolvedValue({ job: { id: 'job-1' } });

    const result = await requestAgentMonthlyBillExport({
      actor,
      requestKey: REQUEST_KEY,
      filter: { period: '2026-08', status: AgentMonthlyBillStatus.CONFIRMED },
      durable: true,
      now: NOW,
    });

    expect(result.id).toBe('export-1');
    expect(dbMock.agentMonthlyBillExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestKey: REQUEST_KEY,
        createdById: actor.id,
        filters: {
          period: '2026-08',
          status: AgentMonthlyBillStatus.CONFIRMED,
        },
        snapshotAt: NOW,
      }),
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AGENT_MONTHLY_BILL_EXPORT',
        queue: BackgroundJobQueue.HEAVY,
        payload: { exportId: 'export-1' },
      }),
      dbMock,
    );
  });

  it('rejects malformed filters before creating a ledger row', async () => {
    await expect(
      requestAgentMonthlyBillExport({
        actor,
        requestKey: REQUEST_KEY,
        filter: { period: '2026-8' },
        durable: true,
      }),
    ).rejects.toBeInstanceOf(InvalidAgentMonthlyBillExportRequestError);
    expect(dbMock.agentMonthlyBillExport.create).not.toHaveBeenCalled();
  });

  it('does not reveal another administrator export on idempotent replay', async () => {
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValue(
      exportRow({ createdById: 'admin-2' }),
    );
    await expect(
      requestAgentMonthlyBillExport({
        actor,
        requestKey: REQUEST_KEY,
        filter: { period: '2026-08', status: AgentMonthlyBillStatus.CONFIRMED },
        durable: true,
      }),
    ).rejects.toBeInstanceOf(AgentMonthlyBillExportNotFoundError);
  });
});

describe('processQueuedAgentMonthlyBillExport', () => {
  it('re-authorizes the requester before touching an artifact', async () => {
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValue(
      exportRow({
        createdBy: { ...actor, isActive: false },
      }),
    );
    await expect(
      processQueuedAgentMonthlyBillExport('export-1'),
    ).rejects.toBeInstanceOf(AgentMonthlyBillExportActorInvalidError);
    expect(artifactMock.ensureAgentMonthlyBillExportArtifactDir).not.toHaveBeenCalled();
  });

  it('uses one fixed membership manifest and one REPEATABLE READ snapshot for every sheet', async () => {
    dbMock.agentMonthlyBillExport.findUnique
      .mockResolvedValueOnce(
        exportRow({ createdBy: { ...actor, isActive: true } }),
      )
      .mockResolvedValue(null);
    dbMock.agentMonthlyBillExportSnapshot.findMany
      .mockResolvedValueOnce([{ id: 'snapshot-1' }])
      .mockResolvedValue([{ payload: snapshotPayload() }]);
    dbMock.agentMonthlyBillExport.findUniqueOrThrow.mockResolvedValue(
      exportRow({
        status: AgentMonthlyBillExportStatus.READY,
        artifactName: 'export-1.xlsx',
        byteSize: BigInt(321),
        matchedBillCount: 1,
        rowCounts: { '月账单': 1 },
        completedAt: NOW,
      }),
    );
    dbMock.agentMonthlyBillExport.findMany.mockResolvedValue([]);

    const result = await processQueuedAgentMonthlyBillExport('export-1');

    expect(result).toMatchObject({ exportId: 'export-1', matchedBillCount: 1 });
    const snapshotTransaction = dbMock.$transaction.mock.calls[0];
    expect(snapshotTransaction?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 10 * 60_000,
    });
    expect(dbMock.agentMonthlyBill.findMany).not.toHaveBeenCalled();
    expect(dbMock.agentMonthlyBillExportSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { exportId: 'export-1' } }),
    );
  });

  it('keeps the request-time DRAFT row when the live bill becomes CONFIRMED before execution', async () => {
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValueOnce(null);
    dbMock.agentMonthlyBill.findMany.mockResolvedValueOnce([snapshotSource()]);
    dbMock.agentMonthlyBillExport.create.mockResolvedValue(
      exportRow({ backgroundJobId: null }),
    );
    dbMock.agentMonthlyBillExportSnapshot.createMany.mockResolvedValue({ count: 1 });

    await requestAgentMonthlyBillExport({
      actor,
      requestKey: REQUEST_KEY,
      filter: { period: '2026-08', status: AgentMonthlyBillStatus.DRAFT },
      durable: false,
    });
    const persisted = dbMock.agentMonthlyBillExportSnapshot.createMany.mock
      .calls[0]?.[0].data[0].payload;
    expect(persisted).toMatchObject({
      bill: { status: AgentMonthlyBillStatus.DRAFT, totalAmount: '100.00' },
    });
    expect(clockMock).toHaveBeenCalledWith(dbMock);

    dbMock.agentMonthlyBill.findMany.mockClear();
    dbMock.agentMonthlyBill.findMany.mockResolvedValue([
      snapshotSource(AgentMonthlyBillStatus.CONFIRMED),
    ]);
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValueOnce(
      exportRow({
        filters: { period: '2026-08', status: AgentMonthlyBillStatus.DRAFT },
        createdBy: { ...actor, isActive: true },
      }),
    );
    dbMock.agentMonthlyBillExportSnapshot.findMany
      .mockResolvedValueOnce([{ id: 'snapshot-1' }])
      .mockResolvedValue([{ payload: persisted }]);
    dbMock.agentMonthlyBillExport.findUniqueOrThrow.mockResolvedValue(
      exportRow({
        status: AgentMonthlyBillExportStatus.READY,
        artifactName: 'export-1.xlsx',
        byteSize: BigInt(321),
        matchedBillCount: 1,
        rowCounts: { '月账单': 1 },
        completedAt: NOW,
      }),
    );
    dbMock.agentMonthlyBillExport.findMany.mockResolvedValue([]);
    const billSheetRows: unknown[][] = [];
    xlsxMock.mockImplementationOnce(async ({ sheets }) => {
      for (const [sheetIndex, sheet] of sheets.entries()) {
        for await (const row of sheet.rows) {
          if (sheetIndex === 0) billSheetRows.push([...row]);
        }
      }
      return { byteLength: 321, sheetCount: sheets.length };
    });

    await processQueuedAgentMonthlyBillExport('export-1');

    expect(dbMock.agentMonthlyBill.findMany).not.toHaveBeenCalled();
    expect(billSheetRows[1]?.[3]).toBe('草稿');
    expect(billSheetRows[1]?.[7]).toMatchObject({
      kind: 'xlsx-decimal',
      value: '100.00',
    });
  });
});

describe('prepareAgentMonthlyBillExportDownload', () => {
  it('requires current ownership and appends an audited download count', async () => {
    const stream = Readable.from([Buffer.from('xlsx')]);
    dbMock.agentMonthlyBillExport.findUnique.mockResolvedValue(
      exportRow({
        status: AgentMonthlyBillExportStatus.READY,
        artifactName: 'export-1.xlsx',
        byteSize: BigInt(4),
        completedAt: NOW,
      }),
    );
    artifactMock.openAgentMonthlyBillExportArtifact.mockResolvedValue({
      stream,
      byteLength: 4,
    });

    await expect(
      prepareAgentMonthlyBillExportDownload('export-1', actor, NOW),
    ).resolves.toMatchObject({ stream, byteLength: 4 });
    expect(dbMock.agentMonthlyBillExport.update).toHaveBeenCalledWith({
      where: { id: 'export-1' },
      data: { downloadCount: { increment: 1 } },
    });
    expect(auditMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        action: 'AGENT_MONTHLY_BILL_EXPORT_DOWNLOADED',
        actor,
      }),
    );
  });
});
