import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderKind,
  OrderStatus,
  OutsourceStatus,
  Prisma,
  Role,
  ShipmentStatus,
  TaskStatus,
} from '../../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    order: { count: vi.fn(), findMany: vi.fn() },
    productionTask: { findMany: vi.fn() },
    dailyWorkerSalaryItem: { groupBy: vi.fn() },
    craft: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  buildOrderWhere,
  getOrderListFilterOptions,
  getOrderListPageWindow,
  listOrdersPage,
  MISSING_ORDER_CUSTOMER_FILTER_VALUE,
  orderListOrderBy,
  parseOrderListQuery,
  sanitizeOrderListQueryForActor,
  serializeOrderListQuery,
} from '../list-query';
import { encodeFoilColorFilterValues } from '../foil-color-filter-codec';

const salesActor = { id: 'sales-1', role: Role.SALES };
const adminActor = { id: 'admin-1', role: Role.ADMIN };
const workerActor = { id: 'worker-1', role: Role.WORKER };

beforeEach(() => {
  dbMock.order.count.mockReset().mockResolvedValue(0);
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalaryItem.groupBy.mockReset().mockResolvedValue([]);
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
  dbMock.user.findMany.mockReset().mockResolvedValue([]);
});

describe('parseOrderListQuery', () => {
  it('uses the stable newest-first and bounded pagination defaults', () => {
    const result = parseOrderListQuery({});

    expect(result.issues).toEqual([]);
    expect(result.query).toEqual({
      filters: {
        q: undefined,
        orderNo: undefined,
        customName: undefined,
        customerRef: undefined,
        customerPartyId: undefined,
        customerRefExact: undefined,
        receiverName: undefined,
        receiverPhone: undefined,
        receiverAddress: undefined,
        submitterId: undefined,
        workerId: undefined,
        statuses: [],
        kinds: [],
        isUrgent: undefined,
        isSfCollect: undefined,
        addressMode: undefined,
        amountMin: undefined,
        amountMax: undefined,
        createdFrom: undefined,
        createdTo: undefined,
        promisedFrom: undefined,
        promisedTo: undefined,
        trackingNo: undefined,
        expressCode: undefined,
        shipmentStatuses: [],
        itemName: undefined,
        productName: undefined,
        specification: undefined,
        paperType: undefined,
        quantityMin: undefined,
        quantityMax: undefined,
        craftIds: [],
        foilColors: [],
        taskStatuses: [],
        machineTypes: [],
        requiresOutsource: undefined,
        outsourceStatuses: [],
        supplierName: undefined,
      },
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      dir: 'desc',
    });
  });

  it('round-trips selected row, scroll position and the active saved view without filtering data', () => {
    const result = parseOrderListQuery({
      selected: 'order-123',
      scroll: '1842',
      view: 'urgent',
      isUrgent: 'yes',
    });

    expect(result.issues).toEqual([]);
    expect(result.query).toEqual(
      expect.objectContaining({
        selectedOrderId: 'order-123',
        scrollY: 1842,
        view: 'urgent',
      }),
    );
    expect(serializeOrderListQuery(result.query)).toEqual(
      expect.objectContaining({
        selected: 'order-123',
        scroll: 1842,
        view: 'urgent',
        isUrgent: 'yes',
      }),
    );
    expect(buildOrderWhere(adminActor, result.query.filters)).toEqual({
      AND: [{}, { isUrgent: true }],
    });
  });

  it('rejects forged presentation state instead of reflecting it into the page', () => {
    const result = parseOrderListQuery({
      selected: '../secret',
      scroll: '-10',
      view: 'unknown-view',
    });

    expect(result.issues).toEqual([
      '当前选中工单格式不合法',
      '列表滚动位置不合法',
      '保存视图不合法',
    ]);
    expect(result.query).not.toHaveProperty('selectedOrderId');
    expect(result.query).not.toHaveProperty('scrollY');
    expect(result.query).not.toHaveProperty('view');
  });

  it('normalizes every filter family without losing repeated values', () => {
    const result = parseOrderListQuery({
      q: '  苹果福  ',
      orderNo: 'GD-260807',
      customName: '中秋礼盒',
      customerRef: '客户甲',
      receiverName: '张三',
      receiverPhone: '138',
      receiverAddress: '佛山',
      submitterId: 'sales-1',
      workerId: 'worker-1',
      status: ['SUBMITTED,IN_PRODUCTION', 'SUBMITTED'],
      kind: 'REWORK',
      isUrgent: 'yes',
      isSfCollect: 'no',
      addressMode: 'multiple',
      amountMin: '1.2',
      amountMax: '3000',
      createdFrom: '2026-08-01',
      createdTo: '2026-08-07',
      promisedFrom: '2026-08-08',
      promisedTo: '2026-08-10',
      trackingNo: 'SF123',
      expressCode: '菜鸟',
      shipmentStatus: 'PLANNED,SHIPPED',
      itemName: '红包 A',
      productName: '万元封',
      specification: '大号',
      paperType: '艳红珠光纸',
      quantityMin: '100',
      quantityMax: '5000',
      craftId: ['craft-1', 'craft-2'],
      foilColor: '哑金,银色',
      taskStatus: 'PENDING,IN_PROGRESS',
      machineType: 'HAND_PRESS,WINDMILL',
      requiresOutsource: 'true',
      outsourceStatus: 'SENT,IN_PROGRESS',
      supplierName: '印刷厂',
      page: '3',
      pageSize: '999',
      sort: 'totalAmount',
      dir: 'asc',
    });

    expect(result.issues).toEqual([]);
    expect(result.query).toEqual({
      filters: {
        q: '苹果福',
        orderNo: 'GD-260807',
        customName: '中秋礼盒',
        customerRef: '客户甲',
        customerPartyId: undefined,
        customerRefExact: undefined,
        receiverName: '张三',
        receiverPhone: '138',
        receiverAddress: '佛山',
        submitterId: 'sales-1',
        workerId: 'worker-1',
        statuses: [OrderStatus.SUBMITTED, OrderStatus.IN_PRODUCTION],
        kinds: [OrderKind.REWORK],
        isUrgent: true,
        isSfCollect: false,
        addressMode: 'multiple',
        amountMin: '1.20',
        amountMax: '3000.00',
        createdFrom: '2026-08-01',
        createdTo: '2026-08-07',
        promisedFrom: '2026-08-08',
        promisedTo: '2026-08-10',
        trackingNo: 'SF123',
        expressCode: '菜鸟',
        shipmentStatuses: [ShipmentStatus.PLANNED, ShipmentStatus.SHIPPED],
        itemName: '红包 A',
        productName: '万元封',
        specification: '大号',
        paperType: '艳红珠光纸',
        quantityMin: 100,
        quantityMax: 5000,
        craftIds: ['craft-1', 'craft-2'],
        foilColors: ['哑金', '银色'],
        taskStatuses: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        machineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL],
        requiresOutsource: true,
        outsourceStatuses: [
          OutsourceStatus.SENT,
          OutsourceStatus.IN_PROGRESS,
        ],
        supplierName: '印刷厂',
      },
      page: 3,
      pageSize: 100,
      sort: 'totalAmount',
      dir: 'asc',
    });
  });

  it('reports invalid values instead of silently treating them as selected', () => {
    const result = parseOrderListQuery({
      status: 'NOT_A_STATUS',
      isUrgent: 'sometimes',
      createdFrom: '2026-02-31',
      amountMin: '-1',
      amountMax: 'abc',
      quantityMin: '5.5',
      craftId: '../secret',
      sort: 'unknown',
      dir: 'sideways',
    });

    expect(result.issues).toEqual([
      '最低金额必须是非负金额，最多两位小数',
      '最高金额必须是非负金额，最多两位小数',
      '最小数量必须是非负整数',
      '创建开始日期不合法',
      '排序字段不合法',
      '排序方向不合法',
      '工单状态选项不合法',
      '急单选项不合法',
      '工艺格式不合法',
    ]);
    expect(result.query.filters.statuses).toEqual([]);
    expect(result.query.filters.isUrgent).toBeUndefined();
    expect(result.query.sort).toBe('createdAt');
    expect(result.query.dir).toBe('desc');
  });

  it('does not reflect oversized invalid enum values into issue text', () => {
    const untrustedValue = 'X'.repeat(5_000);
    const result = parseOrderListQuery({ status: untrustedValue });

    expect(result.issues).toEqual(['工单状态选项不合法']);
    expect(result.issues.join('')).not.toContain(untrustedValue);
    expect(result.query.filters.statuses).toEqual([]);
  });

  it('reports reversed amount, quantity, creation and promised-date ranges', () => {
    const result = parseOrderListQuery({
      amountMin: '20',
      amountMax: '10',
      quantityMin: '200',
      quantityMax: '100',
      createdFrom: '2026-08-08',
      createdTo: '2026-08-07',
      promisedFrom: '2026-08-10',
      promisedTo: '2026-08-09',
    });

    expect(result.issues).toEqual([
      '最低金额不能大于最高金额',
      '最小数量不能大于最大数量',
      '创建开始日期不能晚于结束日期',
      '交期开始日期不能晚于结束日期',
    ]);
    expect(result.query.filters).toEqual(
      expect.objectContaining({
        amountMin: undefined,
        amountMax: undefined,
        quantityMin: undefined,
        quantityMax: undefined,
        createdFrom: undefined,
        createdTo: undefined,
        promisedFrom: undefined,
        promisedTo: undefined,
      }),
    );
    expect(buildOrderWhere(adminActor, result.query.filters)).toEqual({});
  });

  it('preserves commas in scalar text filters instead of treating them as lists', () => {
    const result = parseOrderListQuery({
      q: '华南,东区',
      customerRef: '客户,甲',
      receiverAddress: '佛山,南海',
      itemName: '款式,A',
      supplierName: '外协,一厂',
    });

    expect(result.issues).toEqual([]);
    expect(result.query.filters).toEqual(
      expect.objectContaining({
        q: '华南,东区',
        customerRef: '客户,甲',
        receiverAddress: '佛山,南海',
        itemName: '款式,A',
        supplierName: '外协,一厂',
      }),
    );
  });
});

