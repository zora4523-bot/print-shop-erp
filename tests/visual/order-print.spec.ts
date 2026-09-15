import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import qrcode from 'qrcode';
import { buildQrSvg } from '../../lib/order/qr';
import type { PrintOrder } from '../../lib/order/print-types';
import {
  cleanupPrintableOrderStressFixture,
  login,
  E2E_PASSWORD,
  E2E_USERS,
  getUserIdByUsername,
  seedPrintableOrder,
} from '../e2e/_helpers';

// Production work-order visual regression. The committed screenshots cover
// each artwork density used by the print layout, including the annex boundary.
// seedPrintableOrder keeps IDs, QR content, dates, and inline artwork stable.

const ARTWORK_COUNTS = [1, 2, 3, 5, 8, 10] as const;
const browserErrors = new WeakMap<Page, string[]>();
const pdfSequence = new WeakMap<Page, number>();

test.beforeAll(async () => {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('打印视觉回归须使用独立 E2E_DATABASE_URL，不能写入日常开发数据库');
  }
  // Also removes residue left by a previously interrupted local run.
  await cleanupPrintableOrderStressFixture();
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  try {
    expect(browserErrors.get(page), '打印页不应产生浏览器错误').toEqual([]);
  } finally {
    await cleanupPrintableOrderStressFixture();
  }
});

async function waitForPrintReady(page: Page, sheetCount?: number) {
  await expect(page.locator('html[data-print-fonts="ready"]')).toHaveCount(1);
  await expect(page.locator('html[data-print-ready="true"]')).toHaveCount(1);
  await expect(page.locator('html[data-print-pagination="ready"]')).toHaveCount(1);
  await expect(page.locator('.work-order-document')).toBeVisible();
  if (sheetCount !== undefined) {
    await expect(page.locator('.work-order-document > .sheet')).toHaveCount(
      sheetCount,
    );
  }
  await expect(
    page.getByRole('button', { name: 'Open issues overlay' }),
  ).toHaveCount(0);
  // Next's development toolbar is outside the application, but its fixed host
  // can bleed into a tall element screenshot while Playwright scroll-stitches.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
}

async function renderPdfPageCount(page: Page): Promise<number> {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const sequence = (pdfSequence.get(page) ?? 0) + 1;
  pdfSequence.set(page, sequence);
  const output = test.info().outputPath(`production-print-${sequence}.pdf`);
  writeFileSync(output, pdf);
  await test.info().attach('production-print.pdf', { path: output, contentType: 'application/pdf' });
  await page.emulateMedia({ media: 'screen' });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

async function expectDeclaredPagination(page: Page) {
  const sheetCount = await page.locator('.work-order-document > .sheet').count();
  await expect(page.locator('.ft span:last-child')).toHaveText(
    Array.from({ length: sheetCount }, (_, index) => `${index + 1} / ${sheetCount}`),
  );
  await expectEverySheetFitsOneA4Page(page);
  expect(await renderPdfPageCount(page), '物理 PDF 页数应等于页脚声明数，不能产生额外空页').toBe(sheetCount);
}

async function expectSingleOrderQrPerSheet(page: Page) {
  await expect(page.locator('.task-qr')).toHaveCount(0);
  const counts = await page.locator('.sheet').evaluateAll((sheets) =>
    sheets.map((sheet) => sheet.querySelectorAll('.scan .qr svg').length),
  );
  expect(counts.every((count) => count === 1), '每张主工单纸张只保留一个入口二维码').toBe(true);
}

/** Checks the rendered SVG's exact encoded modules and physical print size. */
async function expectQrPayload(page: Page, selector: string, payload: string | string[]) {
  const payloads = Array.isArray(payload) ? payload : [payload];
  const expected = payloads.map((value) => qrcode.create(value, { errorCorrectionLevel: 'Q' }).modules);
  const results = await page.locator(selector).evaluateAll(async (svgs, expectedMatrices) => {
    return Promise.all(svgs.map(async (element) => {
      const svg = element as SVGSVGElement;
      const rendered = svg.getBoundingClientRect();
      const modules = svg.viewBox.baseVal.width;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(modules));
      clone.setAttribute('height', String(modules));
      const canvas = document.createElement('canvas');
      canvas.width = modules; canvas.height = modules;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const source = new Image();
      source.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      await source.decode(); context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, modules, modules).data;
      const matchedIndex = expectedMatrices.findIndex((expectedMatrix) => {
        if (modules !== expectedMatrix.size + 8) return false;
        for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) {
          const border = x < 4 || y < 4 || x >= modules - 4 || y >= modules - 4;
          const expectedDark = !border && expectedMatrix.data[(y - 4) * expectedMatrix.size + x - 4] === 1;
          const offset = (y * modules + x) * 4;
          const actualDark = pixels[offset + 3]! > 127 && pixels[offset]! < 128;
          if (expectedDark !== actualDark) return false;
        }
        return true;
      });
      return { matchedIndex, moduleMm: Math.min(rendered.width, rendered.height) / modules * 25.4 / 96 };
    }));
  }, expected.map((matrix) => ({ size: matrix.size, data: Array.from(matrix.data) })));
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.matchedIndex, '二维码编码必须完整保留原始工单/工序 URL 和四模块静区').toBeGreaterThanOrEqual(0);
    expect(result.moduleMm, 'A4 打印每个二维码模块至少 0.5mm').toBeGreaterThanOrEqual(0.5);
  }
  if (Array.isArray(payload)) {
    expect(results.map((result) => result.matchedIndex).sort((a, b) => a - b), '每个工序 URL 应恰好出现一次，不因分页丢失或重复').toEqual(payload.map((_, index) => index));
  }
}

