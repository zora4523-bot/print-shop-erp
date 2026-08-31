import { describe, expect, it } from 'vitest';

import type {
  PrintOrder,
  PrintPackagingGroup,
} from '../../../components/business/order/OrderPrintLayout.types';
import { buildOrderPdfFilename, buildPrintHtml } from '../print-html';

const STUB_QR_SVG = '<svg data-stub-qr="1"></svg>';
const TEST_FACTORY_NAME = '佛山测试印刷厂';

type FixtureItem = PrintOrder['items'][number];
type FixtureDesign = FixtureItem['designs'][number];
type FixtureTask = FixtureItem['tasks'][number];

function fixtureDesign(
  overrides: Partial<FixtureDesign> = {},
): FixtureDesign {
  return {
    id: 'design-1',
    fileType: 'IMAGE',
    fileUrl: 'https://cdn.example.com/designs/design-1.png',
    ...overrides,
  };
}

function fixtureTask(overrides: Partial<FixtureTask> = {}): FixtureTask {
  return {
    id: 'task-1',
    craftName: '烫金',
    workerDisplayName: '李师傅',
    plannedQty: 5_000,
    completedQty: 0,
    defectQty: 0,
    completedAt: null,
    taskQrSvg: '<svg data-stub-task-qr="1"></svg>',
    ...overrides,
  };
}

function fixtureItem(overrides: Partial<FixtureItem> = {}): FixtureItem {
  return {
    id: 'item-1',
    sequence: 1,
    name: '鸿运当头',
    pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    artworkVersion: null,
    specification: '大号封90×165',
    paperType: '珠光纸',
    paperWeightGsm: 160,
    quantity: 5_000,
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: false,
    lamination: 'NONE',
    printColors: [],
    printColorsKnown: true,
    isDoubleSided: false,
    isDoubleColor: false,
    craftNames: ['烫金'],
    remark: null,
    designs: [fixtureDesign()],
    tasks: [fixtureTask()],
    ...overrides,
  };
}

function fixturePackagingGroup(
  overrides: Partial<PrintPackagingGroup> = {},
): PrintPackagingGroup {
  return {
    id: 'packaging-1',
    sequence: 1,
    name: null,
    mode: 'SINGLE_STYLE',
    actualBagCount: 500,
    lines: [
      {
        orderItemId: 'item-1',
        orderItemSequence: 1,
        unitsPerBag: 10,
      },
    ],
    ...overrides,
  };
}

function fixtureOrder(overrides: Partial<PrintOrder> = {}): PrintOrder {
  return {
    id: 'order-abc',
    orderNo: 'GD-260423-001',
    customName: '春节礼盒',
    kind: 'NORMAL',
    sourceOrderNo: null,
    isUrgent: false,
    isSfCollect: false,
    promisedDate: new Date('2026-04-30T00:00:00+08:00'),
    customerName: '福明实业',
    customerRef: '福明',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '佛山市南海区某街道 1 号',
    expressCode: '[6014]',
    packageRequirement: '10 个一袋',
    remark: null,
    submittedAt: new Date('2026-04-23T02:00:00Z'),
    createdAt: new Date('2026-04-23T01:00:00Z'),
    items: [fixtureItem()],
    packagingGroups: [fixturePackagingGroup()],
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        receiverName: '张三',
        receiverPhone: '13800000000',
        receiverAddress: '佛山市南海区某街道 1 号',
        expressCode: '[6014]',
        carrierCode: 'ZTO',
        trackingNo: null,
        lines: [
          {
            orderItemSequence: 1,
            orderItemName: '鸿运当头',
            quantity: 5_000,
          },
        ],
      },
    ],
    orderQrSvg: STUB_QR_SVG,
    ...overrides,
  };
}

function fixtureItems(count: number): FixtureItem[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return fixtureItem({
      id: `item-${sequence}`,
      sequence,
      name: `款式 ${sequence}`,
      designs: [
        fixtureDesign({
          id: `design-${sequence}`,
          fileUrl: `https://cdn.example.com/designs/design-${sequence}.png`,
        }),
      ],
      tasks: [
        fixtureTask({
          id: `task-${sequence}`,
        }),
      ],
    });
  });
}