describe('worker commercial-query boundary', () => {
  it('drops sales-only views for non-SALES actors', () => {
    const requested = parseOrderListQuery({ view: 'todo' }).query;

    expect(
      sanitizeOrderListQueryForActor(
        { role: Role.ADMIN },
        requested,
      ).view,
    ).toBeUndefined();
    expect(sanitizeOrderListQueryForActor(salesActor, requested)).toBe(
      requested,
    );
  });

  it('removes amount ranges and restores newest-first sorting for WORKER URLs', () => {
    const requested = parseOrderListQuery({
      amountMin: '10',
      amountMax: '500',
      sort: 'totalAmount',
      dir: 'asc',
    }).query;

    expect(sanitizeOrderListQueryForActor(workerActor, requested)).toEqual({
      ...requested,
      filters: {
        ...requested.filters,
        amountMin: undefined,
        amountMax: undefined,
      },
      sort: 'createdAt',
      dir: 'desc',
    });
    expect(sanitizeOrderListQueryForActor(salesActor, requested)).toBe(
      requested,
    );
  });

  it('ignores amount filters inside the scoped where builder for WORKER callers', () => {
    const query = parseOrderListQuery({
      amountMin: '10',
      amountMax: '500',
    }).query;

    expect(buildOrderWhere(workerActor, query.filters)).toEqual({
      status: { not: OrderStatus.SUBMITTED },
      items: {
        some: {
          tasks: { some: { workerId: 'worker-1' } },
        },
      },
    });
    expect(buildOrderWhere(salesActor, query.filters)).toEqual({
      AND: [
        { submitterId: 'sales-1' },
        {
          OR: [
            {
              settledFee: {
                gte: new Prisma.Decimal('10.00'),
                lte: new Prisma.Decimal('500.00'),
              },
            },
            {
              settledFee: null,
              confirmedFee: {
                gte: new Prisma.Decimal('10.00'),
                lte: new Prisma.Decimal('500.00'),
              },
            },
            {
              settledFee: null,
              confirmedFee: null,
              quotedFee: {
                gte: new Prisma.Decimal('10.00'),
                lte: new Prisma.Decimal('500.00'),
              },
            },
            {
              settledFee: null,
              confirmedFee: null,
              quotedFee: null,
              totalAmount: {
                gte: new Prisma.Decimal('10.00'),
                lte: new Prisma.Decimal('500.00'),
              },
            },
          ],
        },
      ],
    });
  });
});

