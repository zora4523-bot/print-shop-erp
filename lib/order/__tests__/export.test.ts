import { Readable } from 'node:stream';
import { access } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundJobAttemptStatus,
  BackgroundJobQueue,
  BackgroundJobStatus,
  OrderBillingMode,
  OrderExportStatus,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  ProductCategory,
  Role,
} from '../../../generated/prisma/client';

const {
  auditMock,
  dbMock,
  deleteArtifactMock,
  enqueueBackgroundJobMock,
  openArtifactMock,
  txMock,
  writeXlsxFileMock,
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
    schemaVersion: 1,
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
        schemaVersion: 1,
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
      schemaVersion: 1,
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
      queuedExportRow({ schemaVersion: 2 }),
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
    const rowCounts = Object.fromEntries(sheetNames.map((name) => [
      name,
      name === '工单' || name === '款式' ? 1 : name === '操作记录' ? 2 : 0,
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

    dbMock.orderExport.findUnique.mockResolvedValue(queuedExportRow());
    dbMock.order.findMany.mockImplementation(
      async (args: { select?: unknown }) =>
        args.select
          ? [{ id: 'order-1', orderNo: 'GD-260807-001' }]
          : [order],
    );
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-1', name: '铜版纸彩印+烫金' },
    ]);
    dbMock.orderItem.findMany.mockImplementation(
      async (args: { include?: unknown }) => (args.include ? [item] : []),
    );
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
      '哑金、银色',
    ]);
    expect(consumed.get('款式')?.[1]?.slice(13, 18)).toEqual([
      xlsxDecimal('0.1234'),
      xlsxDecimal('12.00'),
      xlsxDecimal('135.40'),
      xlsxDecimal('150.00'),
      '客户协议价',
    ]);
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
        schemaVersion: 1,
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
    writeXlsxFileMock.mockResolvedValue({ byteLength: 128, sheetCount: 11 });
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
      return { byteLength: 128, sheetCount: 11 };
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
        return { byteLength: 128, sheetCount: 11 };
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