async function addRealisticSmallOrderContext(orderId: string, itemCount: number) {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1' || !/^e2e-vr-large-items-[24]-1-v2$/.test(orderId)) {
    throw new Error('只允许补充本次隔离打印夹具');
  }
  const orderNo = `E2E-DASH-fb9ddbe2000a64d3-SUB-${itemCount}-PRINT-REGRESSION`;
  const address = '广东省佛山市南海区桂城街道工业大道 188 号 3 栋 2 楼收货仓';
  const remark = '正反面按最终设计图对版，混装按包装组执行。\n出货前核对款号、数量和收货电话。';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE "Order" SET "orderNo"=$2, remark=$3, "packageRequirement"=$4 WHERE id=$1', [orderId, orderNo, remark, '按包装组混装，袋口封牢']);
    await client.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,name,mode,"actualBagCount","unitPrice",subtotal,"createdAt","updatedAt") VALUES ($1,$2,1,'组合 1 · 按款配齐','MIXED_STYLE',1000,0,0,NOW(),NOW())`, [`${orderId}-group`, orderId]);
    await client.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress",status,"createdAt","updatedAt") VALUES ($1,$2,1,'视觉回归收货人','13800138000',$3,'PLANNED',NOW(),NOW())`, [`${orderId}-shipment`, orderId, address]);
    for (let index = 1; index <= itemCount; index++) {
      const itemId = `${orderId}-item-${index}`;
      const artwork = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="165"><rect width="90" height="165" fill="#ad1022"/><text x="45" y="80" text-anchor="middle" fill="#e3bd6f" font-size="18">${index}</text></svg>`).toString('base64')}`;
      await client.query('UPDATE "OrderItemDesign" SET "fileUrl"=$2,"thumbnailUrl"=$2 WHERE "orderItemId"=$1', [itemId, artwork]);
      await client.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,$5)`, [`${orderId}-group-line-${index}`, orderId, `${orderId}-group`, itemId, index + 4]);
      await client.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,$4)`, [`${orderId}-shipment-line-${index}`, `${orderId}-shipment`, itemId, (index + 4) * 1000]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { await client.end(); }
  return { orderNo, address, remark };
}

