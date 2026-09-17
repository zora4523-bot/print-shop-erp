import { Readable } from 'node:stream';
import { access } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundJobAttemptStatus,
  BackgroundJobQueue,
  BackgroundJobStatus,
  MachineType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderExportStatus,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  ProductCategory,
  Role,
  TaskStatus,
  WorkerType,
} from '../../../generated/prisma/client';

const {
  auditMock,
  dbMock,
  deleteArtifactMock,
  enqueueBackgroundJobMock,
  openArtifactMock,
  txMock,
  writeXlsxFileMock,
  resolveAdminWorkspaceResultWhereMock,
} = vi.hoisted(() => {
  const transactionClient = {
    orderExport: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    backgroundJob: { updateMany: vi.fn() },
    backgroundJobAttempt: { updateMany: vi.fn() },
  };
  return {
    auditMock: vi.fn(),
    dbMock: {
      order: { findMany: vi.fn() },
      craft: { findMany: vi.fn() },
      orderItem: { findMany: vi.fn() },
      orderPackagingGroup: { findMany: vi.fn() },
      orderItemPlateDetail: { findMany: vi.fn() },
      orderCustomerCharge: { findMany: vi.fn() },
      orderPricingRevision: { findMany: vi.fn() },
      productionTask: { findMany: vi.fn() },
      orderShipment: { findMany: vi.fn() },
      orderShipmentLine: { findMany: vi.fn() },
      outsourceOrder: { findMany: vi.fn() },
      orderCostEntry: { findMany: vi.fn() },
      orderChangeRequest: { findMany: vi.fn() },
      orderLog: { findMany: vi.fn() },
      orderItemDesign: { findMany: vi.fn() },
      billItem: { findMany: vi.fn() },
      orderExport: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
    deleteArtifactMock: vi.fn(),
    enqueueBackgroundJobMock: vi.fn(),
    openArtifactMock: vi.fn(),
    txMock: transactionClient,
    writeXlsxFileMock: vi.fn(),
    resolveAdminWorkspaceResultWhereMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: auditMock }));
vi.mock('@/lib/background-jobs/repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));
vi.mock('@/lib/export/xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/export/xlsx')>();
  return { ...actual, writeXlsxFile: writeXlsxFileMock };
});
vi.mock('@/lib/order/export-artifact', () => ({
  cleanupUntrackedOrderExportArtifacts: vi.fn(),
  deleteOrderExportArtifact: deleteArtifactMock,
  ensureOrderExportArtifactDir: vi.fn(),
  openOrderExportArtifact: openArtifactMock,
  orderExportArtifactPath: vi.fn((name: string) => `/tmp/${name}`),
}));
vi.mock('@/lib/order/admin-workspace-filters', () => ({
  resolveAdminWorkspaceResultWhere: resolveAdminWorkspaceResultWhereMock,
}));

import {
  InvalidOrderExportRequestError,
  OrderExportExpiredError,
  OrderExportFailedError,
  OrderExportNotFoundError,
  OrderExportNotReadyError,
  cleanupExpiredOrderExports,
  prepareOrderExportDownload,
  processOrderExportInline,
  processQueuedOrderExport,
  requestOrderExport,
  OrderExportActorInvalidError,
  OrderExportNotPendingError,
  OrderExportSchemaVersionError,
} from '../export';
import { xlsxDecimal, type XlsxRow, type XlsxSheet } from '@/lib/export/xlsx';

const REQUEST_KEY = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-07T08:00:00.000Z');
const EMPTY_FILTER_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const FILTERED_HASH = 'b828afc6acc88f33e61ab6f98c3cf9b904e9681657058ac3934b17268115e496';
const actor = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: Role.ADMIN,
};

function exportRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'export-1',
    requestKey: REQUEST_KEY,
    createdById: actor.id,
    filters: { scope: 'filtered', params: { q: '客户甲' } },
    snapshotAt: NOW,
    schemaVersion: 3,
    status: OrderExportStatus.PENDING,
    backgroundJobId: null,
    matchedOrderCount: 0,
    rowCounts: null,
    artifactName: null,
    fileName: '工单导出_202608071600_00000000.xlsx',
    byteSize: null,
    // Keep the default fixture valid independently of the wall-clock date.
    // Expiry-specific cases override this value explicitly below.
    expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    downloadCount: 0,
    lastErrorCode: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function queuedExportRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...exportRow(),
    filters: { scope: 'all', params: {} },
    createdBy: { ...actor, isActive: true },
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderItem.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderPackagingGroup.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderItemPlateDetail.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderCustomerCharge.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderPricingRevision.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderShipment.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderShipmentLine.findMany.mockReset().mockResolvedValue([]);
  dbMock.outsourceOrder.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderCostEntry.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderChangeRequest.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderLog.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderItemDesign.findMany.mockReset().mockResolvedValue([]);
  dbMock.billItem.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderExport.findUnique.mockReset().mockResolvedValue(null);
  dbMock.orderExport.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderExport.updateMany.mockReset().mockResolvedValue({ count: 1 });
  dbMock.$transaction.mockReset().mockImplementation(async (callback: unknown) =>
    (callback as (tx: typeof txMock) => Promise<unknown>)(txMock),
  );
  txMock.orderExport.create.mockReset().mockResolvedValue(exportRow());
  txMock.orderExport.update.mockReset().mockResolvedValue({});
  txMock.orderExport.updateMany.mockReset().mockResolvedValue({ count: 1 });
  txMock.orderExport.findUniqueOrThrow.mockReset();
  txMock.backgroundJob.updateMany.mockReset().mockResolvedValue({ count: 1 });
  txMock.backgroundJobAttempt.updateMany.mockReset().mockResolvedValue({ count: 1 });
  auditMock.mockReset().mockResolvedValue({ id: 'audit-1' });
  enqueueBackgroundJobMock.mockReset().mockResolvedValue({
    job: { id: 'job-1' },
    created: true,
  });
  openArtifactMock.mockReset();
  deleteArtifactMock.mockReset().mockResolvedValue(undefined);
  writeXlsxFileMock.mockReset();
  resolveAdminWorkspaceResultWhereMock.mockReset();
});