describe('buildOrderWhere', () => {
  it('uses Party identity and unlinked snapshots for exact clickable customer filters', () => {
    const byParty = parseOrderListQuery({
      customerPartyId: 'party-1',
    }).query;
    const byLegacySnapshot = parseOrderListQuery({
      customerRefExact: '苹果福',
    }).query;
    const missing = parseOrderListQuery({
      customerRefExact: MISSING_ORDER_CUSTOMER_FILTER_VALUE,
    }).query;

    expect(serializeOrderListQuery(byParty)).toEqual(
      expect.objectContaining({
        customerPartyId: 'party-1',
        customerRefExact: undefined,
        customerRef: undefined,
      }),
    );
    expect(buildOrderWhere(adminActor, byParty.filters)).toEqual({
      AND: [{}, { customerPartyId: 'party-1' }],
    });
    expect(buildOrderWhere(adminActor, byLegacySnapshot.filters)).toEqual({
      AND: [
        {},
        {
          customerParty: { is: null },
          customerRef: { equals: '苹果福' },
        },
      ],
    });
    expect(buildOrderWhere(adminActor, missing.filters)).toEqual({
      AND: [
        {},
        {
          customerParty: { is: null },
          OR: [{ customerRef: null }, { customerRef: '' }],
        },
      ],
    });
  });

  it('matches displayed Party names and reserves an unambiguous missing-customer sentinel', () => {
    const byParty = parseOrderListQuery({
      customerRef: '苹果福',
    }).query.filters;
    const missing = parseOrderListQuery({
      customerRef: MISSING_ORDER_CUSTOMER_FILTER_VALUE,
    }).query.filters;
    const literalSameAsLabel = parseOrderListQuery({
      customerRef: '未填客户',
    }).query.filters;

    expect(buildOrderWhere(adminActor, byParty)).toEqual({
      AND: [
        {},
        {
          OR: [
            {
              customerRef: { contains: '苹果福', mode: 'insensitive' },
            },
            {
              customerParty: {
                is: {
                  OR: [
                    { name: { contains: '苹果福', mode: 'insensitive' } },
                    {
                      shortName: {
                        contains: '苹果福',
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    expect(buildOrderWhere(adminActor, missing)).toEqual({
      AND: [
        {},
        {
          customerParty: { is: null },
          OR: [{ customerRef: null }, { customerRef: '' }],
        },
      ],
    });
    expect(buildOrderWhere(adminActor, literalSameAsLabel)).toEqual(
      expect.objectContaining({
        AND: [
          {},
          expect.objectContaining({ OR: expect.any(Array) }),
        ],
      }),
    );
    expect(JSON.stringify(buildOrderWhere(adminActor, literalSameAsLabel))).not
      .toContain('"customerParty":{"is":null}');
  });

  it('includes linked Party names in global search', () => {
    const filters = parseOrderListQuery({ q: '苹果福' }).query.filters;
    expect(buildOrderWhere(adminActor, filters)).toEqual({
      AND: [
        {},
        expect.objectContaining({
          OR: expect.arrayContaining([
            {
              customerParty: {
                is: {
                  OR: [
                    { name: { contains: '苹果福', mode: 'insensitive' } },
                    {
                      shortName: {
                        contains: '苹果福',
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          ]),
        }),
      ],
    });
  });

  it('round-trips a created custom foil color containing commas into the exact Prisma predicate', () => {
    const createdFoilColors = ['红,金渐变', 'PANTONE\\871 C', '哑金'];
    const formValue = encodeFoilColorFilterValues(createdFoilColors);

    expect(formValue).toBe('红\\,金渐变,PANTONE\\\\871 C,哑金');

    const browserUrl = new URL('https://erp.example.test/orders');
    browserUrl.searchParams.set('foilColor', formValue!);
    const parsed = parseOrderListQuery({
      foilColor: browserUrl.searchParams.get('foilColor') ?? undefined,
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.query.filters.foilColors).toEqual(createdFoilColors);

    const serialized = serializeOrderListQuery(parsed.query);
    expect(serialized.foilColor).toBe(formValue);
    const reparsed = parseOrderListQuery({
      foilColor: String(serialized.foilColor),
    });
    expect(reparsed.query.filters.foilColors).toEqual(createdFoilColors);
    expect(buildOrderWhere(adminActor, reparsed.query.filters)).toEqual({
      AND: [
        {},
        {
          items: {
            some: { foilColors: { hasSome: createdFoilColors } },
          },
        },
      ],
    });
  });

  it('keeps SUBMITTED scheduling drafts out of the shared WORKER list scope', () => {
    const { query } = parseOrderListQuery({});

    expect(
      buildOrderWhere(
        { id: 'worker-1', role: Role.WORKER },
        query.filters,
      ),
    ).toEqual({
      status: { not: OrderStatus.SUBMITTED },
      items: {
        some: {
          tasks: { some: { workerId: 'worker-1' } },
        },
      },
    });
  });

  it('does not let a WORKER reveal a scheduling draft by explicitly filtering for SUBMITTED', () => {
    const { query } = parseOrderListQuery({ status: OrderStatus.SUBMITTED });

    expect(
      buildOrderWhere(
        { id: 'worker-1', role: Role.WORKER },
        query.filters,
      ),
    ).toEqual({
      AND: [
        {
          status: { not: OrderStatus.SUBMITTED },
          items: {
            some: {
              tasks: { some: { workerId: 'worker-1' } },
            },
          },
        },
        { status: { in: [OrderStatus.SUBMITTED] } },
      ],
    });
  });

  it('ANDs role scope with filters and keeps shipment/item/task predicates on the same child', () => {
    const { query } = parseOrderListQuery({
      receiverName: '张',
      trackingNo: 'SF',
      shipmentStatus: 'SHIPPED',
      itemName: '礼盒',
      paperType: '珠光',
      craftId: 'craft-1',
      workerId: 'worker-1',
      taskStatus: 'IN_PROGRESS',
      machineType: 'WINDMILL',
      supplierName: '外协厂',
      outsourceStatus: 'SENT',
    });

    expect(buildOrderWhere(salesActor, query.filters)).toEqual({
      AND: [
        { submitterId: 'sales-1' },
        {
          shipments: {
            some: {
              receiverName: { contains: '张', mode: 'insensitive' },
              trackingNo: { contains: 'SF', mode: 'insensitive' },
              status: { in: [ShipmentStatus.SHIPPED] },
            },
          },
        },
        {
          items: {
            some: {
              name: { contains: '礼盒', mode: 'insensitive' },
              paperType: { contains: '珠光', mode: 'insensitive' },
              crafts: { hasSome: ['craft-1'] },
              tasks: {
                some: {
                  workerId: 'worker-1',
                  status: { in: [TaskStatus.IN_PROGRESS] },
                  machineType: { in: [MachineType.WINDMILL] },
                },
              },
            },
          },
        },
        {
          outsourceOrders: {
            some: {
              status: { in: [OutsourceStatus.SENT] },
              supplierName: { contains: '外协厂', mode: 'insensitive' },
            },
          },
        },
      ],
    });
  });

  it('uses Shanghai event bounds for creation dates and UTC calendar bounds for promised dates', () => {
    const { query } = parseOrderListQuery({
      createdFrom: '2026-08-01',
      createdTo: '2026-08-02',
      promisedFrom: '2026-08-03',
      promisedTo: '2026-08-04',
    });

    expect(buildOrderWhere(adminActor, query.filters)).toEqual({
      AND: [
        {},
        {
          createdAt: {
            gte: new Date('2026-07-31T16:00:00.000Z'),
            lt: new Date('2026-08-02T16:00:00.000Z'),
          },
        },
        {
          promisedDate: {
            gte: new Date('2026-08-03T00:00:00.000Z'),
            lt: new Date('2026-08-05T00:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('distinguishes single-address and multi-address orders without a new column', () => {
    const multiple = parseOrderListQuery({ addressMode: 'multiple' }).query;
    const single = parseOrderListQuery({ addressMode: 'single' }).query;

    expect(buildOrderWhere(adminActor, multiple.filters)).toEqual({
      AND: [{}, { shipments: { some: { sequence: { gte: 2 } } } }],
    });
    expect(buildOrderWhere(adminActor, single.filters)).toEqual({
      AND: [{}, { NOT: { shipments: { some: { sequence: { gte: 2 } } } } }],
    });
  });
});

describe('listOrdersPage', () => {
  it('reuses a prepared page window without repeating the count read', async () => {
    dbMock.order.count.mockResolvedValue(41);
    const query = parseOrderListQuery({ page: '3' }).query;
    const windowPromise = getOrderListPageWindow(adminActor, query);

    const result = await listOrdersPage(adminActor, query, windowPromise);

    expect(dbMock.order.count).toHaveBeenCalledOnce();
    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
    expect(result).toMatchObject({
      total: 41,
      page: 3,
      pageCount: 3,
      pageSize: 20,
    });
  });

  it('does not select, filter, sort, or return commercial totals for WORKER', async () => {
    dbMock.order.count.mockResolvedValue(1);
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'worker-order-1',
        orderNo: 'GD-260807-001',
        customName: '师傅可见工单',
        status: OrderStatus.IN_PRODUCTION,
        kind: OrderKind.NORMAL,
        isUrgent: false,
        isSfCollect: false,
        customerRef: null,
        customerParty: { name: '客户全称', shortName: '苹果福' },
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        trackingNo: null,
        expressCode: null,
        // Deliberately over-rich mock: the return mapping must not leak a
        // value even if a future adapter supplies more than Prisma selected.
        totalAmount: '98765.43',
        submitterId: 'sales-1',
        submitter: { displayName: '销售甲' },
        sourceOrder: null,
        _count: { shipments: 1 },
        createdAt: new Date('2026-08-07T08:00:00Z'),
        updatedAt: new Date('2026-08-07T08:00:00Z'),
      },
    ]);
    const query = parseOrderListQuery({
      amountMin: '100',
      amountMax: '99999',
      sort: 'totalAmount',
      dir: 'asc',
    }).query;

    const result = await listOrdersPage(workerActor, query);

    const countArg = dbMock.order.count.mock.calls[0]![0];
    const findArg = dbMock.order.findMany.mock.calls[0]![0];
    expect(JSON.stringify(countArg.where)).not.toContain('totalAmount');
    expect(findArg.select).not.toHaveProperty('totalAmount');
    expect(findArg.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(result.rows[0]).toMatchObject({
      id: 'worker-order-1',
      totalAmount: null,
      pieceworkCost: null,
    });
  });

  it('uses strict newest-first stable order, clamps the requested page and only aggregates current-page ids', async () => {
    dbMock.order.count.mockResolvedValue(21);
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-21',
        orderNo: 'GD-260807-021',
        customName: null,
        status: OrderStatus.SUBMITTED,
        kind: OrderKind.NORMAL,
        isUrgent: false,
        isSfCollect: false,
        customerRef: null,
        customerParty: { name: '客户全称', shortName: '苹果福' },
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        trackingNo: null,
        expressCode: null,
        totalAmount: '100.00',
        submitterId: 'sales-1',
        submitter: { displayName: '销售甲' },
        sourceOrder: null,
        _count: { shipments: 2 },
        createdAt: new Date('2026-08-07T08:00:00Z'),
        updatedAt: new Date('2026-08-07T08:00:00Z'),
      },
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([
      {
        orderItem: { orderId: 'order-21' },
        worker: { displayName: '张师傅' },
      },
    ]);
    dbMock.dailyWorkerSalaryItem.groupBy.mockResolvedValue([
      { orderId: 'order-21', _sum: { pieceworkAmount: '12.30' } },
    ]);
    const query = parseOrderListQuery({ page: '99' }).query;

    const result = await listOrdersPage(adminActor, query);

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(dbMock.productionTask.findMany.mock.calls[0]![0].where).toEqual({
      orderItem: { orderId: { in: ['order-21'] } },
      workerId: { not: null },
      status: { not: TaskStatus.CANCELLED },
    });
    expect(dbMock.dailyWorkerSalaryItem.groupBy.mock.calls[0]![0].where).toEqual({
      orderId: { in: ['order-21'] },
    });
    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          id: 'order-21',
          customerRef: '苹果福',
          shipmentCount: 2,
          workerNames: ['张师傅'],
          pieceworkCost: '12.30',
        }),
      ],
      total: 21,
      page: 2,
      pageSize: 20,
      pageCount: 2,
    });
  });

  it('does not query relation aggregates for an empty page', async () => {
    const query = parseOrderListQuery({}).query;

    const result = await listOrdersPage(salesActor, query);

    expect(result.rows).toEqual([]);
    expect(dbMock.productionTask.findMany).not.toHaveBeenCalled();
    expect(dbMock.dailyWorkerSalaryItem.groupBy).not.toHaveBeenCalled();
  });
});

describe('order list URL and options', () => {
  it('serializes normalized filters without default pagination noise', () => {
    const query = parseOrderListQuery({
      q: '苹果福',
      status: 'SUBMITTED,COMPLETED',
      isUrgent: 'yes',
      amountMin: '1.2',
      craftId: 'craft-1,craft-2',
    }).query;

    expect(serializeOrderListQuery(query)).toEqual({
      q: '苹果福',
      orderNo: undefined,
      customName: undefined,
      customerRef: undefined,
      customerPartyId: undefined,
      customerRefExact: undefined,
      receiverName: undefined,
      receiverPhone: undefined,
      receiverAddress: undefined,
      submitterId: undefined,
      workerId: undefined,
      status: 'SUBMITTED,COMPLETED',
      kind: undefined,
      isUrgent: 'yes',
      isSfCollect: undefined,
      addressMode: undefined,
      amountMin: '1.20',
      amountMax: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      promisedFrom: undefined,
      promisedTo: undefined,
      trackingNo: undefined,
      expressCode: undefined,
      shipmentStatus: undefined,
      itemName: undefined,
      productName: undefined,
      specification: undefined,
      paperType: undefined,
      quantityMin: undefined,
      quantityMax: undefined,
      craftId: 'craft-1,craft-2',
      foilColor: undefined,
      taskStatus: undefined,
      machineType: undefined,
      requiresOutsource: undefined,
      outsourceStatus: undefined,
      supplierName: undefined,
      page: undefined,
      pageSize: undefined,
      sort: undefined,
      dir: undefined,
    });
  });

  it('loads personnel only for administrators and keeps inactive historical options discoverable', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'c1', name: '烫金', isActive: true },
      { id: 'c2', name: '退役工艺', isActive: false },
    ]);
    dbMock.user.findMany.mockResolvedValue([
      {
        id: 'a1',
        username: 'admin',
        displayName: '管理员',
        role: Role.ADMIN,
        isActive: true,
      },
      {
        id: 's1',
        username: 'sales-retired',
        displayName: '张师傅',
        role: Role.SALES,
        isActive: false,
      },
      {
        id: 'w1',
        username: 'worker-active',
        displayName: '张师傅',
        role: Role.WORKER,
        isActive: true,
      },
      {
        id: 'w2',
        username: 'worker-retired',
        displayName: '老师傅',
        role: Role.WORKER,
        isActive: false,
      },
    ]);

    await expect(getOrderListFilterOptions(adminActor)).resolves.toEqual({
      submitters: [
        { id: 'a1', label: '管理员' },
        { id: 's1', label: '张师傅（sales-retired）（已停用）' },
      ],
      workers: [
        { id: 'w1', label: '张师傅（worker-active）' },
        { id: 'w2', label: '老师傅（已停用）' },
      ],
      crafts: [
        { id: 'c1', label: '烫金' },
        { id: 'c2', label: '退役工艺（已停用）' },
      ],
    });
    expect(dbMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      orderBy: [
        { isActive: 'desc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      select: { id: true, name: true, isActive: true },
    });
    expect(dbMock.user.findMany).toHaveBeenCalledWith({
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
      },
    });

    dbMock.user.findMany.mockClear();
    await expect(getOrderListFilterOptions(salesActor)).resolves.toEqual({
      submitters: [],
      workers: [],
      crafts: [
        { id: 'c1', label: '烫金' },
        { id: 'c2', label: '退役工艺（已停用）' },
      ],
    });
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it('keeps all supported sort orders stable', () => {
    expect(orderListOrderBy('createdAt', 'desc')).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(orderListOrderBy('totalAmount', 'asc')).toEqual([
      { effectiveCustomerFee: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(orderListOrderBy('promisedDate', 'asc')).toEqual([
      { promisedDate: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
