import { describe, expect, it } from 'vitest';

import type {
  PrintOrder,
  PrintPackagingGroup,
} from '../../../components/business/order/OrderPrintLayout.types';
import { buildOrderPdfFilename, buildPrintHtml } from '../print-html';

const STUB_QR_SVG = '<svg data-stub-qr="1"></svg>';

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

function renderPrintHtml(order: PrintOrder): Promise<string> {
  return buildPrintHtml(order);
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
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
      '工艺类型',
      '纸张类型',
      '烫金颜色',
      '交货日期',
      '总数量',
      '包装要求',
    ]) {
      expect(html).toContain(`<div class="lbl">${label}</div>`);
    }
    expect(html.match(/class="l[01] miss">未填<\/div>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('数据不完整：');
    expect(html).toContain('交货日期未填');
    expect(html).toContain('包装要求未填');
    expect(html).toContain('图 1 纸张未填');
    expect(html).toContain('图 1 烫金颜色未填');
  });

  it('只输出局部烫金、专版烫金和彩印的业务名称，不泄露内部枚举', async () => {
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
      fixtureOrder({ items, packagingGroups: [] }),
    );

    expect(html).toContain('局部烫金 / 专版烫金 / 彩印');
    expect(html).not.toContain('STOCK_BLANK');
    expect(html).not.toContain('CUSTOM_SINGLE_FLAT_FOIL');
    expect(html).not.toContain('COLOR_PRINT');
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

  it('流程表按工序汇总任务的计划、完成、不良和完成日期', async () => {
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
      '<td class="step">烫金</td><td class="num">5,000</td><td class="num">3,500</td><td class="num">15</td><td>2026-04-24</td><td></td>',
    );
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