describe('requestOrderExport', () => {
  it('replays an existing request only for its original actor', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(exportRow());

    await expect(
      requestOrderExport({
        actor,
        requestKey: REQUEST_KEY,
        scope: 'filtered',
        params: { q: '客户甲' },
        durable: true,
        now: NOW,
      }),
    ).resolves.toMatchObject({ id: 'export-1', status: OrderExportStatus.PENDING });

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('hides another actor request when the request key collides', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({ createdById: 'admin-2' }),
    );

    await expect(
      requestOrderExport({
        actor,
        requestKey: REQUEST_KEY,
        scope: 'all',
        params: {},
        durable: true,
      }),
    ).rejects.toBeInstanceOf(OrderExportNotFoundError);

    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('replays the winner after a concurrent unique-key insert race', async () => {
    dbMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate request key', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    dbMock.orderExport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(exportRow());

    await expect(
      requestOrderExport({
        actor,
        requestKey: REQUEST_KEY,
        scope: 'all',
        params: {},
        durable: true,
      }),
    ).resolves.toMatchObject({ id: 'export-1', status: OrderExportStatus.PENDING });

    expect(dbMock.orderExport.findUnique).toHaveBeenCalledTimes(2);
    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('atomically creates a durable export and enqueues it on HEAVY', async () => {
    const result = await requestOrderExport({
      actor,
      requestKey: REQUEST_KEY,
      scope: 'filtered',
      params: { q: '客户甲', status: 'SUBMITTED' },
      durable: true,
      now: NOW,
    });

    expect(result).toMatchObject({
      id: 'export-1',
      status: OrderExportStatus.PENDING,
      scope: 'filtered',
    });
    expect(txMock.orderExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestKey: REQUEST_KEY,
        createdById: actor.id,
        filters: {
          scope: 'filtered',
          params: { q: '客户甲', status: 'SUBMITTED' },
          filterHash: FILTERED_HASH,
        },
        snapshotAt: NOW,
        schemaVersion: 3,
      }),
    });
    expect(enqueueBackgroundJobMock).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'ORDER_EXPORT',
        queue: BackgroundJobQueue.HEAVY,
        dedupeKey: 'order-export:export-1',
        payload: { exportId: 'export-1' },
        priority: 90,
        maxAttempts: 3,
      },
      txMock,
    );
    expect(txMock.orderExport.update).toHaveBeenCalledWith({
      where: { id: 'export-1' },
      data: { backgroundJobId: 'job-1' },
    });

    const auditInput = auditMock.mock.calls[0]?.[1] as {
      action: string;
      after: Record<string, unknown>;
    };
    expect(auditInput.action).toBe('ORDER_EXPORT_REQUESTED');
    expect(auditInput.after).toEqual({
      scope: 'filtered',
      schemaVersion: 3,
      backgroundJobId: '[QUEUED]',
    });
    expect(JSON.stringify(auditInput.after)).not.toContain('客户甲');
  });

  it('accepts a valid 501-character multi-value filter used by the list UI', async () => {
    const foilColor = [
      ...Array.from(
        { length: 100 },
        (_, index) => `色${String(index).padStart(3, '0')}`,
      ),
      '金',
    ].join(',');
    expect(foilColor).toHaveLength(501);

    await requestOrderExport({
      actor,
      requestKey: REQUEST_KEY,
      scope: 'filtered',
      params: { foilColor },
      durable: true,
      now: NOW,
    });

    expect(txMock.orderExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filters: expect.objectContaining({
          scope: 'filtered',
          params: { foilColor },
        }),
      }),
    });
  });

  it('persists workspace-only queue, signal, star and billing filters canonically', async () => {
    await requestOrderExport({
      actor,
      requestKey: REQUEST_KEY,
      scope: 'filtered',
      params: {
        adminWorkspace: 'v1',
        queue: 'production',
        signal: 'overdue',
        starred: 'yes',
        unbilled: 'yes',
        q: '客户甲',
      },
      durable: true,
      now: NOW,
    });

    expect(txMock.orderExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filters: {
          scope: 'filtered',
          params: {
            q: '客户甲',
            queue: 'production',
            signal: 'overdue',
            starred: 'yes',
            unbilled: 'yes',
            adminWorkspace: 'v1',
          },
          filterHash: expect.any(String),
        },
      }),
    });
  });

  it('rejects a direct domain request whose normalized params exceed 10,000 characters', async () => {
    await expect(
      requestOrderExport({
        actor,
        requestKey: REQUEST_KEY,
        scope: 'filtered',
        params: { foilColor: '金,'.repeat(5_001) },
        durable: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: 'InvalidOrderExportRequestError',
      message: '筛选条件过多',
    });

    expect(dbMock.orderExport.findUnique).not.toHaveBeenCalled();
    expect(txMock.orderExport.create).not.toHaveBeenCalled();
  });

  it('does not create a background job for inline mode', async () => {
    await requestOrderExport({
      actor,
      requestKey: REQUEST_KEY,
      scope: 'all',
      params: { q: '应被忽略' },
      durable: false,
      now: NOW,
    });

    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
    expect(txMock.orderExport.update).not.toHaveBeenCalled();
    expect(txMock.orderExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filters: { scope: 'all', params: {}, filterHash: EMPTY_FILTER_HASH },
      }),
    });
    expect(auditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        after: expect.objectContaining({ backgroundJobId: null }),
      }),
    );
  });

  it('rejects non-admin actors before touching the database', async () => {
    await expect(
      requestOrderExport({
        actor: { ...actor, role: Role.SALES },
        requestKey: REQUEST_KEY,
        scope: 'all',
        params: {},
        durable: true,
      }),
    ).rejects.toBeInstanceOf(InvalidOrderExportRequestError);

    expect(dbMock.orderExport.findUnique).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('processQueuedOrderExport', () => {
  it('rebuilds a workspace export through the shared workspace predicate at its snapshot time', async () => {
    const stop = new Error('resolved workspace predicate');
    resolveAdminWorkspaceResultWhereMock.mockRejectedValueOnce(stop);
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({
        snapshotAt: NOW,
        filters: {
          scope: 'filtered',
          params: {
            adminWorkspace: 'v1',
            queue: 'production',
            starred: 'yes',
          },
        },
      }),
    );

    await expect(processQueuedOrderExport('export-1')).rejects.toBe(stop);
    expect(resolveAdminWorkspaceResultWhereMock).toHaveBeenCalledWith(
      { id: actor.id, role: Role.ADMIN },
      expect.objectContaining({
        queue: 'production',
        starred: true,
      }),
      NOW,
    );
  });

  it('returns an already-ready result without regenerating the workbook', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({
        status: OrderExportStatus.READY,
        artifactName: 'export-1.xlsx',
        matchedOrderCount: 3,
        rowCounts: { '工单': 3 },
        byteSize: BigInt('4096'),
      }),
    );

    const result = await processQueuedOrderExport('export-1');
    expect(result).toEqual({
      exportId: 'export-1',
      artifactName: 'export-1.xlsx',
      fileName: '工单导出_202608071600_00000000.xlsx',
      matchedOrderCount: 3,
      rowCounts: { '工单': 3 },
      byteSize: '4096',
    });

    expect(writeXlsxFileMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-pending export before touching the artifact', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({ status: OrderExportStatus.FAILED }),
    );

    await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
      OrderExportNotPendingError,
    );
    expect(writeXlsxFileMock).not.toHaveBeenCalled();
    expect(deleteArtifactMock).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive administrator', { ...actor, isActive: false }],
    ['non-administrator', { ...actor, role: Role.SALES, isActive: true }],
  ])('rejects an %s before querying orders', async (_label, createdBy) => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({ createdBy }),
    );

    await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
      OrderExportActorInvalidError,
    );
    expect(dbMock.order.findMany).not.toHaveBeenCalled();
    expect(writeXlsxFileMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported schema before querying orders', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({ schemaVersion: 99 }),
    );

    await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
      OrderExportSchemaVersionError,
    );
    expect(dbMock.order.findMany).not.toHaveBeenCalled();
    expect(writeXlsxFileMock).not.toHaveBeenCalled();
  });

  it('expires a stale PENDING export before creating any artifact', async () => {
    const expiresAt = new Date('2000-01-01T00:00:00.000Z');
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({
        backgroundJobId: 'job-expired',
        expiresAt,
        filters: {
          scope: 'filtered',
          params: { q: '客户甲' },
          filterHash: '158ca041e6d01766bc58e6b095df7e805a836d32a0c0e7dfb8ae4432e3288eb0',
        },
      }),
    );

    await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
      OrderExportExpiredError,
    );

    const transition = txMock.orderExport.updateMany.mock.calls[0]?.[0];
    expect(transition.where).toEqual({
      id: 'export-1',
      status: OrderExportStatus.PENDING,
      expiresAt: { lte: expect.any(Date) },
    });
    expect(transition.data).toEqual({
      status: OrderExportStatus.EXPIRED,
      filters: { scope: 'filtered' },
      lastErrorCode: 'OrderExportExpiredBeforeProcessing',
    });
    expect(txMock.backgroundJob.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'job-expired',
        type: 'ORDER_EXPORT',
        status: {
          in: [BackgroundJobStatus.PENDING, BackgroundJobStatus.RUNNING],
        },
      },
      data: expect.objectContaining({
        status: BackgroundJobStatus.CANCELLED,
        lastErrorCode: 'OrderExportExpired',
      }),
    });
    expect(writeXlsxFileMock).not.toHaveBeenCalled();
    expect(deleteArtifactMock).not.toHaveBeenCalled();
  });

  it('streams the strict membership into all sheets and atomically marks READY', async () => {
    const sheetNames = [
      '工单',
      '款式',
      '包装组及组成',
      '制版明细',
      '对客收费',
      '价格修订',
      '生产任务',
      '收货地址',
      '地址款式分配',
      '外协',
      '成本明细',
      '修改申请',
      '操作记录',
      '设计文件',
      '账单关联',
    ];
    const singleRowSheets = new Set([
      '工单',
      '款式',
      '包装组及组成',
      '对客收费',
      '价格修订',
      '生产任务',
      '修改申请',
    ]);
    const rowCounts = Object.fromEntries(sheetNames.map((name) => [
      name,
      singleRowSheets.has(name) ? 1 : name === '操作记录' ? 2 : 0,
    ]));
    const consumed = new Map<string, XlsxRow[]>();
    const order = {
      id: 'order-1',
      orderNo: 'GD-260807-001',
      customName: '中秋礼盒',
      status: OrderStatus.SUBMITTED,
      kind: OrderKind.NORMAL,
      billingMode: OrderBillingMode.CHARGE,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      sourceOrder: null,
      reworkCause: null,
      reworkReason: null,
      requiresOutsource: false,
      isUrgent: true,
      isSfCollect: false,
      customerRef: '客户甲',
      receiverName: '张三',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市',
      expressCode: 'SF',
      trackingNo: 'SF123',
      totalAmount: new Prisma.Decimal('1234.56'),
      revision: 2,
      workOrderVersion: 3,
      promisedDate: new Date('2026-08-10T00:00:00.000Z'),
      packageRequirement: '防水',
      remark: '重点跟单',
      submitter: { displayName: '销售甲' },
      submitterRole: Role.SALES,
      createdBy: { displayName: '管理员', role: Role.ADMIN },
      submittedAt: NOW,
      scheduledAt: null,
      completedAt: null,
      shippedAt: null,
      finishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const item = {
      id: 'item-1',
      orderId: 'order-1',
      sequence: 1,
      name: '款式 A',
      product: {
        code: 'P-001',
        name: '万元封',
        category: ProductCategory.COLOR_PRINT,
      },
      specification: '大号',
      paperType: '艳红珠光纸',
      quantity: 1000,
      crafts: ['craft-1'],
      foilColors: ['哑金', '银色'],
      isDoubleSided: true,
      isDoubleColor: false,
      unitPrice: new Prisma.Decimal('0.1234'),
      fixedFee: new Prisma.Decimal('12.00'),
      subtotal: new Prisma.Decimal('135.40'),
      suggestedSubtotal: new Prisma.Decimal('150.00'),
      priceOverrideReason: '客户协议价',
      remark: '红色高亮',
      createdAt: NOW,
    };
    const packagingGroup = {
      orderId: 'order-1',
      sequence: 1,
      name: '中秋混装袋',
      mode: 'MIXED_STYLE',
      actualBagCount: 500,
      unitPrice: new Prisma.Decimal('0.2000'),
      subtotal: new Prisma.Decimal('100.00'),
      lines: [
        {
          unitsPerBag: 2,
          orderItem: { sequence: 1, name: '款式 A' },
        },
      ],
    };
    const customerCharge = {
      orderId: 'order-1',
      businessKey: 'MANUAL:SAMPLE:1',
      status: 'FINAL',
      description: '打样费',
      quantity: new Prisma.Decimal('1.000'),
      unit: '次',
      unitPrice: new Prisma.Decimal('80.0000'),
      suggestedAmount: new Prisma.Decimal('60.00'),
      amount: new Prisma.Decimal('80.00'),
      isAdjustment: true,
      overrideReason: '客户要求加急打样',
      approvalReference: '审批单 SP-001',
      finalizedAt: NOW,
      createdAt: NOW,
      category: { code: 'SAMPLE_FEE', name: '打样费' },
      shipment: null,
      priceBook: {
        code: 'EXT-2026',
        name: '外部销售加工价',
        version: 4,
        currency: 'CNY',
        sourceName: '加工价目表.xlsx',
      },
      sourceRule: {
        code: 'SAMPLE-BASE',
        name: '基础打样费',
        sourceName: '加工价目表.xlsx',
        sourceSheet: '附加费',
        sourceRange: 'B12',
      },
      createdBy: { displayName: '管理员' },
      finalizedBy: { displayName: '财务甲' },
    };
    const pricingRevision = {
      orderId: 'order-1',
      revision: 2,
      status: 'ADMIN_CONFIRMED',
      source: 'ADMIN_FULL_REPRICE',
      snapshot: {
        version: 2,
        order: {
          processingAmount: '235.40',
          packagingAmount: '100.00',
          totalAmount: '315.40',
        },
        metadata: {
          priceBooks: {
            processing: { name: '外部销售加工价', version: 4 },
            logistics: { code: 'LOGISTICS', version: 3 },
          },
        },
        items: [
          {
            pricingSnapshot: {
              priceBook: { name: '外部销售加工价', version: 4 },
              appliedAdjustments: [{ ruleCode: 'PAPER-OVER-160' }],
            },
          },
        ],
      },
      createdBy: { displayName: '管理员' },
      createdAt: NOW,
    };
    const task = {
      orderItem: { orderId: 'order-1', sequence: 1, name: '款式 A' },
      craft: { name: '铜版纸彩印+烫金' },
      worker: { displayName: '师傅甲' },
      workerType: WorkerType.MACHINE,
      machineType: MachineType.HAND_PRESS,
      status: TaskStatus.COMPLETED,
      plannedQty: 1000,
      boardCount: 4,
      pressCount: 2000,
      completedQty: 980,
      defectQty: 15,
      reworkQty: 5,
      pieceworkAmount: new Prisma.Decimal('40.00'),
      startedAt: NOW,
      completedAt: NOW,
      remark: '首件已确认',
    };
    const changeRequest = {
      orderId: 'order-1',
      baseRevision: 1,
      status: OrderChangeRequestStatus.APPROVED,
      reason: '客户改数量',
      requester: { displayName: '销售甲' },
      reviewedBy: { displayName: '管理员' },
      reviewRemark: '同意',
      reviewedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };

    dbMock.orderExport.findUnique.mockResolvedValue(queuedExportRow());
    // 两个调用点现在都用 select：清单查询只取 {id, orderNo}，
    // 工单表查询带 customName，据此区分。
    dbMock.order.findMany.mockImplementation(
      async (args: { select?: Record<string, unknown> }) =>
        args.select?.customName
          ? [order]
          : [{ id: 'order-1', orderNo: 'GD-260807-001' }],
    );
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-1', name: '铜版纸彩印+烫金' },
    ]);
    // 款式表查询带 product 关联；外协表借道的款式标签查询只取 {id, sequence, name}。
    dbMock.orderItem.findMany.mockImplementation(
      async (args: { select?: Record<string, unknown> }) =>
        args.select?.product ? [item] : [],
    );
    dbMock.orderPackagingGroup.findMany.mockResolvedValue([packagingGroup]);
    dbMock.orderCustomerCharge.findMany.mockResolvedValue([customerCharge]);
    dbMock.orderPricingRevision.findMany.mockResolvedValue([pricingRevision]);
    dbMock.productionTask.findMany.mockResolvedValue([task]);
    dbMock.orderChangeRequest.findMany.mockResolvedValue([changeRequest]);
    dbMock.orderLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        orderId: 'order-1',
        action: 'UPDATE',
        changedFields: {
          status: { before: 'SUBMITTED', after: 'SCHEDULING' },
          remark: { before: '旧备注', after: '新备注' },
          workerId: { before: null, after: 'worker-secret-id' },
          taskId: { before: null, after: 'task-secret-id' },
          sourceOrderId: { before: null, after: 'source-secret-id' },
          reworkOrderId: { before: null, after: 'rework-secret-id' },
        },
        operator: { displayName: '管理员' },
        remark: '更新工单',
        createdAt: NOW,
      },
    ]);
    let publishedArtifactName = '';
    writeXlsxFileMock.mockImplementation(
      async (input: { filePath: string; sheets: readonly XlsxSheet[] }) => {
        expect(input.filePath).toMatch(
          /^\/tmp\/export-1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/,
        );
        publishedArtifactName = input.filePath.slice('/tmp/'.length);
        for (const sheet of input.sheets) {
          const rows: XlsxRow[] = [];
          for await (const row of sheet.rows) rows.push(row);
          consumed.set(sheet.name, rows);
        }
        return { byteLength: 8192, sheetCount: input.sheets.length };
      },
    );
    txMock.orderExport.findUniqueOrThrow.mockImplementation(async () =>
      queuedExportRow({
        status: OrderExportStatus.READY,
        matchedOrderCount: 1,
        rowCounts,
        artifactName: publishedArtifactName,
        byteSize: BigInt('8192'),
      }),
    );

    const result = await processQueuedOrderExport('export-1');
    expect(result).toEqual({
      exportId: 'export-1',
      artifactName: publishedArtifactName,
      fileName: '工单导出_202608071600_00000000.xlsx',
      matchedOrderCount: 1,
      rowCounts,
      byteSize: '8192',
    });

    expect(dbMock.order.findMany.mock.calls[0]?.[0]).toEqual({
      where: { AND: [{}, { createdAt: { lte: NOW } }] },
      select: { id: true, orderNo: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    expect([...consumed.keys()]).toEqual(sheetNames);
    expect(consumed.get('工单')).toHaveLength(2);
    expect(consumed.get('工单')?.[0]?.slice(0, 6)).toEqual([
      '工单号',
      '工单名称',
      '状态',
      '类型',
      '计费方式',
      '结算路径',
    ]);
    expect(consumed.get('工单')?.[1]?.slice(0, 6)).toEqual([
      'GD-260807-001',
      '中秋礼盒',
      '已提交',
      '普通工单',
      '计费',
      '外部销售应付工厂',
    ]);
    expect(consumed.get('工单')?.[1]?.[18]).toEqual(
      xlsxDecimal('1234.56'),
    );
    expect(consumed.get('工单')?.[0]?.slice(19, 21)).toEqual([
      '数据修订版本',
      '工单版本',
    ]);
    expect(consumed.get('工单')?.[1]?.slice(19, 21)).toEqual([2, 3]);
    expect(consumed.get('款式')).toHaveLength(2);
    expect(consumed.get('款式')?.[1]?.slice(0, 11)).toEqual([
      'GD-260807-001',
      1,
      '款式 A',
      'P-001',
      '万元封',
      '彩印',
      '大号',
      '艳红珠光纸',
      1000,
      '铜版纸彩印+烫金',
      '哑金、银金',
    ]);
    expect(consumed.get('款式')?.[1]?.slice(13, 18)).toEqual([
      xlsxDecimal('0.1234'),
      xlsxDecimal('12.00'),
      xlsxDecimal('135.40'),
      xlsxDecimal('150.00'),
      '客户协议价',
    ]);
    expect(consumed.get('包装组及组成')).toEqual([
      [
        '工单号',
        '包装组序号',
        '包装组名称',
        '组模式',
        '实际包装数量',
        '每袋/盒单价',
        '小计',
        '每袋/盒各款组成',
      ],
      [
        'GD-260807-001',
        1,
        '中秋混装袋',
        '混装',
        500,
        xlsxDecimal('0.2000'),
        xlsxDecimal('100.00'),
        '#1 款式 A × 2',
      ],
    ]);
    expect(consumed.get('对客收费')?.[1]).toEqual([
      'GD-260807-001',
      '打样费',
      'SAMPLE_FEE',
      'MANUAL:SAMPLE:1',
      undefined,
      '打样费',
      xlsxDecimal('1.000'),
      '次',
      xlsxDecimal('80.0000'),
      xlsxDecimal('60.00'),
      xlsxDecimal('80.00'),
      '已终审',
      '是',
      '客户要求加急打样',
      '审批单 SP-001',
      '外部销售加工价（EXT-2026 v4，CNY）',
      '加工价目表.xlsx',
      '基础打样费（SAMPLE-BASE） · 加工价目表.xlsx / 附加费 / B12',
      '管理员',
      '2026/08/07 16:00',
      '财务甲',
      '2026/08/07 16:00',
    ]);
    expect(consumed.get('价格修订')?.[1]).toEqual([
      'GD-260807-001',
      2,
      '管理员终价已确认',
      'ADMIN_FULL_REPRICE',
      '管理员终价',
      xlsxDecimal('235.40'),
      xlsxDecimal('100.00'),
      xlsxDecimal('315.40'),
      '加工：外部销售加工价 v4；物流：LOGISTICS v3；规则：PAPER-OVER-160',
      '管理员',
      '2026/08/07 16:00',
    ]);
    // 逐格锁死：select 少取一列，对应格会变 undefined，这里当场红。
    expect(consumed.get('生产任务')?.[1]).toEqual([
      'GD-260807-001', 1, '款式 A', '铜版纸彩印+烫金', '师傅甲', '开机师傅', '开机仔',
      '已完工', 1000, 4, 2000, 980, 15, 5, xlsxDecimal('40.00'),
      '2026/08/07 16:00', '2026/08/07 16:00', '首件已确认',
    ]);
    expect(consumed.get('修改申请')?.[1]).toEqual([
      'GD-260807-001', 1, '已同意', '客户改数量', '销售甲', '2026/08/07 16:00',
      '管理员', '同意', '2026/08/07 16:00', '2026/08/07 16:00',
    ]);
    // 工作表查询一律显式 select：任何一处退回 include 都会把
    // pricingSnapshot / salaryRuleSnapshot / beforeSnapshot 整列拖回来。
    const sheetQueries = [
      dbMock.order.findMany,
      dbMock.orderItem.findMany,
      dbMock.orderPackagingGroup.findMany,
      dbMock.orderItemPlateDetail.findMany,
      dbMock.orderCustomerCharge.findMany,
      dbMock.orderPricingRevision.findMany,
      dbMock.productionTask.findMany,
      dbMock.orderShipment.findMany,
      dbMock.orderShipmentLine.findMany,
      dbMock.outsourceOrder.findMany,
      dbMock.orderCostEntry.findMany,
      dbMock.orderChangeRequest.findMany,
      dbMock.orderLog.findMany,
      dbMock.orderItemDesign.findMany,
      dbMock.billItem.findMany,
    ] as unknown as { mock: { calls: [Record<string, unknown>][] } }[];
    const sheetQueryArgs = sheetQueries.flatMap((query) =>
      query.mock.calls.map(([args]) => args),
    );
    expect(sheetQueryArgs.length).toBeGreaterThanOrEqual(sheetQueries.length);
    for (const args of sheetQueryArgs) {
      expect(args).not.toHaveProperty('include');
      expect(args).toHaveProperty('select');
    }
    const itemSelect = sheetQueries[1].mock.calls
      .map(([args]) => args.select as Record<string, unknown>)
      .find((select) => select.product);
    expect(itemSelect).not.toHaveProperty('pricingSnapshot');
    expect(sheetQueries[6].mock.calls[0]?.[0].select)
      .not.toHaveProperty('salaryRuleSnapshot');
    const chargeSelect = sheetQueries[4].mock.calls[0]?.[0].select as Record<
      string,
      unknown
    >;
    expect(chargeSelect).toMatchObject({
      isAdjustment: true,
      approvalReference: true,
      priceBook: { select: expect.any(Object) },
      sourceRule: { select: expect.any(Object) },
    });
    const revisionSelect = sheetQueries[5].mock.calls[0]?.[0].select as Record<
      string,
      unknown
    >;
    expect(revisionSelect).toMatchObject({
      revision: true,
      status: true,
      source: true,
      snapshot: true,
      createdBy: { select: { displayName: true } },
    });
    const changeSelect = sheetQueries[11].mock.calls[0]?.[0].select as Record<string, unknown>;
    expect(changeSelect).not.toHaveProperty('beforeSnapshot');
    expect(changeSelect).not.toHaveProperty('proposedChanges');
    expect(consumed.get('操作记录')).toEqual([
      ['工单号', '操作', '变更字段', '变更前', '变更后', '操作人', '备注', '操作时间'],
      [
        'GD-260807-001', '编辑', '状态', '已提交', '待排产', '管理员', '更新工单',
        '2026/08/07 16:00',
      ],
      [
        'GD-260807-001', '编辑', '工单备注', '旧备注', '新备注', '管理员', '更新工单',
        '2026/08/07 16:00',
      ],
    ]);
    expect(JSON.stringify(consumed.get('操作记录'))).not.toMatch(
      /worker-secret-id|task-secret-id|source-secret-id|rework-secret-id|workerId|taskId|sourceOrderId|reworkOrderId/,
    );

    expect(txMock.orderExport.updateMany).toHaveBeenCalledTimes(1);
    const readyData = txMock.orderExport.updateMany.mock.calls[0]?.[0].data as {
      status: OrderExportStatus;
      matchedOrderCount: number;
      rowCounts: Record<string, number>;
      artifactName: string;
      filters: { scope: 'all' };
      byteSize: bigint;
      completedAt: Date;
      expiresAt: Date;
      lastErrorCode: null;
    };
    expect(readyData).toMatchObject({
      status: OrderExportStatus.READY,
      matchedOrderCount: 1,
      rowCounts,
      artifactName: publishedArtifactName,
      filters: { scope: 'all' },
      byteSize: BigInt('8192'),
      lastErrorCode: null,
    });
    expect(readyData.filters).toEqual({ scope: 'all' });
    expect(readyData.filters).not.toHaveProperty('params');
    expect(readyData.filters).not.toHaveProperty('filterHash');
    expect(txMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'export-1',
        status: OrderExportStatus.PENDING,
        expiresAt: { gt: readyData.completedAt },
      },
      data: readyData,
    });
    expect(readyData.expiresAt.getTime() - readyData.completedAt.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(auditMock).toHaveBeenCalledWith(txMock, {
      actor,
      action: 'ORDER_EXPORT_READY',
      entityType: 'OrderExport',
      entityId: 'export-1',
      after: {
        matchedOrderCount: 1,
        rowCounts,
        byteSize: '8192',
        schemaVersion: 3,
      },
    });
    expect(deleteArtifactMock).not.toHaveBeenCalled();
    await expect(access('/tmp/export-1.xlsx.orders')).rejects.toThrow();
  });

  it('deletes the artifact and unlinks membership when streaming fails', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(queuedExportRow());
    dbMock.order.findMany.mockResolvedValue([
      { id: 'order-1', orderNo: 'GD-260807-001' },
    ]);
    writeXlsxFileMock.mockRejectedValue(new Error('writer failed'));

    await expect(processQueuedOrderExport('export-1')).rejects.toThrow(
      'writer failed',
    );

    const attemptedPath = writeXlsxFileMock.mock.calls[0]?.[0].filePath as string;
    expect(attemptedPath).toMatch(
      /^\/tmp\/export-1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/,
    );
    expect(deleteArtifactMock).toHaveBeenCalledExactlyOnceWith(
      attemptedPath.slice('/tmp/'.length),
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    await expect(access('/tmp/export-1.xlsx.orders')).rejects.toThrow();
  });

  it('deletes only the losing attempt artifact when another worker wins READY publish', async () => {
    dbMock.orderExport.findUnique
      .mockResolvedValueOnce(queuedExportRow())
      .mockResolvedValueOnce(
        queuedExportRow({
          status: OrderExportStatus.READY,
          artifactName: 'export-1-winner.xlsx',
        }),
      );
    dbMock.order.findMany.mockResolvedValue([]);
    writeXlsxFileMock.mockResolvedValue({ byteLength: 128, sheetCount: 15 });
    txMock.orderExport.updateMany.mockResolvedValue({ count: 0 });

    await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
      OrderExportNotPendingError,
    );

    const attemptedPath = writeXlsxFileMock.mock.calls[0]?.[0].filePath as string;
    const attemptedArtifact = attemptedPath.slice('/tmp/'.length);
    expect(attemptedArtifact).toMatch(
      /^export-1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/,
    );
    expect(deleteArtifactMock).toHaveBeenCalledExactlyOnceWith(attemptedArtifact);
    expect(deleteArtifactMock).not.toHaveBeenCalledWith('export-1-winner.xlsx');
    expect(dbMock.orderExport.findUnique).toHaveBeenCalledTimes(2);
    expect(txMock.orderExport.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('keeps the published artifact when READY committed but the transaction response was lost', async () => {
    let artifactName = '';
    const responseLost = new Error('commit response lost');
    dbMock.orderExport.findUnique
      .mockResolvedValueOnce(queuedExportRow())
      .mockImplementationOnce(async () =>
        queuedExportRow({
          status: OrderExportStatus.READY,
          artifactName,
          matchedOrderCount: 0,
          rowCounts: {},
          byteSize: BigInt(128),
        }),
      );
    dbMock.order.findMany.mockResolvedValue([]);
    writeXlsxFileMock.mockImplementation(async ({ filePath }: { filePath: string }) => {
      artifactName = filePath.slice('/tmp/'.length);
      return { byteLength: 128, sheetCount: 15 };
    });
    txMock.orderExport.findUniqueOrThrow.mockImplementation(async () =>
      queuedExportRow({
        status: OrderExportStatus.READY,
        artifactName,
        matchedOrderCount: 0,
        rowCounts: {},
        byteSize: BigInt(128),
      }),
    );
    dbMock.$transaction.mockImplementationOnce(async (callback: unknown) => {
      await (callback as (tx: typeof txMock) => Promise<unknown>)(txMock);
      throw responseLost;
    });

    const recovered = await processQueuedOrderExport('export-1');
    expect(recovered).toEqual({
      exportId: 'export-1',
      artifactName,
      fileName: '工单导出_202608071600_00000000.xlsx',
      matchedOrderCount: 0,
      rowCounts: {},
      byteSize: '128',
    });
    expect(dbMock.orderExport.findUnique).toHaveBeenCalledTimes(2);
    expect(deleteArtifactMock).not.toHaveBeenCalled();
  });

  it('expires and deletes an attempt that crosses its deadline before READY publish', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const expiresAt = new Date(NOW.getTime() + 1_000);
      const completedAt = new Date(NOW.getTime() + 2_000);
      dbMock.orderExport.findUnique.mockResolvedValue(
        queuedExportRow({ expiresAt }),
      );
      dbMock.order.findMany.mockResolvedValue([]);
      writeXlsxFileMock.mockImplementation(async () => {
        vi.setSystemTime(completedAt);
        return { byteLength: 128, sheetCount: 15 };
      });

      await expect(processQueuedOrderExport('export-1')).rejects.toBeInstanceOf(
        OrderExportExpiredError,
      );

      expect(txMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'export-1',
          status: OrderExportStatus.PENDING,
          expiresAt: { lte: completedAt },
        },
        data: {
          status: OrderExportStatus.EXPIRED,
          filters: { scope: 'all' },
          lastErrorCode: 'OrderExportExpiredBeforeProcessing',
        },
      });
      const attemptedPath = writeXlsxFileMock.mock.calls[0]?.[0].filePath as string;
      expect(deleteArtifactMock).toHaveBeenCalledExactlyOnceWith(
        attemptedPath.slice('/tmp/'.length),
      );
      expect(auditMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrubs stored filter params when inline processing reaches FAILED', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      queuedExportRow({
        filters: {
          scope: 'filtered',
          params: { q: '客户甲' },
          filterHash: '158ca041e6d01766bc58e6b095df7e805a836d32a0c0e7dfb8ae4432e3288eb0',
        },
      }),
    );
    dbMock.order.findMany.mockResolvedValue([]);
    writeXlsxFileMock.mockRejectedValue(new Error('writer failed'));

    await expect(processOrderExportInline('export-1')).rejects.toThrow('writer failed');

    expect(dbMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'export-1', status: OrderExportStatus.PENDING },
      data: {
        status: OrderExportStatus.FAILED,
        lastErrorCode: 'Error',
        filters: {
          scope: 'filtered',
        },
      },
    });
  });
});

