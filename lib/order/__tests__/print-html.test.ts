import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { embeddedPrintFontCss } from '../print-fonts-server';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  PrintOrder,
  PrintPackagingGroup,
} from '../print-types';
import { buildOrderPdfFilename, buildPrintHtml } from '../print-html';
import { OrderPrintLayout } from '../print-layout';

const STUB_QR_SVG = '<svg data-stub-qr="1"></svg>';
const TEST_FACTORY_NAME = '佛山测试印刷厂';

type FixtureItem = PrintOrder['items'][number];
type FixtureDesign = FixtureItem['designs'][number];
type FixtureStep = PrintOrder['productionSteps'][number];

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

function fixtureStep(overrides: Partial<FixtureStep> = {}): FixtureStep {
  return {
    id: 'operation-1',
    source: 'OPERATION',
    itemSequence: 1,
    itemName: '鸿运当头',
    craftName: '烫金',
    plannedQty: 5_000,
    completedQty: 0,
    defectQty: 0,
    completedAt: null,
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
    workOrderVersion: 2,
    status: 'RELEASED',
    hasPendingChange: false,
    customName: '春节礼盒',
    kind: 'NORMAL',
    sourceOrderNo: null,
    isUrgent: false,
    isSfCollect: false,
    promisedDate: new Date('2026-04-30T00:00:00+08:00'),
    externalSalesName: '外销甲',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '佛山市南海区某街道 1 号',
    expressCode: '[6014]',
    packageRequirement: '10 个一袋',
    remark: null,
    submittedAt: new Date('2026-04-23T02:00:00Z'),
    createdAt: new Date('2026-04-23T01:00:00Z'),
    items: [fixtureItem()],
    productionSteps: [
      ...(overrides.items ?? [fixtureItem()]).map((item) => fixtureStep({
        id: `operation-${item.id}`, itemSequence: item.sequence,
        itemName: item.name, plannedQty: item.quantity,
      })),
      ...(overrides.packagingGroups ?? [fixturePackagingGroup()]).map((group) => fixtureStep({
        id: `packing-${group.id}`, itemSequence: null, itemName: null,
        craftName: '打包', quantityUnit: '袋', plannedQty: group.actualBagCount ?? 0,
      })),
    ],
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
  it.each([
    ['UNPACKED', 0, '不包装'],
    ['BOX_RED_CARD', 500, '红卡盒子 230g'],
    ['BOX_TACTILE', 625, '触感盒子 250g'],
  ] as const)('%s prints explicit packaging without a missing-data annex', async (mode, count, label) => {
    const html = await renderPrintHtml(fixtureOrder({
      packageRequirement: null,
      packagingGroups: [fixturePackagingGroup({
        mode,
        actualBagCount: count,
        lines: [{orderItemId: 'item-1', orderItemSequence: 1, unitsPerBag: mode === 'BOX_TACTILE' ? 8 : 10}],
      })],
    }));
    expect(html).toContain(label);
    expect(html).toContain('见包装明细');
    expect(html).not.toContain('包装数量未填');
    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
    if (mode !== 'UNPACKED') expect(html).toContain(`${count}盒`);
  });

  it.each([2, 4])('%i 款普通工单保留两行短备注与图稿，不生成重复备注附页', async (itemCount) => {
    const remark = '正反面按最终设计图对版，混装按包装组执行。\n出货前核对款号、数量和收货电话。';
    const html = await renderPrintHtml(fixtureOrder({
      items: fixtureItems(itemCount),
      remark,
    }));

    expect(html).toContain(`<div class="l1 note">${remark}</div>`);
    expect(supplementTextByLabel(html, '备注')).toBe('');
    expect(html).not.toContain('class="sec artwork-annex"');
    expect(html.match(/class="thumb"/g)).toHaveLength(itemCount);
    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
  });

  it('两款尚无当前工序的主单也使用紧凑布局，为备注和收货信息留足空间', async () => {
    const html = await renderPrintHtml(fixtureOrder({
      orderNo: 'E2E-DASH-fb9ddbe2000a64d3-SUB-2-PRINT-REGRESSION',
      items: fixtureItems(2),
      productionSteps: [],
      remark: '正反面按最终设计图对版，混装按包装组执行。\n出货前核对款号、数量和收货电话。',
    }));
    expect(html).toContain('<article class="sheet dense"');
    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
    expect(html).not.toContain('<td class="step">');
    // 尚未下发生产、没有工序时不留“暂无生产工序记录”占位。
    expect(html).not.toContain('暂无生产工序记录');
    expect(html).not.toContain('class="flow');
    expect(html).not.toContain('class="task-qr"');
    expect(html).toContain('佛山市南海区某街道 1 号');
  });

  it('普通主页保留120字三行备注，超过三行时全文进入有界附页', async () => {
    const threeLines = `${'甲'.repeat(39)}\n${'乙'.repeat(39)}\n${'丙'.repeat(40)}`;
    expect(threeLines).toHaveLength(120);
    const mainHtml = await renderPrintHtml(fixtureOrder({ remark: threeLines }));
    expect(mainHtml).toContain(`<div class="l1 note">${threeLines}</div>`);
    expect(supplementTextByLabel(mainHtml, '备注')).toBe('');

    const fourLines = '第一行\n第二行\n第三行\n第四行';
    const annexHtml = await renderPrintHtml(fixtureOrder({ remark: fourLines }));
    expect(supplementTextByLabel(annexHtml, '备注')).toBe(fourLines);
  });

  it('默认主单用一个主码承载五条工序，并保留完整收货信息', async () => {
    const receiverAddress = '广东省佛山市南海区桂城街道印刷产业园 8 栋 3 楼 302 室';
    const html = await renderPrintHtml(fixtureOrder({
      items: fixtureItems(4),
      productionSteps: Array.from({ length: 5 }, (_, index) => ({
        id: `operation-${index}`,
        source: 'OPERATION',
        craftName: index === 0 ? '局部烫金' : '打包',
        scopeLabel: index === 0 ? '图 1、2、3、4' : `包装组 ${index} · 图 ${index}`,
        quantityUnit: index === 0 ? '个' : '袋',
        plannedQty: index === 0 ? 3_000 : 25,
        completedQty: 0,
        defectQty: 0,
      })),
      shipments: [{ id: 'shipping', sequence: 1, receiverName: '张三', receiverPhone: '13800000000', receiverAddress, lines: [] }],
    }));

    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
    expect(html.match(/data-stub-qr="1"/g)).toHaveLength(1);
    expect(html).not.toContain('data-task-qr="1"');
    expect(html).not.toContain('class="task-qr"');
    expect(html.match(/<td class="step">/g)).toHaveLength(5);
    expect(html).toContain('包装组 4 · 图 4');
    expect(html).toContain('<td class="num">25 袋</td>');
    expect(html).toContain(receiverAddress);
    expect(html).toContain('<span>1 / 1</span>');
  });

  it('工序表和工艺摘要只显示当前生产事实，不追加推测的打包工序', async () => {
    const html = await renderPrintHtml(fixtureOrder({
      productionSteps: [fixtureStep({ craftName: '局部烫金', completedQty: 1200, defectQty: 3 })],
      items: [fixtureItem({ craftNames: ['过期工艺'] })],
    }));
    expect(html).toContain('局部烫金');
    expect(html).not.toContain('过期工艺');
    expect(html.match(/<td class="step">/g)).toHaveLength(1);
    expect(html.match(/data-stub-qr="1"/g)).toHaveLength(1);
  });

  it.each([19, 50, 73, 100])('%i 字工单名称完整换行，不单独生成附页', async (length) => {
    const customName = '名'.repeat(length);
    const html = await renderPrintHtml(fixtureOrder({ customName }));
    expect(html).toContain(`<div class="order-name">工单 <b>${customName}</b></div>`);
    expect(supplementTextByLabel(html, '工单名称')).toBe('');
    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
  });

  it.each([
    ['RELEASED', false, '已下发'],
    ['CONFIRMED', false, '待下发生产'],
    ['ON_HOLD', true, '已暂停'],
  ] as const)('页眉使用真实状态 %s，审批标签只来自待处理变更', async (status, hasPendingChange, label) => {
    const html = await renderPrintHtml(fixtureOrder({ status, hasPendingChange }));
    expect(html).toContain(`状态 <b>${label}</b>`);
    expect(html.includes('<span class="tag">变更待审批</span>')).toBe(hasPendingChange);
    expect(html).not.toContain('待排产');
    expect(html).not.toContain('生产团队');
  });

  it('静态 PDF shell 与浏览器打印共用完全相同的布局 DOM', async () => {
    const order = fixtureOrder();
    const layoutMarkup = renderToStaticMarkup(
      createElement(OrderPrintLayout, {
        order,
        factoryName: TEST_FACTORY_NAME,
        fontCss: await embeddedPrintFontCss(),
      }),
    );

    const html = await renderPrintHtml(order);

    expect(html).toContain(`<body>${layoutMarkup}<script>`);
  });

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

  it('抬头显示外部销售，与工单名分开展示（原“客户”不再打印）', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        externalSalesName: '外销甲',
        customName: '春节礼盒工单',
      }),
    );

    expect(html).toContain('<div class="cust">外销甲</div>');
    expect(html).toContain('工单 <b>春节礼盒工单</b>');
    expect(html).not.toContain('客户未填');
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
    // Only missing paper and delivery date are required facts; the supplement is optional.
    expect(html.match(/class="l[01] miss">未填<\/div>/g)).toHaveLength(2);
    expect(html).toContain('数据不完整：');
    expect(html).toContain('交货日期未填');
    expect(html).not.toContain('包装要求未填');
    expect(html).not.toContain('包装数量未填');
    expect(html).toContain('见分袋明细');
    expect(html).toContain('图 1 纸张未填');
    expect(html).toContain('图 1 烫金颜色未填');
  });

  it('reports missing bag facts even when a packaging supplement is present', async () => {
    const html = await renderPrintHtml(fixtureOrder({
      packagingGroups: [], packageRequirement: '贴客户标签',
    }));
    expect(html).toContain('包装数量未填');
    expect(html).not.toContain('包装要求未填');
  });

  it('生产工艺只来自当前工序或明确工艺事实，不把客户计价路线冒充工序', async () => {
    const items = [
      fixtureItem({
        id: 'item-local',
        sequence: 1,
        name: '局部款',
        pricingRoute: 'STOCK_BLANK',
      }),
      fixtureItem({
        id: 'item-custom',
        sequence: 2,
        name: '专版款',
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
      }),
      fixtureItem({
        id: 'item-color',
        sequence: 3,
        name: '彩印款',
        pricingRoute: 'COLOR_PRINT',
        frontFoilColors: [],
        foilColors: [],
        craftNames: ['彩印'],
      }),
    ];
    const html = await renderPrintHtml(
      fixtureOrder({ items, packagingGroups: [], productionSteps: [] }),
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
        productionSteps: [],
        items: [
          fixtureItem({
            pricingRoute: 'COLOR_PRINT',
            craftNames: [],
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

  it('无当前工序且无明确工艺事实时显示待确认，不用彩印计价路线推测工序', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        productionSteps: [],
        items: [
          fixtureItem({
            pricingRoute: 'COLOR_PRINT',
            craftNames: [],
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

    expect(visibleText(html)).not.toContain('暂无生产工序记录');
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

  it('混用纸张或克重时款名下逐行印纸张与克重，图稿标题与工序行仍只用款名', async () => {
    const html = await renderPrintHtml(fixtureOrder({
      items: [
        fixtureItem({
          name: '福字款',
          pricingRoute: 'STOCK_BLANK',
          paperType: '珠光艳闪',
          hasLocalFoil: true,
        }),
        fixtureItem({
          id: 'item-2',
          sequence: 2,
          name: '招财款',
          pricingRoute: 'COLOR_PRINT',
          paperType: '160g杂色珠光',
          designs: [fixtureDesign({ id: 'design-2' })],
        }),
      ],
      packagingGroups: [],
    }));

    expect(html).toContain(
      '<div>福字款</div><div class="item-material">艳红珠光纸 160g</div><div class="item-process">局部平烫 · 哑金</div>',
    );
    // 克重已写在纸张名里时不重复追加；类型不另印，工艺行已写明。
    expect(html).toContain('<div>招财款</div><div class="item-material">160g杂色珠光纸</div>');
    expect(html.match(/class="item-material"/g)).toHaveLength(2);
    expect(html).not.toContain('局部烫金（通版现货）');
    expect(html).toContain('<span class="txt">福字款</span>');
    expect(html).toContain('<small class="flow-item">图 1 · 福字款</small>');
    expect(html).toContain('<div class="lbl">纸张类型</div>');
  });

  it('全单只用一种纸张时不逐行重复，纸张只看顶部栏；缺纸张的行不单独算一种', async () => {
    const samePaper = await renderPrintHtml(fixtureOrder({
      items: [
        fixtureItem({ name: '福字款', paperType: '珠光艳闪', paperWeightGsm: 160 }),
        fixtureItem({
          id: 'item-2',
          sequence: 2,
          name: '寿字款',
          paperType: '珠光艳闪',
          paperWeightGsm: 160,
          designs: [fixtureDesign({ id: 'design-2' })],
        }),
        fixtureItem({
          id: 'item-3',
          sequence: 3,
          name: '样品',
          pricingRoute: 'MANUAL_QUOTE',
          paperType: '  ',
          paperWeightGsm: null,
          designs: [fixtureDesign({ id: 'design-3' })],
        }),
      ],
      packagingGroups: [],
    }));
    expect(samePaper).not.toContain('class="item-material"');
    expect(samePaper).not.toContain('待管理员终价');

    const sameNameDifferentWeight = await renderPrintHtml(fixtureOrder({
      items: [
        fixtureItem({ name: '红卡款', paperType: '红卡', paperWeightGsm: 250 }),
        fixtureItem({
          id: 'item-2',
          sequence: 2,
          name: '红卡轻款',
          paperType: '红卡',
          paperWeightGsm: 230,
          designs: [fixtureDesign({ id: 'design-2' })],
        }),
      ],
      packagingGroups: [],
    }));
    expect(sameNameDifferentWeight).toContain('<div>红卡款</div><div class="item-material">红卡纸 250g</div>');
    expect(sameNameDifferentWeight).toContain('<div>红卡轻款</div><div class="item-material">红卡纸 230g</div>');
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
    expect(html.match(/<td class="step">打包<\/td><td class="num">100 袋<\/td>/g)).toHaveLength(2);
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
      '<td class="step">打包</td><td class="num">120 袋</td>',
    );
    expect(html).not.toContain('<td class="num">240</td>');
  });

  it('主单保留每个当前工序的数量和完成日期，仅使用工单主码', async () => {
    const html = await renderPrintHtml(fixtureOrder({ productionSteps: [
      fixtureStep({ id: 'operation-1', plannedQty: 3000, completedQty: 3000, defectQty: 12,
        completedAt: new Date('2026-04-23T08:00:00+08:00') }),
      fixtureStep({ id: 'progress-2', source: 'PROGRESS', plannedQty: 2000, completedQty: 500, defectQty: 3,
        completedAt: new Date('2026-04-24T08:00:00+08:00') }),
    ] }));
    expect(html).toContain('<td class="num">3,000</td><td class="num">3,000</td><td class="num">12</td><td>2026-04-23</td>');
    expect(html).toContain('<td class="num">2,000</td><td class="num">500</td><td class="num">3</td><td>2026-04-24</td>');
    expect(html).not.toContain('任务报工二维码');
    expect(html.match(/data-stub-qr="1"/g)).toHaveLength(1);
  });

  it('缺少当前生产工序时不根据款式工艺或包装组制造进度', async () => {
    const html = await renderPrintHtml(fixtureOrder({ productionSteps: [],
      items: [fixtureItem({ craftNames: ['彩印'], printColors: ['C', 'M', 'Y', 'K'] })],
    }));
    expect(html).not.toContain('暂无生产工序记录');
    expect(html).not.toContain('<td class="step">');
    expect(html).toContain('<div class="l0">彩印</div>');
    expect(html).not.toContain('待排产');
  });

  it('首条工序过长进入附页时，主页指向明细而不是误报无记录', async () => {
    const craftName = '长'.repeat(500);
    const html = await renderPrintHtml(fixtureOrder({ productionSteps: [fixtureStep({ craftName })] }));
    expect(html).toContain('工序明细见附页');
    expect(html).not.toContain('暂无生产工序记录');
    expect(html.match(/<td class="step">/g)).toHaveLength(1);
    expect(html).toContain(craftName);
  });

  it('工序与图稿附页共同计入总页数并连续编号', async () => {
    const productionSteps = Array.from({ length: 12 }, (_, index) =>
      fixtureStep({ id: `task-${index + 1}` }),
    );
    const designs = Array.from({ length: 9 }, (_, index) =>
      fixtureDesign({ id: `design-${index + 1}` }),
    );
    const html = await renderPrintHtml(
      fixtureOrder({
        items: [fixtureItem({ designs })],
        productionSteps,
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(3);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(1);
    expect(html).toContain('<span>1 / 3</span>');
    expect(html).toContain('<span>2 / 3</span>');
    expect(html).toContain('<span>3 / 3</span>');
  });

  it('单款缺失超过六项时仍只打印一页，保留缺失提示', async () => {
    const html = await renderPrintHtml(fixtureOrder({
      externalSalesName: '', promisedDate: null, packageRequirement: '',
      packagingGroups: [], productionSteps: [],
      items: [{ ...fixtureItems(1)[0], specification: '', designs: [], foilTechnique: 'FLAT', frontFoilColors: [], backFoilColors: [] }],
    }));
    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(1);
    expect(html).not.toContain('warning-annex');
    expect(html).not.toContain('项见附页');
    expect(html).toContain('外部销售未填');
    expect(html).not.toContain('客户未填');
    expect(html).toContain('缺设计图');
    expect(html).toContain('<span>1 / 1</span>');
  });

  it('20 款工单确定拆分款式、图稿与工序附页', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: fixtureItems(20),
        packagingGroups: [],
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(6);
    expect(html).not.toContain('warning-annex');
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(1);
    expect(html.match(/<tr><td><span class="badge">/g)).toHaveLength(20);
    expect(html.match(/class="thumb"/g)).toHaveLength(20);
    expect(html).not.toContain('data-stub-task-qr="1"');
    expect(html.match(/data-stub-qr="1"/g)).toHaveLength(6);
    expect(html).toContain('<span>1 / 6</span>');
    expect(html).toContain('<span>6 / 6</span>');
  });

  it('50 款边界不依赖 CSS 自动跨页，声明页数覆盖全部内容', async () => {
    const html = await renderPrintHtml(
      fixtureOrder({
        items: fixtureItems(50),
        packagingGroups: [],
      }),
    );

    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(12);
    expect(html).not.toContain('warning-annex');
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(4);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(5);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(2);
    expect(html.match(/<tr><td><span class="badge">/g)).toHaveLength(50);
    expect(html.match(/class="thumb"/g)).toHaveLength(50);
    expect(html).not.toContain('data-stub-task-qr="1"');
    expect(html.match(/data-stub-qr="1"/g)).toHaveLength(12);
    expect(html.match(/<tfoot>/g)).toHaveLength(1);
    expect(html).toContain('<span>1 / 12</span>');
    expect(html).toContain('<span>12 / 12</span>');
  });

  it('显式换行备注、长外部销售名和超长工单名在有界页眉预览，全文确定性续页', async () => {
    const externalSalesName = '销'.repeat(64);
    const customName = '单'.repeat(200);
    const remark = Array.from({ length: 500 }, () => '备').join('\n');
    const html = await renderPrintHtml(fixtureOrder({ externalSalesName, customName, remark }));
    const sheetCount = html.match(/<article class="sheet(?: dense)?"/g)?.length ?? 0;
    expect(sheetCount).toBe(28);
    expect(html.match(/<div class="cust">销{16}…<\/div>/g)).toHaveLength(sheetCount);
    expect(html).not.toContain(`<div class="cust">${externalSalesName}</div>`);
    expect(supplementTextByLabel(html, '外部销售')).toBe(externalSalesName);
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

    expect(html.match(/<article class="sheet(?: dense)?"/g)).toHaveLength(7);
    expect(html).toContain('<article class="sheet dense"');
    expect(html).not.toContain('warning-annex');
    expect(html.match(/<section class="sec supplement-annex">/g)).toHaveLength(2);
    expect(html.match(/<section class="sec item-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec artwork-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec shipment-annex">/g)).toHaveLength(1);
    expect(html.match(/<section class="sec flow-annex">/g)).toHaveLength(1);
    expect(html).toContain('<span>1 / 7</span>');
    expect(html).toContain('<span>7 / 7</span>');
  });

  it('物流区展示承运商中文名称，不把内部代码印给车间', async () => {
    const html = await renderPrintHtml(fixtureOrder());

    expect(html).toContain(
      '<div class="who"><b>张三</b> · 13800000000 · 中通 · [6014]</div>',
    );
    expect(html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, '')).not.toContain('ZTO');
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
  it('使用工单号和外部销售名（与打印抬头一致）', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({
          orderNo: 'GD-260827-001',
          externalSalesName: '外销甲',
        }),
      ),
    ).toBe('GD-260827-001_外销甲.pdf');
  });

  it('外部销售名缺失时只使用工单号', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({ orderNo: 'GD-260827-001', externalSalesName: '   ' }),
      ),
    ).toBe('GD-260827-001.pdf');
  });

  it('移除路径、控制字符与文件系统保留字符', () => {
    expect(
      buildOrderPdfFilename(
        fixtureOrder({
          orderNo: '../GD-001\r\n\u202e',
          externalSalesName: '外销/甲:*?<>|\\.\u2066 ',
        }),
      ),
    ).toBe('GD-001_外销 甲.pdf');
  });
});