function renderPrintHtml(order: PrintOrder): Promise<string> {
  return buildPrintHtml(order, { factoryName: TEST_FACTORY_NAME });
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function supplementTextByLabel(html: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(
    `<div class="annex-title">${escapedLabel}(?:（\\d+ / \\d+）)?</div><div class="supplement-text">([\\s\\S]*?)</div>`,
    'g',
  );
  return [...html.matchAll(matcher)].map((match) => match[1] ?? '').join('');
}

describe('buildPrintHtml', () => {
  it('生成完整 HTML，并安全输出工单号标题', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({ orderNo: 'GD-260423-001<script>' }),
    );

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toMatch(/<meta charset="utf-8"\s*\/>/);
    expect(html).toContain(
      '<title>工单 GD-260423-001&lt;script&gt;</title>',
    );
    expect(html).not.toContain('<title>工单 GD-260423-001<script>');
    expect(html).toMatch(/<\/body>\s*<\/html>$/);
    expect(html).toContain(`<div class="factory">${TEST_FACTORY_NAME}</div>`);
  });

  it('客户名与工单名分开展示', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        customerName: '福明实业',
        customerRef: '福明别名',
        customName: '春节礼盒工单',
      }),
    );

    expect(html).toContain('<div class="cust">福明实业</div>');
    expect(html).toContain('工单 <b>春节礼盒工单</b>');
    expect(html).not.toContain('福明别名');
  });

  it('固定保留六个焦点格，缺失事实显示红色“未填”并进入审核告警', async () => {
    const incompleteItem = fixtureItem({
      paperType: null,
      paperWeightGsm: null,
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
    });
    const html = await renderPrintHtml(
      fixtureOrder({
        promisedDate: null,
        packageRequirement: null,
        items: [incompleteItem],
      }),
    );

    expect(html.match(/<div class="fact">/g)).toHaveLength(6);
    for (const label of [
      '生产工艺',
      '纸张类型',
      '烫金工艺',
      '交货日期',
      '总数量',
      '包装要求',
    ]) {
      expect(html).toContain(`<div class="lbl">${label}</div>`);
    }
    expect(html.match(/class="l[01] miss">未填<\/div>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('数据不完整：');
    expect(html).toContain('交货日期未填');
    expect(html).toContain('包装要求未填');
    expect(html).toContain('图 1 纸张未填');
    expect(html).toContain('图 1 烫金颜色未填');
  });

  it('生产工艺只来自任务或工艺事实，不把客户计价路线冒充工序', async () => {
    const items = [
      fixtureItem({
        id: 'item-local',
        sequence: 1,
        name: '局部款',
        pricingRoute: 'STOCK_BLANK',
        tasks: [],
      }),
      fixtureItem({
        id: 'item-custom',
        sequence: 2,
        name: '专版款',
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
        tasks: [],
      }),
      fixtureItem({
        id: 'item-color',
        sequence: 3,
        name: '彩印款',
        pricingRoute: 'COLOR_PRINT',
        frontFoilColors: [],
        foilColors: [],
        craftNames: ['彩印'],
        tasks: [],
      }),
    ];
    const html = await renderPrintHtml(
      fixtureOrder({ items, packagingGroups: [] }),
    );

    expect(html).toContain('烫金 / 彩印');
    expect(html).not.toContain('局部烫金 / 专版烫金 / 彩印');
    expect(html).not.toContain('STOCK_BLANK');
    expect(html).not.toContain('CUSTOM_SINGLE_FLAT_FOIL');
    expect(html).not.toContain('COLOR_PRINT');
  });

  it('彩印加烫金完整打印彩色、覆膜、烫金方式与正反面事实', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [
          fixtureItem({
            pricingRoute: 'COLOR_PRINT',
            craftNames: [],
            tasks: [],
            printColors: ['C', 'M', 'Y', 'K'],
            printColorsKnown: true,
            lamination: 'SOFT_TOUCH',
            foilTechnique: 'RELIEF',
            hasLocalFoil: true,
            frontFoilColors: ['哑金'],
            backFoilColors: ['红金'],
            foilColors: [],
          }),
        ],
      }),
    );

    expect(visibleText(html)).toContain('彩印 C、M、Y、K · 触感膜');
    expect(visibleText(html)).toContain('局部浮雕 · 正面 哑金 / 反面 红金');
    expect(visibleText(html)).not.toContain('不烫金');
    expect(visibleText(html)).toContain('彩印');
    expect(visibleText(html)).toContain('覆膜');
    expect(visibleText(html)).toContain('局部烫金');
  });

  it('非彩印款式不打印否定式彩印与覆膜文案', async () => {
    const html = await renderPrintHtml(fixtureOrder());

    expect(visibleText(html)).not.toContain('不彩印');
    expect(visibleText(html)).not.toContain('不覆膜');
  });

  it('无任务且无明确工艺事实时显示待确认，不用彩印计价路线推测工序', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [
          fixtureItem({
            pricingRoute: 'COLOR_PRINT',
            craftNames: [],
            tasks: [],
            printColors: [],
            printColorsKnown: false,
            lamination: 'NONE',
            foilTechnique: 'UNSPECIFIED',
            hasLocalFoil: null,
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: [],
          }),
        ],
      }),
    );

    expect(visibleText(html)).toContain('工序待确认');
    expect(visibleText(html)).toContain('图 1 生产工艺待确认');
    expect(visibleText(html)).not.toContain('彩印颜色待确认');
  });

  it('使用真实图片 URL，不显示内部文件名，图稿标题始终来自款式名', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [
          fixtureItem({
            name: '鸿运当头',
            designs: [
              fixtureDesign({
                fileUrl:
                  'https://cdn.example.com/designs/2026-raw-upload-secret.png',
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain(
      'src="https://cdn.example.com/designs/2026-raw-upload-secret.png"',
    );
    expect(visibleText(html)).not.toContain('2026-raw-upload-secret.png');
    expect(html).toContain('<span class="txt">鸿运当头</span>');
    expect(html.match(/鸿运当头/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('按包装组显示每袋数量，合计真实袋数', async () => {
    const items = [
      fixtureItem({ id: 'item-1', sequence: 1, quantity: 1_000 }),
      fixtureItem({
        id: 'item-2',
        sequence: 2,
        name: '福满人间',
        quantity: 1_000,
        designs: [fixtureDesign({ id: 'design-2' })],
      }),
    ];
    const packagingGroups = [
      fixturePackagingGroup({
        id: 'packaging-1',
        sequence: 1,
        actualBagCount: 100,
        lines: [
          { orderItemId: 'item-1', orderItemSequence: 1, unitsPerBag: 10 },
        ],
      }),
      fixturePackagingGroup({
        id: 'packaging-2',
        sequence: 2,
        actualBagCount: 100,
        lines: [
          { orderItemId: 'item-2', orderItemSequence: 2, unitsPerBag: 10 },
        ],
      }),
    ];
    const html = await renderPrintHtml(
      fixtureOrder({ items, packagingGroups }),
    );

    expect(
      html.match(/<td class="num">10<\/td><td class="num">100<\/td>/g),
    ).toHaveLength(2);
    expect(html).toContain(
      '<td colSpan="3">合　计</td><td class="num">2,000</td><td></td><td class="num">200</td>',
    );
    expect(html).toContain(
      '<td class="step">打包</td><td class="num">200 包</td>',
    );
  });

  it('混装组只计一次 actualBagCount，不按款式重复累加', async () => {
    const items = [
      fixtureItem({ id: 'item-1', sequence: 1, quantity: 600 }),
      fixtureItem({
        id: 'item-2',
        sequence: 2,
        name: '福满人间',
        quantity: 600,
        designs: [fixtureDesign({ id: 'design-2' })],
      }),
    ];
    const mixedGroup = fixturePackagingGroup({
      mode: 'MIXED_STYLE',
      actualBagCount: 120,
      lines: [
        { orderItemId: 'item-1', orderItemSequence: 1, unitsPerBag: 5 },
        { orderItemId: 'item-2', orderItemSequence: 2, unitsPerBag: 5 },
      ],
    });
    const html = await renderPrintHtml(
      fixtureOrder({ items, packagingGroups: [mixedGroup] }),
    );

    expect(html.match(/<td class="num">混装<\/td>/g)).toHaveLength(2);
    expect(html).toContain(
      '<td colSpan="3">合　计</td><td class="num">1,200</td><td></td><td class="num">120</td>',
    );
    expect(html).toContain(
      '<td class="step">打包</td><td class="num">120 包</td>',
    );
    expect(html).not.toContain('<td class="num">240</td>');
  });

  it('流程表保留每个任务的数量、师傅和独立报工二维码', async () => {
    const items = [
      fixtureItem({
        tasks: [
          fixtureTask({
            id: 'task-1',
            workerDisplayName: '李师傅',
            plannedQty: 3_000,
            completedQty: 3_000,
            defectQty: 12,
            completedAt: new Date('2026-04-23T08:00:00+08:00'),
          }),
          fixtureTask({
            id: 'task-2',
            workerDisplayName: '王师傅',
            plannedQty: 2_000,
            completedQty: 500,
            defectQty: 3,
            completedAt: new Date('2026-04-24T08:00:00+08:00'),
          }),
        ],
      }),
    ];
    const html = await renderPrintHtml(fixtureOrder({ items }));

    expect(html).toContain('李师傅 / 王师傅');
    expect(html).toContain(
      '<td class="step"><small class="flow-item">图 1 · 鸿运当头</small>烫金<small class="flow-worker">李师傅</small></td><td class="num">3,000</td><td class="num">3,000</td><td class="num">12</td><td>2026-04-23</td>',
    );
    expect(html).toContain(
      '<td class="step"><small class="flow-item">图 1 · 鸿运当头</small>烫金<small class="flow-worker">王师傅</small></td><td class="num">2,000</td><td class="num">500</td><td class="num">3</td><td>2026-04-24</td>',
    );
    expect(html).toContain(
      'aria-label="图 1 · 鸿运当头 烫金 任务报工二维码"',
    );
    expect(html.match(/data-stub-task-qr="1"/g)).toHaveLength(2);
  });

  it('逐款优先打印实际任务，未派工款式继续打印明确计划工序', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        packagingGroups: [],
        items: [
          fixtureItem({
            id: 'item-1',
            sequence: 1,
            name: '已派工款',
            tasks: [fixtureTask({ id: 'task-actual', craftName: '平烫' })],
          }),
          fixtureItem({
            id: 'item-2',
            sequence: 2,
            name: '待派工彩印款',
            craftNames: ['彩印'],
            printColors: ['C', 'M', 'Y', 'K'],
            tasks: [],
          }),
        ],
      }),
    );

    expect(visibleText(html)).toContain('图 1 · 已派工款 平烫 李师傅');
    expect(visibleText(html)).toContain('图 2 · 待派工彩印款 彩印');
    expect(html.match(/data-stub-task-qr="1"/g)).toHaveLength(1);
  });

  it('工序与图稿附页共同计入总页数并连续编号', async () => {
    const tasks = Array.from({ length: 12 }, (_, index) =>
      fixtureTask({ id: `task-${index + 1}` }),
    );
    const designs = Array.from({ length: 9 }, (_, index) =>
      fixtureDesign({ id: `design-${index + 1}` }),
    );
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [fixtureItem({ tasks, designs })],
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?">/g)).toHaveLength(5);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(3);
    expect(html).toContain('<span>1 / 5</span>');
    expect(html).toContain('<span>2 / 5</span>');
    expect(html).toContain('<span>3 / 5</span>');
    expect(html).toContain('<span>4 / 5</span>');
    expect(html).toContain('<span>5 / 5</span>');
  });

  it('20 款工单确定拆分待补充、款式、图稿与工序附页', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: fixtureItems(20),
        packagingGroups: [],
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?">/g)).toHaveLength(10);
    expect(html.match(/<section class="sec warning-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(4);
    expect(html.match(/<tr><td><span class="badge">/g)).toHaveLength(20);
    expect(html.match(/class="thumb"/g)).toHaveLength(20);
    expect(html.match(/data-stub-task-qr="1"/g)).toHaveLength(20);
    expect(html).toContain('<span>1 / 10</span>');
    expect(html).toContain('<span>10 / 10</span>');
  });

  it('50 款边界不依赖 CSS 自动跨页，声明页数覆盖全部内容', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: fixtureItems(50),
        packagingGroups: [],
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?">/g)).toHaveLength(23);
    expect(html.match(/<section class="sec warning-annex">/g)).toHaveLength(3);
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(4);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(5);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(10);
    expect(html.match(/<tr><td><span class="badge">/g)).toHaveLength(50);
    expect(html.match(/class="thumb"/g)).toHaveLength(50);
    expect(html.match(/data-stub-task-qr="1"/g)).toHaveLength(50);
    expect(html.match(/<tfoot>/g)).toHaveLength(1);
    expect(html).toContain('<span>1 / 23</span>');
    expect(html).toContain('<span>23 / 23</span>');
  });

  it('显式换行备注与 50 个长姓名师傅只在有界页眉预览，全文确定性续页', async () => {
    const workerNames = Array.from({ length: 50 }, (_, index) => {
      const sequence = String(index + 1).padStart(2, '0');
      return `师傅${sequence}${'长'.repeat(60)}`;
    });
    const team = workerNames.join(' / ');
    const customerName = '客'.repeat(128);
    const customName = '单'.repeat(100);
    const remark = Array.from({ length: 500 }, () => '备').join('\n');
    const html = await renderPrintHtml(
      fixtureOrder({
        customerName,
        customName,
        remark,
        items: [
          fixtureItem({
            tasks: workerNames.map((workerDisplayName, index) =>
              fixtureTask({
                id: `task-${String(index + 1).padStart(2, '0')}`,
                workerDisplayName,
              }),
            ),
          }),
        ],
      }),
    );

    const sheetCount =
      html.match(/<article class="sheet(?: dense)?">/g)?.length ?? 0;
    expect(sheetCount).toBeGreaterThan(50);
    expect(html.match(/<div class="cust">客{16}…<\/div>/g)).toHaveLength(
      sheetCount,
    );
    expect(html).not.toContain(`<div class="cust">${customerName}</div>`);
    expect(html.match(/<div class="l1 note">[\s\S]*?<\/div>/)?.[0]).not.toContain(
      '\n',
    );
    expect(supplementTextByLabel(html, '客户')).toBe(customerName);
    expect(supplementTextByLabel(html, '生产团队')).toBe(team);
    expect(supplementTextByLabel(html, '工单名称')).toBe(customName);
    expect(supplementTextByLabel(html, '备注')).toBe(remark);
    expect(html).toContain(`<span>1 / ${sheetCount}</span>`);
    expect(html).toContain(`<span>${sheetCount} / ${sheetCount}</span>`);
  });

  it('8 款、8 图、临界包装备注与双长地址使用密集主页和显式附页', async () => {
    const items = fixtureItems(8);
    const longAddress = '址'.repeat(120);
    const html = await renderPrintHtml(
      fixtureOrder({
        packageRequirement: '包'.repeat(36),
        remark: '备'.repeat(120),
        items,
        packagingGroups: [],
        shipments: [1, 2].map((sequence) => ({
          id: `shipment-${sequence}`,
          sequence,
          receiverName: `收件人 ${sequence}`,
          receiverPhone: '13800000000',
          receiverAddress: longAddress,
          expressCode: 'SF',
          carrierCode: 'SF',
          trackingNo: null,
          lines: [],
        })),
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?">/g)).toHaveLength(9);
    expect(html).toContain('<article class="sheet dense">');
    expect(html.match(/<section class="sec warning-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec supplement-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec shipment-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(2);
    expect(html).toContain('<span>1 / 9</span>');
    expect(html).toContain('<span>9 / 9</span>');
  });

  it('物流区展示承运商中文名称，不把内部代码印给车间', async () => {
    const html = await renderPrintHtml(fixtureOrder());

    expect(html).toContain(
      '<div class="who"><b>张三</b> · 13800000000 · 中通 · [6014]</div>',
    );
    expect(html).not.toContain('ZTO');
  });

  it('加急与重做使用红色描边标签，不恢复旧版实底横幅', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        isUrgent: true,
        kind: 'REWORK',
        sourceOrderNo: 'GD-260730-001',
      }),
    );

    expect(html).toContain('<span class="tag">加急</span>');
    expect(html).toContain(
      '<span class="tag">重做 · GD-260730-001</span>',
    );
    expect(html).not.toContain('urgent-banner');
    expect(html).not.toContain('rework-banner');
  });

  it('生产工单不暴露任何对客或内部价格信息', async () => {
    const html = await renderPrintHtml(fixtureOrder());

    for (const forbidden of [
      '单价',
      '价格',
      '金额',
      '小计',
      '总价',
      '应收',
      '应付',
      '¥',
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('坏图保留占位框并内置超时降级与 print-ready 信号', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [
          fixtureItem({
            designs: [
              fixtureDesign({
                fileUrl: 'https://invalid.example.test/design-404.png',
              }),
            ],
          }),
        ],
      }),
    );

    expect(html).toContain('<span class="art-placeholder">图稿加载失败</span>');
    expect(html).toContain('data-print-artwork="true"');
    expect(html).toMatch(/class="warn image-load-warning" hidden/);
    expect(html).toContain("thumb.classList.add('image-failed')");
    expect(html).toContain('figures.slice(0, 6)');
    expect(html).toContain("' 等，共 ' + figures.length + ' 款'");
    expect(html).toContain('setTimeout(() => finish(true), 8000)');
    expect(html).toContain("root.dataset.printReady = 'true'");
    expect(html).toContain("window.dispatchEvent(new Event('print-ready'))");
    expect(html).toContain('aspect-ratio:3/4');
    expect(html).toContain('print-color-adjust:exact');
  });
});

describe('buildOrderPdfFilename', () => {
  it('使用工单号和真实客户名', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({
          orderNo: 'GD-260827-001',
          customerName: '福明实业',
        }),
      ),
    ).toBe('GD-260827-001_福明实业.pdf');
  });

  it('客户名缺失时只使用工单号', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({ orderNo: 'GD-260827-001', customerName: '   ' }),
      ),
    ).toBe('GD-260827-001.pdf');
  });

  it('移除路径、控制字符与文件系统保留字符', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({
          orderNo: '../GD-001\r\n\u202e',
          customerName: '客户/甲:*?<>|\\.\u2066 ',
        }),
      ),
    ).toBe('GD-001_客户 甲.pdf');
  });
});