describe('prepareOrderExportDownload', () => {
  it('does not reveal an export owned by another actor', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({
        createdById: 'admin-2',
        status: OrderExportStatus.READY,
        artifactName: 'export-1.xlsx',
      }),
    );

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toBeInstanceOf(OrderExportNotFoundError);

    expect(openArtifactMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('expires and deletes a ready artifact before refusing its download', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({
        status: OrderExportStatus.READY,
        artifactName: 'export-1.xlsx',
        expiresAt: NOW,
      }),
    );

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toBeInstanceOf(OrderExportNotFoundError);

    expect(dbMock.orderExport.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'export-1', status: OrderExportStatus.READY },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: {
          scope: 'filtered',
        },
      },
    });
    expect(deleteArtifactMock).toHaveBeenCalledExactlyOnceWith('export-1.xlsx');
    expect(dbMock.orderExport.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'export-1',
        status: OrderExportStatus.EXPIRED,
        artifactName: 'export-1.xlsx',
      },
      data: { artifactName: null },
    });
    expect(openArtifactMock).not.toHaveBeenCalled();
  });

  it('returns not-ready without opening or auditing a pending export', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(exportRow());

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toBeInstanceOf(OrderExportNotReadyError);

    expect(openArtifactMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('returns an explicit terminal error for a FAILED export', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({ status: OrderExportStatus.FAILED }),
    );

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toBeInstanceOf(OrderExportFailedError);

    expect(openArtifactMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('increments the owner download count and writes a bounded audit record', async () => {
    const stream = Readable.from(Buffer.from('xlsx'));
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({
        status: OrderExportStatus.READY,
        artifactName: 'export-1.xlsx',
        matchedOrderCount: 42,
        byteSize: BigInt('4'),
      }),
    );
    openArtifactMock.mockResolvedValue({ stream, byteLength: 4 });

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).resolves.toEqual({
      stream,
      byteLength: 4,
      fileName: '工单导出_202608071600_00000000.xlsx',
    });

    expect(txMock.orderExport.update).toHaveBeenCalledWith({
      where: { id: 'export-1' },
      data: { downloadCount: { increment: 1 } },
    });
    expect(auditMock).toHaveBeenCalledWith(txMock, {
      actor,
      action: 'ORDER_EXPORT_DOWNLOADED',
      entityType: 'OrderExport',
      entityId: 'export-1',
      after: {
        fileName: '工单导出_202608071600_00000000.xlsx',
        byteSize: '4',
        matchedOrderCount: 42,
      },
    });
  });

  it('marks a missing artifact failed without recording a download', async () => {
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({
        status: OrderExportStatus.READY,
        artifactName: 'missing.xlsx',
      }),
    );
    openArtifactMock.mockRejectedValue(new Error('ENOENT'));

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toBeInstanceOf(OrderExportFailedError);

    expect(dbMock.orderExport.updateMany).toHaveBeenCalledWith({
      where: { id: 'export-1', status: OrderExportStatus.READY },
      data: {
        status: OrderExportStatus.FAILED,
        lastErrorCode: 'OrderExportArtifactMissingError',
        filters: {
          scope: 'filtered',
        },
      },
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('destroys the opened stream when download auditing fails', async () => {
    const stream = Readable.from(Buffer.from('xlsx'));
    dbMock.orderExport.findUnique.mockResolvedValue(
      exportRow({
        status: OrderExportStatus.READY,
        artifactName: 'export-1.xlsx',
      }),
    );
    openArtifactMock.mockResolvedValue({ stream, byteLength: 4 });
    auditMock.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      prepareOrderExportDownload('export-1', actor, NOW),
    ).rejects.toThrow('audit unavailable');
    expect(stream.destroyed).toBe(true);
  });
});

describe('cleanupExpiredOrderExports', () => {
  it('expires and scrubs READY and stale PENDING rows, cancelling the stale job', async () => {
    dbMock.orderExport.findMany
      .mockResolvedValueOnce([
        exportRow({
          id: 'ready-export',
          status: OrderExportStatus.READY,
          artifactName: 'ready-export.xlsx',
          filters: {
            scope: 'filtered',
            params: { receiverPhone: '13800000000' },
            filterHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          expiresAt: NOW,
        }),
        exportRow({
          id: 'pending-export',
          status: OrderExportStatus.PENDING,
          backgroundJobId: 'job-pending',
          filters: {
            scope: 'all',
            params: {},
            filterHash: EMPTY_FILTER_HASH,
          },
          expiresAt: NOW,
        }),
      ])
      .mockResolvedValueOnce([]);

    await expect(cleanupExpiredOrderExports(NOW)).resolves.toBe(2);

    expect(txMock.orderExport.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'ready-export',
        status: OrderExportStatus.READY,
        expiresAt: { lte: NOW },
      },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: {
          scope: 'filtered',
        },
      },
    });
    expect(txMock.orderExport.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'pending-export',
        status: OrderExportStatus.PENDING,
        expiresAt: { lte: NOW },
      },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: { scope: 'all' },
        lastErrorCode: 'OrderExportExpiredBeforeProcessing',
      },
    });
    expect(txMock.backgroundJob.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'job-pending',
        type: 'ORDER_EXPORT',
        status: {
          in: [BackgroundJobStatus.PENDING, BackgroundJobStatus.RUNNING],
        },
      },
      data: {
        status: BackgroundJobStatus.CANCELLED,
        finishedAt: NOW,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
        lastErrorCode: 'OrderExportExpired',
      },
    });
    expect(txMock.backgroundJobAttempt.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        jobId: 'job-pending',
        status: BackgroundJobAttemptStatus.RUNNING,
      },
      data: {
        status: BackgroundJobAttemptStatus.ABANDONED,
        errorCode: 'OrderExportExpired',
        finishedAt: NOW,
      },
    });
    expect(deleteArtifactMock).toHaveBeenCalledExactlyOnceWith('ready-export.xlsx');
    expect(dbMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'ready-export',
        status: OrderExportStatus.EXPIRED,
        artifactName: 'ready-export.xlsx',
      },
      data: { artifactName: null },
    });
  });

  it('keeps a failed artifact deletion discoverable and retries an EXPIRED row', async () => {
    const filters = {
      scope: 'all',
      params: {},
      filterHash: EMPTY_FILTER_HASH,
    };
    dbMock.orderExport.findMany.mockResolvedValueOnce([
      exportRow({
        id: 'retry-export',
        status: OrderExportStatus.READY,
        artifactName: 'retry-export.xlsx',
        filters,
        expiresAt: NOW,
      }),
    ]);
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    deleteArtifactMock.mockRejectedValueOnce(permissionError);

    await expect(cleanupExpiredOrderExports(NOW)).rejects.toBe(permissionError);

    expect(dbMock.orderExport.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          {
            status: { in: [OrderExportStatus.READY, OrderExportStatus.PENDING] },
            expiresAt: { lte: NOW },
          },
          {
            status: OrderExportStatus.EXPIRED,
            artifactName: { not: null },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        artifactName: true,
        filters: true,
        backgroundJobId: true,
        expiresAt: true,
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    expect(txMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'retry-export',
        status: OrderExportStatus.READY,
        expiresAt: { lte: NOW },
      },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: { scope: 'all' },
      },
    });
    expect(dbMock.orderExport.updateMany).not.toHaveBeenCalled();

    dbMock.orderExport.findMany
      .mockResolvedValueOnce([
        exportRow({
          id: 'retry-export',
          status: OrderExportStatus.EXPIRED,
          artifactName: 'retry-export.xlsx',
          filters: { scope: 'all', filterHash: EMPTY_FILTER_HASH },
          expiresAt: NOW,
        }),
      ])
      .mockResolvedValueOnce([]);
    deleteArtifactMock.mockResolvedValueOnce(undefined);

    await expect(cleanupExpiredOrderExports(NOW)).resolves.toBe(0);

    expect(deleteArtifactMock).toHaveBeenCalledTimes(2);
    expect(deleteArtifactMock).toHaveBeenNthCalledWith(2, 'retry-export.xlsx');
    expect(dbMock.orderExport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'retry-export',
        status: OrderExportStatus.EXPIRED,
        artifactName: 'retry-export.xlsx',
      },
      data: { artifactName: null },
    });
  });

  it('drains 500 expired rows per run and continues the remainder on the next run', async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      exportRow({
        id: `expired-${String(index).padStart(3, '0')}`,
        status: OrderExportStatus.READY,
        artifactName: null,
        filters: {
          scope: 'filtered',
          params: { q: `客户-${index}` },
          filterHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        expiresAt: NOW,
      }),
    );
    dbMock.orderExport.findMany
      .mockResolvedValueOnce(rows.slice(0, 100))
      .mockResolvedValueOnce(rows.slice(100, 200))
      .mockResolvedValueOnce(rows.slice(200, 300))
      .mockResolvedValueOnce(rows.slice(300, 400))
      .mockResolvedValueOnce(rows.slice(400, 500))
      .mockResolvedValueOnce([]);

    await expect(cleanupExpiredOrderExports(NOW)).resolves.toBe(500);

    expect(txMock.orderExport.updateMany).toHaveBeenCalledTimes(500);
    expect(dbMock.orderExport.findMany).toHaveBeenCalledTimes(6);
    for (const callIndex of [0, 1, 2, 3, 4]) {
      expect(dbMock.orderExport.findMany.mock.calls[callIndex]?.[0]).toEqual({
        where: {
          OR: [
            {
              status: { in: [OrderExportStatus.READY, OrderExportStatus.PENDING] },
              expiresAt: { lte: NOW },
            },
            {
              status: OrderExportStatus.EXPIRED,
              artifactName: { not: null },
            },
          ],
        },
        select: {
          id: true,
          status: true,
          artifactName: true,
          filters: true,
          backgroundJobId: true,
          expiresAt: true,
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
    }

    dbMock.orderExport.findMany
      .mockResolvedValueOnce([rows[500]])
      .mockResolvedValueOnce([]);

    await expect(cleanupExpiredOrderExports(NOW)).resolves.toBe(1);
    expect(txMock.orderExport.updateMany).toHaveBeenCalledTimes(501);
    expect(txMock.orderExport.updateMany.mock.calls[500]?.[0]).toEqual({
      where: {
        id: 'expired-500',
        status: OrderExportStatus.READY,
        expiresAt: { lte: NOW },
      },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: { scope: 'filtered' },
      },
    });
  });
});