async function standaloneOrderFixture(): Promise<PrintOrder> {
  const orderNo = 'E2E-DASH-fb9ddbe2000a64d3-SUB-3-URGENT';
  const base = `https://print-regression.example.com/wo/${orderNo}?v=3`;
  const items: PrintOrder['items'] = Array.from({ length: 4 }, (_, index) => ({
    id: `standalone-item-${index + 1}`,
    sequence: index + 1,
    name: `新春平安封 ${index + 1}`,
    pricingRoute: 'STOCK_BLANK',
    specification: '大号封 90×165',
    paperType: '珠光纸',
    paperWeightGsm: 160,
    quantity: 1000,
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'NONE',
    printColors: [],
    printColorsKnown: true,
    isDoubleSided: false,
    isDoubleColor: false,
    craftNames: ['局部烫金'],
    designs: [{
      id: `standalone-design-${index + 1}`,
      fileType: 'IMAGE',
      fileUrl: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="165"><rect width="90" height="165" fill="#ad1022"/><text x="45" y="80" text-anchor="middle" fill="#e3bd6f" font-size="18">${index + 1}</text></svg>`).toString('base64')}`,
    }],
  }));
  const productionSteps: PrintOrder['productionSteps'] = Array.from({ length: 5 }, (_, index) => ({
      id: `operation-${index + 1}-${'long-operation-identifier-'.repeat(4)}`,
      source: 'OPERATION' as const,
      itemSequence: index < 4 ? index + 1 : null,
      itemName: index < 4 ? items[index]!.name : null,
      scopeLabel: index < 4 ? `图 ${index + 1}` : '包装组 1 · 图 1、2、3、4',
      quantityUnit: index < 4 ? '个' as const : '袋' as const,
      craftName: index < 4 ? '局部烫金' : '打包',
      plannedQty: index < 4 ? 1000 : 500,
      completedQty: 0,
      defectQty: 0,
    }));
  return {
    id: 'standalone-order', orderNo, workOrderVersion: 3, customName: '新春平安封四款',
    kind: 'NORMAL', status: 'RELEASED', hasPendingChange: false, isUrgent: true, isSfCollect: false,
    promisedDate: new Date('2026-09-10T00:00:00+08:00'),
    customerName: '视觉回归客户', customerRef: '视觉回归',
    packageRequirement: '混装每款 2 个，袋口封牢',
    remark: '正反面按最终设计图对版。\n出货前核对款号、数量和收货电话。',
    createdAt: new Date('2026-09-08T00:00:00+08:00'),
    items, productionSteps,
    packagingGroups: [{
      id: 'standalone-group', sequence: 1, name: '四款组合', mode: 'MIXED_STYLE', actualBagCount: 500,
      lines: items.map((item) => ({ orderItemId: item.id, orderItemSequence: item.sequence, unitsPerBag: 2 })),
    }],
    shipments: [{
      id: 'standalone-shipment', sequence: 1, receiverName: '视觉回归收货人', receiverPhone: '13800138000',
      receiverAddress: '广东省佛山市南海区桂城街道工业大道 188 号 3 栋 2 楼收货仓',
      lines: items.map((item) => ({ orderItemSequence: item.sequence, orderItemName: item.name, quantity: item.quantity })),
    }],
    orderQrSvg: await buildQrSvg(base, 95, { errorCorrectionLevel: 'Q' }),
  };
}

function buildStandaloneHtml(order: PrintOrder): string {
  // Playwright replaces JSX with component placeholders. Plain Node/tsx keeps
  // this regression on real React SSR and the actual serialized paginator.
  // The standalone document embeds ~8 MiB of WOFF2 fonts as base64.
  return execFileSync(process.execPath, ['--import', 'tsx', '-e', `
    const { readFileSync } = require('node:fs');
    const { buildPrintHtml } = require('./lib/order/print-html.tsx');
    const { order } = JSON.parse(readFileSync(0, 'utf8'));
    order.createdAt = new Date(order.createdAt);
    order.promisedDate = new Date(order.promisedDate);
    buildPrintHtml(order, { factoryName: '佛山印刷厂' }).then((html) => process.stdout.write(html));
  `], { input: JSON.stringify({ order }), encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
}

async function expectEverySheetFitsOneA4Page(page: Page) {
  const measurements = await page.locator('.sheet').evaluateAll((sheets) =>
    sheets.map((sheet) => ({
      clientHeight: sheet.clientHeight,
      scrollHeight: sheet.scrollHeight,
      renderedHeight: sheet.getBoundingClientRect().height,
    })),
  );
  for (const [index, measurement] of measurements.entries()) {
    expect(
      measurement.scrollHeight,
      `第 ${index + 1} 张模板页不应有隐藏溢出`,
    ).toBeLessThanOrEqual(
      measurement.clientHeight + 1,
    );
    // Chromium maps 297mm to roughly 1122.52 CSS px. A page that grows past
    // this boundary would make the browser add a physical page behind the
    // template's declared footer count.
    expect(
      measurement.renderedHeight,
      `第 ${index + 1} 张模板页不应超过 A4 高度`,
    ).toBeLessThanOrEqual(1124);
  }
}

async function readSupplementText(page: Page, label: string): Promise<string> {
  return page.locator('.supplement-annex').evaluateAll(
    (sections, targetLabel) =>
      sections
        .filter((section) =>
          section
            .querySelector('.annex-title')
            ?.textContent?.startsWith(targetLabel),
        )
        .map(
          (section) =>
            section.querySelector('.supplement-text')?.textContent ?? '',
        )
        .join(''),
    label,
  );
}

function textPreview(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  return characters.length <= maxCharacters
    ? value
    : `${characters.slice(0, maxCharacters).join('')}…`;
}

test.describe('OrderPrintLayout 截图回归', () => {
  test('长测试编号不会挤压页眉或增加单款页数', async ({ page }) => {
    const order = await standaloneOrderFixture();
    order.orderNo = 'e2e-sales-status-3a45a04f-1ee6-4340-bd40-6de653334496-42828677-155d-405a-a2fc-d57dd57db6ef';
    order.customName = order.orderNo;
    order.items = order.items.slice(0, 1);
    order.productionSteps = [];
    order.packagingGroups = [];
    order.remark = null;
    order.shipments = [];
    await page.setContent(buildStandaloneHtml(order));
    await waitForPrintReady(page, 1);
    await expect(page.locator('.scan .no')).toContainText(order.orderNo);
    const headerWidth = await page.locator('.hd-main').evaluate((node) => node.getBoundingClientRect().width);
    expect(headerWidth).toBeGreaterThan(300);
    await expectDeclaredPagination(page);
  });

  for (const nameLength of [19, 50, 73, 100]) {
    test(`${nameLength} 字工单名称在页眉完整换行且只生成一页 PDF`, async ({ page }) => {
      const order = await standaloneOrderFixture();
      order.customName = '新春红包' + '客户定制款'.repeat(20).slice(0, nameLength - 4);
      await page.setContent(buildStandaloneHtml(order));
      await waitForPrintReady(page, 1);
      await expect(page.locator('.order-name')).toContainText(order.customName);
      await expect(page.locator('.hd .line')).toContainText('已下发');
      await expect(page.locator('.hd .line')).not.toContainText('待审批');
      await expect(page.locator('.work-order-document')).not.toContainText('生产团队待排产');
      expect(await readSupplementText(page, '工单名称')).toBe('');
      await expectDeclaredPagination(page);
    });
  }

  test('待审批只依据真实变更标记，已下发工单无师傅仍可正常打印', async ({ page }) => {
    const order = await standaloneOrderFixture();
    order.hasPendingChange = true;
    await page.setContent(buildStandaloneHtml(order));
    await waitForPrintReady(page, 1);
    await expect(page.locator('.hd .line')).toContainText('已下发');
    await expect(page.locator('.hd .line')).toContainText('变更待审批');
    await expect(page.locator('.work-order-document')).not.toContainText('待排产');
    await expectDeclaredPagination(page);
  });

  test('自动打印等待图稿和分页完成后只触发一次', async ({ page }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({ submitterId: adminId, designCount: 1 });
    await page.addInitScript(() => {
      window.print = () => {
        const html = document.documentElement;
        html.dataset.printInvocationCount = String(Number(html.dataset.printInvocationCount ?? 0) + 1);
        html.dataset.printInvocationReady = `${html.dataset.printReady}:${html.dataset.printPagination}`;
      };
    });
    await login(page, {
      from: `/print/orders/${orderId}?autoprint=1`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await waitForPrintReady(page, 1);
    await expect(page.locator('html')).toHaveAttribute('data-print-invocation-count', '1');
    await expect(page.locator('html')).toHaveAttribute('data-print-invocation-ready', 'true:ready');
    await expectDeclaredPagination(page);
    await expect(page.locator('html')).toHaveAttribute('data-print-invocation-count', '1');
  });

  for (const mode of ['UNPACKED', 'BOX_RED_CARD', 'BOX_TACTILE'] as const) {
    test(`${mode} 单款工单打印一页，包装类型与数量正确`, async ({ page }) => {
      const order = await standaloneOrderFixture();
      order.items = [{...order.items[0]!, quantity: 101}];
      order.customName = '春节红包';
      order.packageRequirement = null;
      const units = mode === 'BOX_TACTILE' ? 8 : 10;
      const count = mode === 'UNPACKED' ? 0 : Math.ceil(101 / units);
      order.packagingGroups = [{
        id: 'packaging', sequence: 1, name: null, mode, actualBagCount: count,
        lines: [{orderItemId: order.items[0]!.id, orderItemSequence: 1, unitsPerBag: units}],
      }];
      order.shipments[0]!.lines = [{orderItemSequence: 1, orderItemName: order.items[0]!.name, quantity: 101}];
      order.productionSteps = [{...order.productionSteps[0]!, plannedQty: 101}];
      if (mode !== 'UNPACKED') order.productionSteps.push({
        ...order.productionSteps[0]!, id: 'packing', itemSequence: null, itemName: null,
        scopeLabel: '包装组 1 · 图 1', craftName: '打包', plannedQty: count, quantityUnit: '盒',
      });
      await page.setContent(buildStandaloneHtml(order));
      await waitForPrintReady(page, 1);
      await expect(page.locator('.items')).toContainText(mode === 'UNPACKED' ? '不包装' : `${count}盒`);
      await expect(page.locator('.work-order-document')).not.toContainText('包装数量未填');
      await expectDeclaredPagination(page);
      await page.locator('.work-order-document').screenshot({path: test.info().outputPath(`${mode}.png`)});
    });
  }

  test('standalone HTML 真实执行分页脚本并保留一个主码和完整工序', async ({ page }) => {
    const order = await standaloneOrderFixture();
    const base = `https://print-regression.example.com/wo/${order.orderNo}?v=3`;
    await page.setContent(buildStandaloneHtml(order));
    await waitForPrintReady(page, 1);
    await expectQrPayload(page, '.scan .qr svg', base);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(5);
    await expectSingleOrderQrPerSheet(page);
    await expect(page.locator('.items tbody > tr')).toHaveCount(4);
    await expect(page.locator('.ship-list')).toContainText(order.shipments[0]!.receiverAddress!);
    await expect(page.locator('.art .thumb')).toHaveCount(4);
    const packingRow = page.locator('.flow tbody > tr').filter({ hasText: '包装组 1 · 图 1、2、3、4' });
    await expect(packingRow).toHaveCount(1);
    await expect(packingRow).toContainText('500 袋');
    await expectDeclaredPagination(page);
    const screenshot = test.info().outputPath('standalone-order.png');
    await page.locator('.work-order-document').screenshot({ path: screenshot });
    await test.info().attach('standalone-order.png', { path: screenshot, contentType: 'image/png' });
  });

  test('50 款长名称聚合工序保留明细且 PDF 物理页数与页脚一致', async ({ page }) => {
    const order = await standaloneOrderFixture();
    const firstItem = order.items[0]!;
    order.items = Array.from({ length: 50 }, (_, index) => ({ ...firstItem, id: `aggregate-item-${index + 1}`, sequence: index + 1, name: `款${String(index + 1).padStart(2, '0')}${'长'.repeat(61)}`, designs: [] }));
    order.packagingGroups = [];
    order.shipments = [];
    order.productionSteps = [{ ...order.productionSteps[0]!, itemName: null, itemSequence: null, craftName: '专版烫金', scopeLabel: `图 ${order.items.map((item) => item.sequence).join('、')}`, plannedQty: 50_000 }];
    await page.setContent(buildStandaloneHtml(order));
    await waitForPrintReady(page);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(1);
    await expectSingleOrderQrPerSheet(page);
    await expect(page.locator('.items tbody > tr')).toHaveCount(50);
    for (const item of order.items) await expect(page.locator('.items').getByText(item.name, { exact: true })).toHaveCount(1);
    await expect(page.locator('.flow')).toContainText(order.productionSteps[0]!.scopeLabel!);
    await expectDeclaredPagination(page);
  });

  test('单票合法多行长地址完整续页且没有额外空白 PDF 页', async ({ page }) => {
    const order = await standaloneOrderFixture();
    const address = Array.from({ length: 120 }, () => '仓').join('\n');
    order.shipments[0]!.receiverAddress = address;
    const html = buildStandaloneHtml(order);
    await page.setContent(html);
    await waitForPrintReady(page);
    const addresses = await page.locator('.ship-list > .ship > div:last-child').allTextContents();
    expect(addresses.join('')).toBe(address);
    expect(addresses.length).toBeGreaterThan(1);
    const recipients = await page.locator('.ship-list > .ship > div:first-child').allTextContents();
    expect(recipients.every((text) => text.includes('视觉回归收货人') && text.includes('13800138000'))).toBe(true);
    await expectSingleOrderQrPerSheet(page);
    await expectDeclaredPagination(page);
  });
  for (const count of ARTWORK_COUNTS) {
    test(`${count} 张图稿的主页与附页稳定`, async ({ page }) => {
      const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
      const { orderId } = await seedPrintableOrder({
        submitterId: adminId,
        designCount: count,
      });

      await login(page, {
        from: `/print/orders/${orderId}`,
        username: E2E_USERS.owner!.username,
        password: E2E_PASSWORD,
      });
      await expect(page).toHaveURL(`/print/orders/${orderId}`);

      const expectedSheets = count === 10 ? 2 : 1;
      await waitForPrintReady(page, expectedSheets);

      if (count === 10) {
        await expect(page.locator('.sheet').nth(0).locator('.art')).toHaveCount(
          0,
        );
        await expect(
          page.locator('.sheet').nth(1).locator('.artwork-annex .thumb'),
        ).toHaveCount(10);
      } else {
        await expect(page.locator('.sheet .art .thumb')).toHaveCount(count);
        await expect(page.locator('.artwork-annex')).toHaveCount(0);
      }

      await expectSingleOrderQrPerSheet(page);
      await expectDeclaredPagination(page);
      await expect(page.locator('.work-order-document')).toHaveScreenshot(
        `order-print-${count}-designs.png`,
      );
    });
  }

  test('完整工单上下文稳定', async ({ page }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId, customName, itemRemark, foilColors } =
      await seedPrintableOrder({
        submitterId: adminId,
        designCount: 1,
        variant: 'rich-context',
      });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 1);

    await expect(page.locator('.cust')).toHaveText('VR-CUSTOMER');
    await expect(page.locator('.order-name')).toContainText(customName!);
    expect(await readSupplementText(page, '工单名称')).toBe('');
    await expect(page.locator('.hd')).toContainText('已下发');
    await expect(page.locator('.work-order-document')).not.toContainText('生产团队待排产');

    const foilFact = page.locator('.fact').filter({
      has: page.getByText('烫金工艺', { exact: true }),
    });
    await expect(foilFact.locator('.l1')).toContainText(foilColors.join('、'));

    // 新模板只打印工单级备注；该 fixture 只有款式备注，
    // 因此不应恢复旧 item 卡片来把它混入生产工单。
    await expect(page.locator('.remark')).toHaveCount(0);
    await expect(page.getByText(itemRemark!, { exact: true })).toHaveCount(0);

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(1);
    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-rich-context.png',
    );
  });

  for (const itemCount of [2, 4]) {
    test(`${itemCount} 款完整工单仅一页且主二维码可完整编码`, async ({ page }) => {
      const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
      const { orderId } = await seedPrintableOrder({ submitterId: adminId, designCount: 1, variant: 'large-items', itemCount });
      const { orderNo, address, remark } = await addRealisticSmallOrderContext(orderId, itemCount);
      await login(page, { from: `/print/orders/${orderId}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
      await waitForPrintReady(page, 1);
      await expect(page.locator('.items tbody > tr')).toHaveCount(itemCount);
      await expect(page.locator('.art .thumb')).toHaveCount(itemCount);
      await expect(page.locator('.ship-list')).toContainText(address);
      await expect(page.locator('.ship-list')).toContainText('13800138000');
      await expect(page.locator('.items tfoot')).toContainText('1,000');
      await expect(page.locator('.remark')).toContainText(remark.replace('\n', ' '));
      await expectSingleOrderQrPerSheet(page);
      await expectQrPayload(page, '.scan .qr svg', `http://localhost:3000/wo/${orderNo}?v=1`);
      await expectDeclaredPagination(page);
      await expect(page.locator('.work-order-document')).toHaveScreenshot(`order-print-${itemCount}-complete-items.png`);
    });
  }

  for (const taskCount of [1, 6, 12]) {
    test(`${taskCount} 条工序保留主单明细且仅有工单主码`, async ({ page }) => {
      const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
      const { orderId } = await seedPrintableOrder({ submitterId: adminId, designCount: 1, variant: 'task-qr', taskCount });
      await login(page, { from: `/print/orders/${orderId}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
      await waitForPrintReady(page);
      await expectSingleOrderQrPerSheet(page);
      await expect(page.locator('.flow tbody > tr')).toHaveCount(taskCount);
      await expect(page.locator('.flow tbody > tr').first()).toContainText('5,000 个');
      await expect(page.locator('.item-process')).toContainText('彩印 C、M、Y、K · 触感膜');
      await expect(page.locator('.item-process')).toContainText('局部浮雕 · 正面 哑金 / 反面 红金');
      await expectDeclaredPagination(page);

      if (taskCount === 1) {
        const retiredPdf = await page.request.get(`/api/orders/${orderId}/pdf?mode=tasks`);
        expect(retiredPdf.status()).toBe(400);
        const retiredPrint = await page.request.get(`/print/orders/${orderId}?mode=tasks`);
        expect(retiredPrint.status()).toBe(404);
        expect(await retiredPrint.text()).not.toContain('<main class="work-order-document');
      }
      await expect(page.locator('.work-order-document')).toHaveScreenshot(`order-print-main-flow-${taskCount}.png`);
    });
  }

  test('三款工单的款式、多地址与打印分页稳定', async ({ page }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'three-items',
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    await expect(page.locator('.items tbody > tr')).toHaveCount(3);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(3);
    await expectSingleOrderQrPerSheet(page);
    await expect(page.locator('.ship-list > .ship')).toHaveCount(2);
    await expect(page.locator('.ship-list')).toContainText('VR 主地址收件人');
    await expect(page.locator('.ship-list')).toContainText('佛山市测试主地址 88 号');
    await expect(page.locator('.ship-list')).toContainText('VR 分地址收件人');
    await expect(page.locator('.ship-list')).toContainText('广州市测试分地址 99 号');

    const footerPositions = await page
      .locator('.sheet > .ft')
      .evaluateAll((footers) =>
        footers.map((footer) => getComputedStyle(footer).position),
      );
    expect(footerPositions).not.toContain('fixed');

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.work-order-document')).toHaveCSS(
      'print-color-adjust',
      'exact',
    );
    await expectDeclaredPagination(page);
    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-three-items.png',
    );
  });

  test('20 款工单的款式、图稿与工序按物理 A4 页拆分', async ({ page }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 20,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.warning-annex')).toHaveCount(0);
    await expect(page.locator('.item-annex')).toHaveCount(2);
    await expect(
      page.locator('.item-annex').nth(0).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(1).locator('tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.artwork-annex')).toHaveCount(2);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(20);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(20);

    await expectSingleOrderQrPerSheet(page);
    await expectDeclaredPagination(page);
  });

  test('50 款边界的声明页数与实际 PDF 页数一致', async ({ page }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 50,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.warning-annex')).toHaveCount(0);
    await expect(page.locator('.item-annex')).toHaveCount(4);
    await expect(
      page.locator('.item-annex').nth(0).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(1).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(2).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(3).locator('tbody > tr'),
    ).toHaveCount(10);
    await expect(page.locator('.artwork-annex')).toHaveCount(5);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(50);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(50);

    await expectSingleOrderQrPerSheet(page);
    await expectDeclaredPagination(page);
  });

  test('历史超长名称、最长备注与 10 个地址通过显式续页保持 PDF 页数一致', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 20,
      stressText: true,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    const sheets = page.locator('.work-order-document > .sheet');
    const sheetCount = await sheets.count();
    await expect(page.locator('.supplement-annex')).not.toHaveCount(0);
    await expect(page.locator('.shipment-annex')).toHaveCount(3);
    await expect(page.locator('.ship-list > .ship')).toHaveCount(10);
    await expect(page.locator('.items tbody > tr')).toHaveCount(20);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(20);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(69);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from(
        { length: sheetCount },
        (_, index) => `${index + 1} / ${sheetCount}`,
      ),
    );

    const remark = Array.from({ length: 500 }, () => '备').join('\n');
    const customer = '客'.repeat(128);
    const customName = '单'.repeat(200);

    await expect(page.locator('.cust')).toHaveText(
      Array.from({ length: sheetCount }, () => textPreview(customer, 16)),
    );
    await expect(page.locator('.hd').first()).toContainText('已下发');
    expect(await readSupplementText(page, '客户')).toBe(customer);
    expect(await readSupplementText(page, '生产团队')).toBe('');
    await expect(page.locator('.order-name').first()).toContainText(textPreview(customName, 100));
    expect(await readSupplementText(page, '工单名称')).toBe(customName);
    for (let index = 0; index < 50; index++) {
      const sequence = String(index + 1).padStart(2, '0');
      await expect(page.locator('.flow tbody > tr').filter({ hasText: `工序${sequence}${'长'.repeat(60)}` })).toHaveCount(1);
    }
    expect(await readSupplementText(page, '备注')).toBe(remark);
    expect(
      await page.locator('.sheet').first().locator('.note').textContent(),
    ).not.toContain('\n');

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(sheetCount);
  });

  test('8 款、8 图、临界文本与双长地址不挤破密集主页', async ({
    page,
  }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 8,
      denseBoundary: true,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    await expect(page.locator('.sheet').first()).toHaveClass(/\bdense\b/);
    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.item-annex tbody > tr')).toHaveCount(4);
    await expect(page.locator('.sheet').first().locator('.art')).toHaveCount(0);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(8);
    await expect(page.locator('.shipment-annex')).toHaveCount(1);
    await expect(page.locator('.shipment-annex .ship')).toHaveCount(2);
    await expect(page.locator('.supplement-annex')).toHaveCount(2);


    await expectSingleOrderQrPerSheet(page);
    await expectDeclaredPagination(page);
  });

  test('1 款 1 图因千字多行备注移入附页时仍严格对齐物理 A4', async ({
    page,
  }) => {
    const adminId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 1,
      artworkAnnexBoundary: true,
    });
    const remark = Array.from({ length: 20 }, () => '备'.repeat(50)).join('\n');

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    const sheets = page.locator('.work-order-document > .sheet');
    const sheetCount = await sheets.count();
    await expect(page.locator('.sheet').first().locator('.art')).toHaveCount(0);
    await expect(page.locator('.artwork-annex')).toHaveCount(1);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(1);
    await expect(page.locator('.artwork-annex img')).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml;base64,/,
    );
    const artworkBox = await page.locator('.artwork-annex .box').boundingBox();
    expect(artworkBox).not.toBeNull();
    expect(artworkBox!.width).toBeLessThanOrEqual(455);
    expect(artworkBox!.height).toBeLessThanOrEqual(606);
    expect(await readSupplementText(page, '备注')).toBe(remark);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from(
        { length: sheetCount },
        (_, index) => `${index + 1} / ${sheetCount}`,
      ),
    );

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(sheetCount);
  });

});
