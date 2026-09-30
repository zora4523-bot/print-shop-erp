import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { seedOrderShippingRecoveryFixture } from './order-shipping-recovery-fixture';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
} from '../e2e/_helpers';
import {
  cleanupWorkerUiFixture,
  seedWorkerUiFixture,
  type WorkerUiFixture,
} from './worker-ui-fixture';
import {
  attachCandidateScreenshot,
  expectA11yGate,
  expectViewportGate,
} from './ui-gates';
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
} from '../../lib/navigation/rule-center';

const longOrderName = '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let fixture: WorkerUiFixture;

test.beforeAll(async ({}, testInfo) => {
  fixture = await seedWorkerUiFixture(`admin-${testInfo.project.name}`);
});

test.afterAll(async () => {
  await cleanupWorkerUiFixture(fixture);
});

test.describe('administrator workspace', () => {
  // Each test traverses the complete owner route matrix. Four viewport
  // projects may share one Turbopack development server, so the budget must
  // include cold RSC compilation without weakening any per-route assertion.
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('discoverability entries pass focused light and dark gates', async ({ page }, testInfo) => {
    const routes: AdminRoute[] = [
      { name: 'discovery-purchase-new', path: '/owner/purchases/new', readyHeading: '新建采购单' },
      { name: 'discovery-parties', path: '/owner/parties?type=suppliers', readyHeading: '客户/供应商' },
      { name: 'discovery-boms', path: '/owner/boms', readyHeading: '用料清单' },
      { name: 'discovery-categories', path: '/owner/rules/product-categories', readyHeading: '产品结构分类 / BOM 分类' },
      { name: 'discovery-rules', path: '/owner/rules', readyHeading: '规则配置中心' },
      { name: 'discovery-outsource', path: '/foreman/outsource', readyHeading: '外协单' },
    ];
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('standalone return controls pass focused light and dark gates', async ({ page }, testInfo) => {
    const routes: AdminRoute[] = [
      { name: 'return-empty-dispatch', path: '/orders/production', readyHeading: '安排生产师傅', prepareGateState: async page => {
        await expect(page.getByRole('link', { name: '返回工单列表', exact: true })).toHaveAttribute('href', '/orders');
      } },
      { name: 'return-outsource', path: `/foreman/outsource/new?orderId=${fixture.orderId}`, readyHeading: '新建外协单', prepareGateState: async page => {
        await expect(page.getByRole('link', { name: '返回工单详情', exact: true })).toHaveAttribute('href', `/orders/${fixture.orderId}`);
      } },
      { name: 'return-specifications', path: '/owner/rules/specifications', readyHeading: '规格目录', prepareGateState: async page => {
        await expect(page.getByRole('link', { name: '返回纸张', exact: true })).toHaveAttribute('href', '/owner/rules/papers');
      } },
      { name: 'return-password', path: '/account/password', readyHeading: '修改密码', prepareGateState: async page => {
        await expect(page.getByRole('link', { name: '返回首页', exact: true })).toHaveAttribute('href', '/');
      } },
    ];
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await expect(page).toHaveURL(/\/owner$/);
  });

  test('warehouse maintenance controls pass focused light and dark gates', async ({ page }, testInfo) => {
    const routes: AdminRoute[] = [{ name: 'warehouse-maintenance', path: '/owner/warehouses', readyHeading: '仓库/库位', prepareGateState: async (page) => {
      const disclosure = page.locator('#admin-main').getByText('仓库与库位设置', { exact: true });
      await disclosure.click();
      const settings = disclosure.locator('..');
      await settings.getByText('改名', { exact: true }).first().click();
      await expect(settings.getByRole('button', { name: '保存名称', exact: true }).first()).toBeVisible();
    } }];
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('purchase and BOM recovery controls pass focused light and dark gates', async ({ page }, testInfo) => {
    let draftsPrepared = false;
    const routes: AdminRoute[] = [
      { name: 'recovery-purchase', path: '/owner/purchases/new', readyHeading: '新建采购单', prepareGateState: async (page) => {
        const resume = page.getByRole('button', { name: '继续上次录入', exact: true });
        if (draftsPrepared) {
          await resume.click();
          await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('123');
        }
        await page.getByLabel('采购数量', { exact: true }).fill('123');
        await page.reload();
        await expect(page.getByRole('button', { name: '继续上次录入', exact: true })).toBeEnabled();
      } },
      { name: 'recovery-bom', path: '/owner/boms/new', readyHeading: '新建用料清单', prepareGateState: async (page) => {
        const resume = page.getByRole('button', { name: '继续上次录入', exact: true });
        if (draftsPrepared) {
          await resume.click();
          await expect(page.getByLabel('用料清单名称', { exact: true })).toHaveValue('待补物料的用料清单');
        }
        await page.getByLabel('用料清单名称', { exact: true }).fill('待补物料的用料清单');
        await page.reload();
        await expect(page.getByRole('button', { name: '继续上次录入', exact: true })).toBeEnabled();
      } },
      { name: 'recovery-material', path: '/owner/materials/new', readyHeading: '新建物料' },
      { name: 'recovery-supplier', path: '/owner/parties/new?type=SUPPLIER', readyHeading: '新建客户/供应商' },
      { name: 'recovery-category', path: '/owner/rules/product-categories/new', readyHeading: '新建产品结构分类' },
    ];
    await checkRoutes(page, testInfo, routes, 'light');
    draftsPrepared = true;
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('owner dashboard focused light and dark gates', async ({ page }, testInfo) => {
    const routes = ownerRoutes(fixture).filter((route) => route.path === '/owner' || route.path === '/owner/analytics' || route.path.startsWith('/owner/attention'));
    expect(routes).toHaveLength(6);
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('owner pending release link opens the matching order filter', async ({ page }) => {
    await page.goto('/owner');
    const entry = page.getByRole('region', { name: '工单待办' }).getByRole('link', { name: /待下发生产/ });
    await expect(entry).toHaveAttribute('href', '/orders?queue=all&signal=pending-release');
    await entry.click();
    await expect(page).toHaveURL(/queue=all&signal=pending-release/, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: '工单决定看板' }).getByRole('link', { name: /待下发生产/ })).toHaveAttribute('aria-current', 'page');
  });

  test('order creation, detail and editing pass focused light and dark gates', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    page.on('dialog', (dialog) => dialog.accept());
    const routes: AdminRoute[] = [
      ...ownerRoutes(fixture).filter(
        (route) => route.path === '/orders/new' || route.path === `/orders/${fixture.orderId}`,
      ),
      {
        name: 'order-edit',
        path: `/orders/${fixture.orderId}/edit`,
        readyHeading: '编辑工单',
      },
    ];
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('order detail expanded records pass focused light and dark gates', async ({ page }, testInfo) => {
    const routes = ownerRoutes(fixture).filter((route) => route.path === `/orders/${fixture.orderId}`);
    expect(routes).toHaveLength(1);
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('shipping recovery exposes actual progress and respects address edit limits', async ({ page }, testInfo) => {
    const orders = await seedOrderShippingRecoveryFixture();
    const routes: AdminRoute[] = [
      { name: 'shipping-progress-recovery', path: `/orders/${orders.progress}`, readyHeading: '发货恢复验证', prepareGateState: async (page) => {
        const summary = page.locator('#admin-main #detail-business-records');
        await expect(summary).toHaveAttribute('open', '');
        await summary.locator(':scope > summary').click();
        const recovery = page.locator('#admin-main #ship-order').getByRole('link', { name: '查看生产进度', exact: true });
        if (testInfo.project.use.hasTouch) await recovery.tap();
        else { await recovery.focus(); await recovery.press('Enter'); }
        await expect(page).toHaveURL(/#detail-business-records$/);
        await expect(summary).toHaveAttribute('open', '');
        await expect(summary).toContainText('#1 粘封（进行中）');
        const item = page.locator(`#admin-main #detail-design-item-${orders.progress}-item`);
        await item.locator(':scope > summary').click();
        await expect(item.getByText('粘封：进行中（40/100）', { exact: true })).toBeVisible();
      } },
      { name: 'shipping-released-reason', path: `/orders/${orders.released}`, readyHeading: '发货恢复验证', prepareGateState: async (page) => {
        const shipment = page.locator('#admin-main #shipment-registration');
        await expect(shipment).toContainText('生产完工后才可发货');
        await expect(shipment.getByRole('button', { name: '确认该地址已发货', exact: true })).toBeDisabled();
        await expect(shipment.getByRole('button', { name: '保存物流资料', exact: true })).toBeEnabled();
        await shipment.scrollIntoViewIfNeeded();
      } },
      { name: 'shipping-completed-no-address', path: `/orders/${orders.completed}`, readyHeading: '发货恢复验证', prepareGateState: async (page) => {
        const block = page.locator('#admin-main #ship-order');
        await expect(block).toContainText('该工单已完工，无法补充发货地址，请核对历史收货资料。');
        await expect(block.getByRole('link')).toHaveCount(0);
        await expect(page.getByRole('link', { name: '补充配送信息' })).toHaveCount(0);
        await expect(page.locator('#admin-main #detail-business-records')).toContainText('历史收货地址');
        await block.scrollIntoViewIfNeeded();
      } },
      { name: 'shipping-packing-address-recovery', path: `/orders/${orders.packing}`, readyHeading: '发货恢复验证', prepareGateState: async (page) => {
        await page.locator('#admin-main #ship-order').getByRole('link', { name: '处理发货前置条件', exact: true }).click();
        const edit = page.locator('#admin-main #shipment-registration').getByRole('link', { name: '补充配送信息' });
        await expect(edit).toBeVisible();
        await expect(edit).toHaveAttribute('href', `/orders/${orders.packing}/edit`);
      } },
    ];
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('shipping address cards use the full detail column in light and dark themes', async ({ page }, testInfo) => {
    const routes: AdminRoute[] = [];
    for (const shipmentCount of [1, 2] as const) {
      const orders = await seedOrderShippingRecoveryFixture({ shipmentCount, longAddress: true });
      routes.push({
        name: `shipping-address-layout-${shipmentCount}`, path: `/orders/${orders.released}`,
        readyHeading: '发货恢复验证',
        prepareGateState: async (page) => {
          const section = page.locator('#shipment-registration');
          const list = section.locator(':scope > ol');
          const addresses = list.locator(':scope > li');
          await expect(addresses).toHaveCount(shipmentCount);
          const listWidth = (await list.boundingBox())!.width;
          for (const address of await addresses.all()) {
            expect((await address.boundingBox())!.width).toBeGreaterThanOrEqual(listWidth - 1);
            await expect(address.getByText('测试收件人', { exact: true })).toBeVisible();
            await expect(address.getByText('13800138000', { exact: true })).toBeVisible();
            await expect(address.getByText(/广东省佛山市南海区测试街道物流园收货区/)).toBeVisible();
            await expect(address.getByRole('list', { name: /的款式数量/ })).toContainText(`${100 / shipmentCount} 个`);
            await address.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('OTHER');
            await address.getByRole('textbox', { name: '物流公司名称', exact: true }).fill('测试物流公司');
            const tracking = address.getByRole('textbox', { name: '运单号', exact: true });
            await tracking.fill('TEST123456789012345678901234567890');
            expect((await tracking.boundingBox())!.width).toBeGreaterThan(200);
            await expect(address.getByRole('button', { name: '保存物流资料', exact: true })).toBeEnabled();
            await expect(address.getByRole('button', { name: '确认该地址已发货', exact: true })).toBeDisabled();
            await expect(address).toContainText('生产完工后才可发货');
          }
          await section.scrollIntoViewIfNeeded();
        },
      });
    }
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('ten-order batch fits all viewports in light and dark themes', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const route: AdminRoute = {
      name: 'ten-order-batch', path: '/orders/new', readyHeading: '新建工单',
      prepareGateState: async (page) => {
        const tabs = page.getByRole('navigation', { name: '待建工单' });
        await expect(tabs.getByRole('button').first()).toBeVisible();
        while (await tabs.getByRole('button').count() < 10) {
          await page.getByRole('button', { name: '＋ 添加工单', exact: true }).click();
        }
        await expect(page.getByRole('button', { name: '＋ 添加工单', exact: true })).toBeDisabled();
        await expect(page.getByText('本批已达 10 张，全部保存后可开始新一批。')).toBeVisible();
        const first = tabs.getByRole('button', { name: '工单 1', exact: true });
        if (testInfo.project.use.hasTouch) await first.tap();
        else { await first.focus(); await page.keyboard.press('Enter'); }
        await expect(first).toHaveAttribute('aria-pressed', 'true');
        const batch = await page.getByRole('region', { name: '批量新建工单' }).boundingBox();
        const form = await page.locator('[data-slot="order-form-b"]').boundingBox();
        expect(batch).not.toBeNull();
        expect(form).not.toBeNull();
        expect(Math.abs(batch!.x - form!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(batch!.width - form!.width)).toBeLessThanOrEqual(1);
        expect(batch!.width).toBeLessThanOrEqual(1440);
      },
    };
    await checkRoutes(page, testInfo, [route], 'light');
    await checkRoutes(page, testInfo, [route], 'dark');
  });

  test('critical routes pass responsive and accessibility gates', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, ownerRoutes(fixture), 'light');
  });

  test('attendance filters and settings fit all viewports in both themes', async ({ page }, testInfo) => {
    const routes = ownerRoutes(fixture).filter((route) =>
      route.name === 'attendance' || route.name === 'settings',
    );
    expect(routes).toHaveLength(2);
    await checkRoutes(page, testInfo, routes, 'light');
    await checkRoutes(page, testInfo, routes, 'dark');
  });

  test('critical routes pass the same gates with dark tokens', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, ownerRoutes(fixture), 'dark');
  });
});

test.describe('administrator workspace geometry', () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-1280x800',
      'Focused geometry regression runs once; the route matrix still covers every configured viewport.',
    );
    await login(page, {
      from: '/owner',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('order creation responds to its available container instead of the viewport', async ({
    page,
  }) => {
    const controlledStateWarnings: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/controlled|uncontrolled/i.test(text)) {
        controlledStateWarnings.push(text);
      }
    });

    await page.setViewportSize({ width: 911, height: 881 });
    await page.goto('/orders/new');

    for (const viewport of [
      { width: 911, height: 881, stacked: true },
      { width: 1280, height: 800, stacked: false },
      { width: 1773, height: 1298, stacked: false },
      { width: 2205, height: 1298, stacked: false },
    ]) {
      await test.step(`${viewport.width}x${viewport.height}`, async () => {
        await page.setViewportSize(viewport);

        const form = page.locator('[data-slot="order-form-b"]');
        await expect(form).toBeVisible();
        const batchBounds = await page.getByRole('region', { name: '批量新建工单' }).boundingBox();
        const formBounds = await form.boundingBox();
        expect(batchBounds).not.toBeNull();
        expect(formBounds).not.toBeNull();
        expect(Math.abs(batchBounds!.x - formBounds!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(batchBounds!.width - formBounds!.width)).toBeLessThanOrEqual(1);
        if (viewport.width >= 1773) expect(formBounds!.width).toBe(1440);
        const urgentCheckbox = form.getByRole('checkbox', {
          name: '急单（提交后会推送至排产群）',
          exact: true,
        });
        await expect(urgentCheckbox).toBeVisible();

        await urgentCheckbox.focus();
        await page.keyboard.press('Space');
        await expect(urgentCheckbox).toBeChecked();
        await page.keyboard.press('Space');
        await expect(urgentCheckbox).not.toBeChecked();

        const geometry = await form.evaluate((root) => {
          const rect = (selector: string) => {
            const element = root.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`Missing ${selector}`);
            const bounds = element.getBoundingClientRect();
            return {
              bottom: bounds.bottom,
              height: bounds.height,
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
            };
          };
          const rail = root.querySelector<HTMLElement>(
            '[data-slot="order-form-rail"]',
          );
          if (!rail) throw new Error('Missing order form rail');

          return {
            checkbox: rect('[data-slot="checkbox"]'),
            dateInput: rect('#promisedDate'),
            description: rect('[data-slot="urgent-order-description"]'),
            editor: rect('[data-slot="order-form-editor"]'),
            field: rect('[data-slot="urgent-order-field"]'),
            indicator: rect('[data-slot="checkbox-indicator"]'),
            rail: rect('[data-slot="order-form-rail"]'),
            railPosition: getComputedStyle(rail).position,
            viewportHeight: window.innerHeight,
            title: rect('[data-slot="urgent-order-title"]'),
          };
        });

        expect(geometry.checkbox.width).toBeCloseTo(44, 0);
        expect(geometry.checkbox.height).toBeCloseTo(44, 0);
        expect(geometry.indicator.width).toBeCloseTo(20, 0);
        expect(geometry.indicator.height).toBeCloseTo(20, 0);
        expect(geometry.field.width).toBeGreaterThanOrEqual(240);
        expect(geometry.title.height).toBeLessThanOrEqual(24);
        expect(geometry.description.height).toBeLessThanOrEqual(40);
        // 承诺交期固定窄列，急单勾选与日期输入框同一行对齐。
        expect(geometry.dateInput.width).toBeLessThanOrEqual(180);
        expect(Math.abs(geometry.checkbox.top - geometry.dateInput.top)).toBeLessThanOrEqual(1);

        if (viewport.stacked) {
          expect(geometry.railPosition).toBe('static');
          expect(geometry.rail.top).toBeGreaterThanOrEqual(
            geometry.editor.bottom - 1,
          );
        } else {
          const fits = Math.max(70, geometry.editor.top) + geometry.rail.height <= geometry.viewportHeight - 16;
          expect(geometry.railPosition).toBe(fits ? 'sticky' : 'static');
          expect(Math.abs(geometry.rail.top - geometry.editor.top)).toBeLessThanOrEqual(
            1,
          );
        }
      });
    }

    expect(controlledStateWarnings).toEqual([]);
  });
});

test.describe('设计稿客户计价板块', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner/rules/customer-pricing?section=blank',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('六个业务编辑器不再回落通用价格矩阵', async ({
    page,
  }, testInfo) => {
    const sections = [
      ['blank', '局部烫金 · 空白封现货单价'],
      ['machine', '局部烫金 · 机烫费与制版费'],
      ['tiers', '专版烫金 · 阶梯单价'],
      ['adds', '专版烫金 · 加价'],
      ['print', '彩印阶梯总价'],
      ['ship', '包装 · 纸箱耗材 · 中通快递'],
    ] as const;

    for (const [section, heading] of sections) {
      await test.step(section, async () => {
        await page.goto(
          `${RULE_CENTER_HREFS.customerPricing}?section=${section}`,
        );
        await expect(
          page.getByRole('heading', { name: heading, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', { name: heading, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', {
            name: '客户计价规则矩阵',
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('search', { name: '查找收费项目' }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('navigation', {
            name: '规则配置工作区导航',
          }),
        ).toHaveCount(0);
        await expectViewportGate(page, testInfo);
        await expectA11yGate(page);
      });
    }
  });
});

test.describe('deterministic external sales price tier fixture', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner/prices/external-sales/visual-fixture?state=current',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('seven-tier current and draft states pass responsive and accessibility gates', async ({
    page,
  }, testInfo) => {
    await checkRoutes(page, testInfo, priceTierFixtureRoutes(), 'light');
  });

  test('seven-tier current and draft states pass the same gates with dark tokens', async ({
    page,
  }, testInfo) => {
    await checkRoutes(page, testInfo, priceTierFixtureRoutes(), 'dark');
  });

  test('mobile pricing filters stay inline, scroll locally, and remove one chip', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-393x852');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(
      '/owner/prices/external-sales/visual-fixture?state=draft&category=print&kind=ADD_ON&status=ACTIVE&changed=1',
    );
    await expect(
      page.getByRole('heading', {
        name: '收费工作台视觉验收',
        exact: true,
      }),
    ).toBeVisible();

    const filters = page.getByRole('search', { name: '查找收费项目' });
    const filterDetails = filters.locator('details');
    const filterSummary = filterDetails.locator('summary');
    await expect(filterDetails).toHaveAttribute('open', '');
    await expect(filterSummary).toContainText('筛选定位');
    await expect(filterSummary).toContainText('4 项');
    await expect(filters.getByLabel('收费类目')).toHaveValue('print');
    await expect(
      page.getByRole('dialog', { name: '更多筛选', exact: true }),
    ).toHaveCount(0);

    await filterSummary.click();
    await expect(filterDetails).not.toHaveAttribute('open', '');
    await expect(filterSummary).toBeFocused();
    await filterSummary.click();
    await expect(filterDetails).toHaveAttribute('open', '');
    await expect(filterSummary).toBeFocused();

    const activeFilters = filters.getByLabel('已启用的收费项目筛选');
    const filterScrollMetrics = await activeFilters.evaluate((element) => {
      const node = element as HTMLElement;
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      };
    });
    expect(filterScrollMetrics.overflowX).toMatch(/auto|scroll/);
    expect(filterScrollMetrics.scrollWidth).toBeGreaterThan(
      filterScrollMetrics.clientWidth,
    );
    await activeFilters.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() =>
        activeFilters.evaluate((element) => (element as HTMLElement).scrollLeft),
      )
      .toBeGreaterThan(0);
    await activeFilters.evaluate((element) => {
      (element as HTMLElement).scrollLeft = 0;
    });
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await expectViewportGate(page, testInfo);
    await expectA11yGate(page);
    await attachCandidateScreenshot(
      page,
      testInfo,
      'admin',
      'pricing-filters-inline-light',
    );

    const categoryChip = page.getByRole('link', {
      name: '清除筛选：类目：彩印基础加工费',
      exact: true,
    });
    await expect(categoryChip).toHaveAttribute(
      'href',
      /state=draft(?=.*kind=ADD_ON)(?=.*status=ACTIVE)(?=.*changed=1)(?!.*category=)/,
    );
    await categoryChip.click();
    await expect(page).toHaveURL(
      (url) => {
        return (
          !url.searchParams.has('category') &&
          url.searchParams.get('kind') === 'ADD_ON' &&
          url.searchParams.get('status') === 'ACTIVE' &&
          url.searchParams.get('changed') === '1'
        );
      },
      { timeout: 30_000 },
    );
    await expect(categoryChip).toHaveCount(0);
    await expect(
      page.getByRole('link', {
        name: '清除筛选：类型：附加费',
        exact: true,
      }),
    ).toBeVisible();
  });
});

test.describe('sales workspace', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/orders',
      username: E2E_USERS.sales!.username,
      password: E2E_PASSWORD,
    });
  });

  test('sales routes pass responsive and accessibility gates', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, salesRoutes(fixture), 'light');
  });

  test('sales routes pass the same gates with dark tokens', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, salesRoutes(fixture), 'dark');
  });

  test('sales order list passes its focused light and dark gates', async ({
    page,
  }, testInfo) => {
    const listRoute = salesRoutes(fixture).filter(
      (route) => route.name === 'sales-orders',
    );
    await checkRoutes(page, testInfo, listRoute, 'light');
    await checkRoutes(page, testInfo, listRoute, 'dark');
  });

  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    test(`long sales order drawer closes and restores history with motion ${reducedMotion}`, async ({ page }, testInfo) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.emulateMedia({ reducedMotion });
      await page.goto(`/orders?q=${encodeURIComponent(fixture.orderNo)}`);
      await prepareSalesOrderListState(page, fixture);
      await expectSalesDrawerCloseReachable(page);
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      const content = page.getByRole('region', { name: '工单明细内容', exact: true });
      await content.focus();
      await expect(content).toBeFocused();
      if (await content.evaluate((element) => element.scrollHeight > element.clientHeight)) {
        // Chromium 的 End/Home 键盘滚动自带约 150ms 动画（不受 reduced-motion 影响）；
        // 在 End 动画收尾的窗口内按 Home 会被吞掉、停在底部（2026-09-30 实测
        // 145–180ms 区间必现）。先等 End 的 scrollend 并确认到底，再按 Home。
        await content.evaluate((element) => {
          (element as HTMLElement & { __e2eScrollEnd?: Promise<void> }).__e2eScrollEnd =
            new Promise((resolve) => element.addEventListener('scrollend', () => resolve(), { once: true }));
        });
        await page.keyboard.press('End');
        await content.evaluate((element) => (element as HTMLElement & { __e2eScrollEnd?: Promise<void> }).__e2eScrollEnd);
        await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await expect
          .poll(() => content.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
          .toBeLessThanOrEqual(1);
        await page.keyboard.press('Home');
        await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
      }
      // A directly loaded hash closes in place; Escape uses the same close contract.
      const drawer = page.getByRole('dialog', { name: `工单明细： ${longOrderName}`, exact: true });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(page).toHaveURL((url) => url.pathname === '/orders' && url.searchParams.get('view') === 'draft' && !url.hash);
      expect(pageErrors).toEqual([]);
    });
  }

  test('sales order detail passes its focused safe-surface gates', async ({
    page,
  }, testInfo) => {
    const detailRoute = salesRoutes(fixture).filter(
      (route) => route.name === 'sales-order-detail',
    );
    await checkRoutes(page, testInfo, detailRoute, 'light');
    await checkRoutes(page, testInfo, detailRoute, 'dark');
  });
});

type AdminRoute = {
  name: string;
  path: string;
  readyHeading: string | RegExp;
  prepareGateState?: (page: Page) => Promise<void>;
};

async function checkRoutes(
  page: Page,
  testInfo: TestInfo,
  routes: readonly AdminRoute[],
  theme: 'light' | 'dark',
) {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await page.addInitScript((requestedTheme) => {
    localStorage.setItem('erp-theme', requestedTheme);
    document.documentElement.classList.toggle('dark', requestedTheme === 'dark');
    document.documentElement.dataset.theme = requestedTheme;
    document.documentElement.style.colorScheme = requestedTheme;
  }, theme);
  for (const route of routes) {
    await test.step(route.name, async () => {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { name: route.readyHeading, exact: true }).first(),
      ).toBeVisible();
      await page.evaluate((requestedTheme) => {
        localStorage.setItem('erp-theme', requestedTheme);
        document.documentElement.classList.toggle('dark', requestedTheme === 'dark');
        document.documentElement.dataset.theme = requestedTheme;
        document.documentElement.style.colorScheme = requestedTheme;
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      } else {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      }
      await route.prepareGateState?.(page);
      // Server-rendered routes can create reduced-motion color transitions on
      // the next paint. Wait across consecutive paints so axe never samples a
      // half-switched palette (light foreground tokens on dark surfaces).
      for (let paint = 0; paint < 3; paint += 1) {
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        // Observe current animations instead of retaining a finished promise
        // from an animation that the streaming/hydration commit may replace.
        await expect.poll(() => page.evaluate(() => document.getAnimations()
          .filter((animation) => animation.playState === 'running' || animation.pending)
          .map((animation) => ({
            state: animation.playState,
            target: animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
              ? animation.effect.target.outerHTML.slice(0, 180) : null,
          }))), { message: `${route.name}: animations must settle before visual gates` }).toEqual([]);
      }
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(
        page,
        testInfo,
        'admin',
        `${route.name}-${theme}`,
      );
    });
  }
}

// Dashboard 的三张图走 next/dynamic + IntersectionObserver 延迟挂载
// （components/business/dashboard/DeferredDashboardCharts.tsx）。checkRoutes
// 只 goto + 等 heading，全程不滚动，于是 375/393/768 三个视口下门禁一直在
// 对占位骨架做断言，图表本身（含 recharts 生成的 SVG）从未被 axe 或裁切
// 检查看过。滚到容器可见并等 surface 出现，把这块真正纳入门禁。
async function prepareDashboardChartsState(page: Page): Promise<void> {
  const deferred = page.locator('[data-slot="dashboard-chart-deferred"]:visible');
  await expect(deferred).toHaveCount(3);
  for (const [index, kind] of ['trend', 'ranking', 'category'].entries()) {
    const chart = deferred.nth(index);
    await chart.scrollIntoViewIfNeeded();
    // Empty-data states render the same actual card; loading skeletons do not.
    await expect(chart.locator(`[data-slot="dashboard-chart-${kind}-card"]`)).toBeVisible();
    await expect(chart.locator('[data-slot="dashboard-chart-placeholder"]')).toHaveCount(0);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

function ownerRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    {
      name: 'dashboard',
      path: '/owner',
      readyHeading: '工作台',
      prepareGateState: async (page) => {
        await expect(page.locator('[data-slot="dashboard-watchlist-shipments"]:visible')).toHaveCount(1);
        await expect(page.locator('[data-slot="dashboard-kpi"]:visible')).toHaveCount(4);
      },
    },
    {
      name: 'owner-analytics', path: '/owner/analytics', readyHeading: '经营概览',
      prepareGateState: prepareDashboardChartsState,
    },
    ...(['due', 'shipments', 'outsource', 'over-reports'] as const).map(kind => ({
      name: `owner-attention-${kind}`, path: `/owner/attention?kind=${kind}`, readyHeading: '关注事项',
      prepareGateState: async (page: Page) => {
        await expect(page.getByText(/共 \d+ 条 · 每页/).and(page.locator(':visible'))).toHaveCount(1);
      },
    })),
    {
      name: 'orders',
      path: '/orders',
      readyHeading: '工单列表',
      prepareGateState: (page) => prepareAdminOrderWorkspaceState(page, data),
    },
    {
      name: 'orders-filtered',
      // 业主 2026-09-27：客户筛选已退役，长筛选值改由搜索框承载。
      path:
        '/orders?status=SUBMITTED,IN_PRODUCTION&q=' +
        encodeURIComponent('超长搜索词用于验证筛选输入在小屏幕上不会撑破布局或被裁切') +
        '&receiverAddress=' +
        encodeURIComponent('广东省深圳市南山区科技园长地址压力测试大厦A座12345678901234567890') +
        '&foilColor=' +
        encodeURIComponent('哑金,透明金,客户特殊调色长名称'),
      readyHeading: '工单列表',
      prepareGateState: (page) => prepareAdminOrderWorkspaceState(page, data),
    },
    {
      name: 'order-detail',
      path: `/orders/${data.orderId}`,
      readyHeading: '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      prepareGateState: (page) => prepareOrderDetailDesignPreview(page, data),
    },
    {
      name: 'order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareAdminOrderCreationState,
    },
    {
      name: 'attendance',
      path: '/foreman/attendance',
      readyHeading: '工时录入',
      prepareGateState: prepareAttendanceState,
    },
    { name: 'inventory', path: '/foreman/materials', readyHeading: '车间用料' },
    { name: 'outsource', path: '/foreman/outsource', readyHeading: '外协单' },
    // 以下四条此前从未被任何门禁访问过。UI 审查在它们上面实测到 axe
    // label / select-name 违规（筛选栏 <label> 没有 htmlFor），修完补进
    // 路由表，避免再次退化。
    {
      // 历史存档页的师傅下拉只列当月有存档的人与当前筛选对象；用筛选把长姓名带进来。
      name: 'salary-hourly', path: `/owner/salary/hourly?workerId=${data.hourlyWorkerId}`, readyHeading: '历史时薪档案',
      prepareGateState: async (page) => {
        const worker = page.getByRole('combobox', { name: '师傅', exact: true });
        await expect(worker.locator(`option[value="${data.hourlyWorkerId}"]`)).toHaveText(
          `长姓名打包师傅ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789用于验证筛选不会撑开小屏（${data.hourlyWorkerId} · 已停用）`,
        );
      },
    },
    {
      name: 'salary-daily',
      path: '/owner/salary/daily',
      readyHeading: '历史日薪档案',
    },
    { name: 'cdr', path: '/foreman/cdr', readyHeading: 'CDR 汇总下载' },
    { name: 'accounts', path: '/owner/accounts', readyHeading: '用户管理' },
    { name: 'materials', path: '/owner/materials', readyHeading: '物料' },
    {
      name: 'product-references',
      path: RULE_CENTER_HREFS.productReferences,
      readyHeading: '产品资料',
    },
    {
      name: 'rule-center',
      path: RULE_CENTER_HREFS.root,
      readyHeading: '规则配置中心',
    },
    {
      name: 'rule-center-customer-processing',
      path: customerPricingHref('processing'),
      readyHeading: '局部烫金 · 空白封现货单价',
      prepareGateState: (page) =>
        prepareDedicatedPriceSectionState(
          page,
          '局部烫金 · 空白封现货单价',
        ),
    },
    {
      name: 'rule-center-customer-logistics',
      path: customerPricingHref('logistics'),
      readyHeading: '包装 · 纸箱耗材 · 中通快递',
      prepareGateState: (page) =>
        prepareDedicatedPriceSectionState(
          page,
          '包装 · 纸箱耗材 · 中通快递',
        ),
    },
    {
      name: 'rule-center-papers',
      path: RULE_CENTER_HREFS.papers,
      readyHeading: '纸张',
    },
    {
      name: 'rule-center-specs',
      path: `${RULE_CENTER_HREFS.productReferences}?section=specs`,
      readyHeading: '规格 · 烫金颜色',
    },
    {
      name: 'rule-center-product-categories',
      path: RULE_CENTER_HREFS.productCategories,
      readyHeading: '产品结构分类 / BOM 分类',
    },
    {
      name: 'rule-center-crafts',
      path: RULE_CENTER_HREFS.crafts,
      readyHeading: '建单工艺目录',
    },
    {
      name: 'rule-center-price-versions',
      path: RULE_CENTER_HREFS.priceVersions,
      // 2026-09-13 价格版本页重排后标题统一为「价格版本」（docs/价格版本页面-20260913.md）。
      readyHeading: '价格版本',
      prepareGateState: preparePriceBookBusinessState,
    },
    {
      name: 'rule-center-employee-pay',
      path: RULE_CENTER_HREFS.employeePay,
      readyHeading: '员工工资规则',
      prepareGateState: async (page) => {
        await expect(page.getByRole('combobox', { name: '工资规则', exact: true })).toBeVisible();
        // DECISIONS 2026-09-24：客服工资体系删除后，员工工资规则只剩标准工时。
        // 开发服务器水合期间偶有一帧同时存在服务端与客户端两份输入框，等收敛到一份再断言。
        const morningStart = page.getByLabel('上午上班', { exact: true });
        await expect(morningStart).toHaveCount(1);
        await expect(morningStart).toBeVisible();
      },
    },
    {
      name: 'agent-monthly-bills-alias',
      path: '/owner/bills',
      readyHeading: '外部销售月账单',
    },
    {
      name: 'legacy-bills-archive',
      path: '/owner/bills/archive',
      readyHeading: '历史账单归档',
    },
    {
      name: 'order-changes',
      path: '/owner/order-changes',
      readyHeading: '工单修改申请',
    },
    { name: 'salary', path: '/owner/salary', readyHeading: '薪资总览' },
    { name: 'warehouses', path: '/owner/warehouses', readyHeading: '仓库/库位' },
    { name: 'pigsty', path: '/owner/pigsty', readyHeading: 'Pigsty 运维' },
    { name: 'settings', path: '/owner/settings', readyHeading: '系统设置' },
    {
      name: 'not-found',
      path: '/orders/e2e-admin-ui-missing',
      readyHeading: '找不到这个页面，或你没有访问权限',
    },
  ];
}

function priceTierFixtureRoutes(): readonly AdminRoute[] {
  return [
    {
      name: 'external-sales-current-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=current',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'current'),
    },
    {
      name: 'external-sales-draft-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=draft',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'draft'),
    },
    {
      name: 'external-sales-per-piece-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=draft-piece',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'draft-piece'),
    },
  ];
}

async function prepareAdminOrderWorkspaceState(page: Page, data: WorkerUiFixture) {
  const workspace = page
    .locator('[data-slot="admin-order-workspace"]:visible')
    .first();
  await expect(workspace).toBeVisible();
  await expect(
    workspace.getByRole('navigation', { name: '工单队列', exact: true }),
  ).toBeVisible();
  for (const queue of [
    '待办',
    '待打印',
    '生产中',
    '已发货',
    '已结算/取消',
    '全部',
  ]) {
    await expect(
      workspace.getByRole('link', { name: new RegExp(`^${queue}`) }),
    ).toBeVisible();
  }
  await expect(workspace.getByLabel('搜索工单')).toBeVisible();
  // 业主 2026-09-27：工单列表不再按客户筛选。
  await expect(workspace.getByLabel('按产品客户筛选')).toHaveCount(0);
  await expect(workspace.getByLabel('按业务员筛选')).toBeVisible();
  await expect(workspace.getByLabel('按工艺线筛选')).toBeVisible();

  if (new URL(page.url()).search === '') {
    await workspace
      .getByRole('link', { name: /^全部/ })
      .click();
    await expect(page).toHaveURL(/(?:[?&])queue=all(?:&|$)/);
    const search = workspace.getByLabel('搜索工单', { exact: true });
    await search.fill(data.orderNo);
    await search.press('Enter');
    await expect(page).toHaveURL((url) => url.searchParams.get('q') === data.orderNo);
    const order = page.getByRole('list', { name: '管理端工单列表', exact: true })
      .locator(`[data-order-id="${data.orderId}"]`);
    await order.getByRole('heading', { level: 2 }).getByRole('link', { name: longOrderName, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/orders/${data.orderId}`);
    const fees = page.getByRole('region', { name: '工单费用', exact: true });
    await expect(fees.getByRole('heading', { name: '费用记录', exact: true })).toBeVisible();
    for (const title of ['提交报价', '确认金额', '结算金额']) {
      await expect(fees.getByText(title, { exact: true })).toBeVisible();
    }
    // This legacy fixture has only a historical total, no fabricated stage snapshots.
    const currentAmount = fees.locator('[data-slot="current-order-amount"]');
    await expect(currentAmount).toBeVisible();
    await expect(currentAmount.locator('..')).toContainText('历史金额');
    await expect(currentAmount).toHaveText('¥ 646,172.57');
    await expect(currentAmount.locator('..').getByText('不含快递费，含耗材费', { exact: true })).toBeVisible();
    await expect(fees.getByText('当前', { exact: true })).toHaveCount(0);
    await expect(fees.getByText('—', { exact: true })).toHaveCount(3);
    for (const hint of ['尚未形成报价', '费用核定后显示', '结算后显示']) {
      await expect(fees.getByText(hint, { exact: true })).toBeVisible();
    }
    await page.goBack();
    await expect(workspace).toBeVisible();
  }

  const exportTrigger = workspace.getByRole('button', {
    name: /导出工单/,
  });
  await expect(exportTrigger).toBeVisible();
  await exportTrigger.click();
  const exportDialog = page.getByRole('dialog', {
    name: '导出工单',
    exact: true,
  });
  await expect(exportDialog).toBeVisible();
  await expect(
    exportDialog.getByRole('button', { name: /导出筛选结果/ }),
  ).toBeVisible();
  await expect(
    exportDialog.getByRole('button', { name: '导出全部工单', exact: true }),
  ).toBeVisible();
  const mobile = (page.viewportSize()?.width ?? 1280) < 640;
  if (mobile) {
    const viewportWidth = page.viewportSize()?.width ?? 0;
    // Base UI 先挂载右侧抽屉，再在下一帧移除
    // data-starting-style。只等 getAnimations() 有可能在 transition
    // 创建前就返回，使门禁误把进场中的 40px 位移当成永久溢出。
    await expect
      .poll(async () => {
        const box = await exportDialog.boundingBox();
        if (!box) return Number.POSITIVE_INFINITY;
        return Math.max(-box.x, box.x + box.width - viewportWidth, 0);
      })
      .toBeLessThanOrEqual(1);
  }
}

function salesRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    {
      name: 'sales-orders',
      path: `/orders?q=${encodeURIComponent(data.orderNo)}`,
      readyHeading: '工单列表',
      prepareGateState: (page) => prepareSalesOrderListState(page, data),
    },
    {
      name: 'sales-order-detail',
      path: `/orders/${data.orderId}`,
      readyHeading: new RegExp(`^${longOrderName}`),
      prepareGateState: prepareSalesOrderDetailState,
    },
    {
      name: 'sales-order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareSalesOrderCreationState,
    },
    {
      name: 'sales-bills',
      path: '/sales/bills',
      readyHeading: '我的货款账单',
    },
  ];
}

async function preparePriceBookBusinessState(page: Page) {
  const main = page.locator('main');
  await expect(main).not.toContainText('SHA-256');
  await expect(main).not.toContainText('价目簿代码');
  await expect(main).not.toContainText('规则代码');
  await expect(main).not.toContainText('触发条件（JSON）');
  await expect(
    main.locator(
      '[name="triggerCondition"], [name="exclusiveGroup"], [name="priority"]',
    ),
  ).toHaveCount(0);
}

async function prepareDedicatedPriceSectionState(
  page: Page,
  heading: string,
) {
  await preparePriceBookBusinessState(page);
  await expect(
    page.getByRole('region', { name: heading, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('region', {
      name: '客户计价规则矩阵',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('search', { name: '查找收费项目' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '规则配置工作区导航' }),
  ).toHaveCount(0);
}

async function expectPriceWorkspaceOverview(page: Page) {
  const workbench = page.locator('[data-slot="rule-price-workbench"]');
  await expect(workbench).toBeVisible({ timeout: 30_000 });
  const matrix = workbench.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  await expect(matrix).toBeVisible({ timeout: 30_000 });
  const table = matrix.locator(':scope > table');
  const tableHeader = table.locator(':scope > thead');
  await expect(table.locator('tbody > tr').first()).toBeAttached({
    timeout: 30_000,
  });
  for (const heading of [
    '收费项目',
    '适用范围',
    '数量与档位',
    '当前价',
    '状态',
    '操作',
  ]) {
    await expect(
      tableHeader.getByRole('columnheader', { name: heading, exact: true }),
    ).toBeAttached();
  }
  await expect(
    matrix
      .getByRole('link', {
        name: /^(?:编辑|查看|正在编辑|正在查看)收费项目：/,
      })
      .first(),
  ).toBeAttached();

  // 新工作台只有一张矩阵，选中详情作为同一表格的下一行
  // 展开；不再保留旧分组卡片、独立列表或右侧详情栏。
  await expect(
    workbench.locator('section[aria-labelledby^="external-charge-group-"]'),
  ).toHaveCount(0);
  await expect(workbench.locator('#external-charge-list')).toHaveCount(0);
  await expect(
    workbench.locator('aside[aria-labelledby="selected-charge-heading"]'),
  ).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1280) <= 768) {
    const metrics = await matrix.evaluate((element) => {
      const node = element as HTMLElement;
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      };
    });
    expect(metrics.overflowX).toMatch(/auto|scroll/);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    await matrix.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() =>
        matrix.evaluate((element) => (element as HTMLElement).scrollLeft),
      )
      .toBeGreaterThan(0);
    await matrix.evaluate((element) => {
      (element as HTMLElement).scrollLeft = 0;
    });
  }
}

async function expectSelectedPriceWorkspace(
  page: Page,
  hasDraft: boolean,
) {
  const workbench = page.locator('[data-slot="rule-price-workbench"]');
  const matrix = workbench.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  const selectedDetail = workbench.locator('section#selected-charge-detail');
  const collapseDetail = selectedDetail.getByRole('link', {
    name: '收起详情',
    exact: true,
  });
  await expect(selectedDetail).toBeVisible();
  await expect(matrix).toBeVisible();
  await expect(collapseDetail).toBeVisible();
  await expect(collapseDetail).toHaveAttribute(
    'href',
    /#rule-price-matrix-heading$/,
  );
  await expect(
    matrix.getByRole('link', {
      name: /^(正在编辑|正在查看)收费项目：/,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(selectedDetail.locator('xpath=ancestor::td[1]')).toHaveCount(0);

  if (hasDraft) {
    await expect(workbench.getByLabel('调价草稿状态')).toBeVisible();
    const editorSection = selectedDetail.getByLabel('编辑收费项目');
    await expect(editorSection).toBeVisible();
    const editorForm = editorSection.locator('form').first();
    await expect(editorForm).toBeVisible();
    await expect(
      editorForm.getByRole('button', {
        name: /^(?:保存到调价草稿|保存（\d+ 档）)$/,
      }),
    ).toBeVisible();
    return;
  }

  await expect(workbench.getByLabel('价格状态')).toBeVisible();
  await expect(
    workbench.getByText('当前生效', { exact: true }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('link', { name: /^正在查看收费项目：/ }),
  ).toBeAttached();

  const createDraftSummary = workbench
    .locator('details > summary')
    .filter({ hasText: /^发起调价$/ });
  const createDraftPanel = createDraftSummary.locator('..');
  if ((await createDraftPanel.count()) > 0) {
    await expect(createDraftPanel).not.toHaveAttribute('open', '');
    await createDraftSummary.click();
    await expect(createDraftPanel).toHaveAttribute('open', '');
    const createDraftForm = workbench.getByRole('form', {
      name: /^创建(?:加工费|快递与耗材)调价草稿$/,
    });
    await expect(createDraftForm).toBeVisible();
    await expect(createDraftForm.getByLabel('调价原因')).toBeVisible();
    await expect(
      createDraftForm.getByRole('button', {
        name: '复制当前价目并开始调价',
        exact: true,
      }),
    ).toBeVisible();
  } else if (
    (await workbench.getByRole('link', { name: '发起调价', exact: true }).count()) >
    0
  ) {
    await expect(
      workbench.getByRole('link', { name: '发起调价', exact: true }),
    ).toBeVisible();
  } else {
    await expect(workbench.getByText(/生效前不能再发起新调价/)).toBeVisible();
  }
}

async function prepareDeterministicPriceWorkspaceState(
  page: Page,
  state: 'current' | 'draft' | 'draft-piece',
) {
  await expectPriceWorkspaceOverview(page);
  await expectSelectedPriceWorkspace(page, state !== 'current');
  const expectedQuantities = [
    '1,000 个',
    '2,000 个',
    '3,000 个',
    '4,000 个',
    '5,000 个',
    '10,000 个',
    '20,000 个',
  ];

  const matrix = page.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  const selectedDetail = page.locator(
    '[data-slot="rule-price-workbench"] section#selected-charge-detail',
  );
  await expect(
    matrix.getByText(/^7 档 · 7 个数量档·/),
  ).toBeVisible();
  await expect(
    selectedDetail.getByRole('heading', {
      name: /大号·非标定制 123\.45 × 678\.90 mm/,
    }),
  ).toBeVisible();
  await expect(
    selectedDetail
      .getByText(/157克双铜纸·客户指定超长纸张名称/)
      .first(),
  ).toBeVisible();

  const readOnlyTierPanel = selectedDetail.getByRole('region', {
    name: /大号·非标定制 123\.45 × 678\.90 mm.*价格阶梯$/,
  });
  const tierPanel = state === 'current'
    ? readOnlyTierPanel
    : selectedDetail.getByLabel('编辑收费项目').locator('form');
  await expect(tierPanel).toBeVisible();
  if (state === 'current') {
    await expect(
      tierPanel.getByRole('columnheader', { name: '数量档', exact: true }),
    ).toBeVisible();
    await expect(tierPanel.locator('tbody > tr')).toHaveCount(7);
    await expect(tierPanel.locator('input')).toHaveCount(0);
  } else {
    const tierHeader = tierPanel.locator('header');
    await expect(
      tierHeader.getByText(/157克超长双铜纸彩印加局部烫金/),
    ).toBeVisible();
    await expect(
      tierHeader.getByText(/157克双铜纸·客户指定超长纸张名称/),
    ).toBeVisible();
    await expect(
      tierHeader.getByText(/非标定制 123\.45 × 678\.90 mm/),
    ).toBeVisible();
    await expect(
      tierPanel.getByText('7 个数量档', { exact: true }),
    ).toBeVisible();
    await expect(tierPanel.locator('ol > li')).toHaveCount(7);
  }

  const quantityRows =
    state === 'current'
      ? tierPanel.locator('tbody > tr')
      : tierPanel.locator('ol > li');
  const renderedQuantities = await quantityRows.evaluateAll((rows) =>
    rows.map(
      (row) =>
        row.querySelector<HTMLElement>('.tabular-nums')?.textContent?.trim() ??
        row.querySelector<HTMLElement>('td')?.textContent?.trim() ??
        '',
    ),
  );
  expect(renderedQuantities).toEqual(expectedQuantities);

  if (state === 'draft') {
    await expect(tierPanel.locator('input[name^="tierAmount-"]')).toHaveCount(7);
    await expect(tierPanel.getByText('当前', { exact: true })).toHaveCount(1);
    await expect(tierPanel.getByText('草稿', { exact: true })).toHaveCount(1);
    await expect(tierPanel.getByText('变化', { exact: true })).toHaveCount(8);
    await expect(tierPanel.getByRole('checkbox')).toHaveCount(7);
    await expect(
      tierPanel
        .locator('ol > li')
        .first()
        .getByLabel('草稿总价（元）', { exact: true }),
    ).toHaveValue('310');
    await expect(
      tierPanel
        .locator('ol > li')
        .last()
        .getByLabel('草稿总价（元）', { exact: true }),
    ).toHaveValue('2480');
    await expect(
      tierPanel.getByLabel('1,000 个价格档启用', { exact: true }),
    ).toBeChecked();
    const firstTierDelta = tierPanel.locator('ol > li').first()
      .locator('div').filter({ has: page.getByText('变化', { exact: true }) })
      .locator('p.tabular-nums');
    await expect(firstTierDelta).toHaveText('+¥ 15.00+5.0847%');
    await expect(
      tierPanel.getByRole('button', {
        name: '保存（0 档）',
        exact: true,
      }),
    ).toBeDisabled();
  } else if (state === 'draft-piece') {
    await expect(tierPanel.locator('input[name^="tierAmount-"]')).toHaveCount(7);
    await expect(tierPanel.getByRole('checkbox')).toHaveCount(7);
    await expect(
      tierPanel
        .locator('ol > li')
        .first()
        .getByLabel('草稿单价（元/个）', { exact: true }),
    ).toHaveValue('0.54');
    await expect(
      tierPanel
        .locator('ol > li')
        .last()
        .getByLabel('草稿单价（元/个）', { exact: true }),
    ).toHaveValue('0.18');
    const firstTierCurrentRate = tierPanel.locator('ol > li').first()
      .locator('div').filter({ has: page.getByText('当前单价', { exact: true }) })
      .locator('p.tabular-nums');
    await expect(firstTierCurrentRate).toHaveText('¥ 0.52 / 个');
    await expect(firstTierCurrentRate).toBeVisible();
    await expect(tierPanel.getByText('按个计价', { exact: true })).toBeVisible();
    await expect(tierPanel.getByText('折合单价', { exact: true })).toHaveCount(0);
    await expect(
      tierPanel.getByRole('button', {
        name: '保存（0 档）',
        exact: true,
      }),
    ).toBeDisabled();
  } else {
    await expect(readOnlyTierPanel).toBeVisible();
    await expect(
      readOnlyTierPanel.getByRole('columnheader', {
        name: '当前价',
        exact: true,
      }),
    ).toBeVisible();
  }

  await expect(page.locator('body')).not.toContainText('visual-tier-');
  await expect(page.locator('body')).not.toContainText(
    '2026-08-11T20:00:00.000Z',
  );
  await preparePriceBookBusinessState(page);
}

async function prepareSalesOrderListState(page: Page, data: WorkerUiFixture) {
  await expect(
    page.getByRole('button', { name: /导出工单/ }),
  ).toHaveCount(0);
  const filters = page.locator(
    '[data-slot="sales-order-list-filters"]:visible',
  );
  await expect(filters).toBeVisible();
  const views = filters.getByRole('navigation', { name: '销售工单视图' });
  for (const label of ['全部', '需关注', '进行中', '已发货', '已结算', '已取消', '草稿']) {
    await expect(views.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(
    filters.getByRole('searchbox', {
      name: '搜索工单名或工单号',
    }),
  ).toBeVisible();

  const list = page.locator('[data-slot="sales-orders-list"]');
  await expect(list).toBeVisible();
  const card = list.locator(`[data-order-id="${data.orderId}"]:visible`);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(longOrderName);
  await expect(card.getByRole('link', { name: /查看详情|查看草稿|查看原因/ })).toHaveAttribute('href', `/orders/${data.orderId}`);
  const action = card.getByRole('button', { name: longOrderName, exact: true });
  await expect(action).toBeVisible();
  await expect(card).not.toContainText('计件成本');
  await expect(card).not.toContainText('师傅');
  await expect(card.getByRole('button', { name: `复制工单号 ${data.orderNo}`, exact: true })).toBeVisible();
  const orderNo = data.orderNo;
  await expectViewportGate(page, test.info());
  await action.click();
  await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.slice(1)).get('wo') === orderNo);
  const drawer = page.getByRole('dialog', { name: /工单明细/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: `工单明细： ${longOrderName}`, exact: true })).toBeVisible();
  await expect(drawer).not.toContainText('计件成本');
  await expect(drawer).not.toContainText('生产任务');
  await expect(drawer.getByRole('link', { name: '查看完整详情', exact: true })).toHaveAttribute('href', `/orders/${data.orderId}`);
  await expect(drawer.getByRole('link', { name: '下载 PDF' })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) < 640) {
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.width).toBeGreaterThanOrEqual(
      (page.viewportSize()?.width ?? 0) - 1,
    );
  }

  await expectSalesDrawerCloseReachable(page);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL((url) => !url.hash);
  await page.goForward();
  await expect(drawer).toBeVisible();

  await page.goto(`/orders?view=draft#wo=${encodeURIComponent(orderNo)}`);
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(orderNo);
  await expect(
    drawer.getByRole('heading', { name: '进度', exact: true }),
  ).toBeVisible();
}

async function expectSalesDrawerCloseReachable(page: Page) {
  const drawer = page.getByRole('dialog', { name: `工单明细： ${longOrderName}`, exact: true });
  const close = drawer.getByRole('button', { name: '关闭', exact: true });
  await expect(close).toBeVisible();
  // Wait for the real entrance transition. Do not force clicks through title text.
  await expect(drawer).not.toHaveAttribute('data-starting-style');
  await drawer.evaluate(async (root) => {
    await Promise.all(root.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const hit = await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const heading = button.closest('[role="dialog"]')?.querySelector('h2');
    return {
      reachable: target === button || (target !== null && button.contains(target)),
      button: box.toJSON(),
      heading: heading?.getBoundingClientRect().toJSON(),
      target: target?.outerHTML.slice(0, 400),
      hash: location.hash,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  await test.info().attach('sales-drawer-close-hit-target', { body: JSON.stringify(hit, null, 2), contentType: 'application/json' });
  expect(hit.reachable, JSON.stringify(hit)).toBe(true);
}

async function prepareSalesOrderDetailState(page: Page) {
  // Streaming can briefly retain the hidden Suspense copy beside the resolved
  // page on compact viewports; gate only the visible sales surface.
  const detail = page.locator('[data-slot="sales-order-detail"]:visible');
  await expect(detail).toBeVisible();
  for (const hiddenFactoryField of [
    '师傅',
    '生产安排',
    '修改日志',
    '制版明细',
    '计价快照',
    '计件工资',
    '内部成本',
  ]) {
    await expect(detail).not.toContainText(hiddenFactoryField);
  }
  await expect(detail.getByRole('link', { name: '打印', exact: true })).toHaveCount(0);
  await expect(
    detail.getByRole('link', { name: '下载 PDF', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '面包屑导航', exact: true }).getByRole('link', { name: '工单列表', exact: true }),
  ).toHaveAttribute('href', '/orders');

  const formSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '申请修改工单', exact: true }) });
  await expect(formSection).toBeVisible();
  const styleCheckboxes = formSection.getByRole('checkbox');
  expect(await styleCheckboxes.count()).toBeGreaterThanOrEqual(3);
  const firstStyleCheckbox = styleCheckboxes.first();
  await firstStyleCheckbox.click();
  await expect(firstStyleCheckbox).toBeChecked();
  const lastStyleCheckbox = styleCheckboxes.last();
  await lastStyleCheckbox.click();
  await expect(lastStyleCheckbox).toBeChecked();
  await expect(
    formSection.getByLabel('新款式名称', { exact: true }),
  ).toBeVisible();
}

async function prepareAttendanceState(page: Page) {
  const dayCards = page.locator('main details');
  expect(await dayCards.count()).toBeGreaterThan(0);
  const firstDay = dayCards.first();
  await firstDay.locator('summary').click();
  await expect(firstDay).toHaveAttribute('open', '');
  const daySelectors = firstDay.locator('select');
  expect(await daySelectors.count()).toBeGreaterThanOrEqual(2);
  await expect(daySelectors.first()).toBeVisible();
}

async function prepareOrderDetailDesignPreview(
  page: Page,
  data: WorkerUiFixture,
) {
  // 管理区块按业务顺序嵌入主栏，操作集中在待办栏（docs/ui-规范.md）。
  // 只取主栏里可见的那一份：CI 在 375 / 393 视口整页跳转后曾短暂出现第二份
  // 同 testid 的节点（位于 #admin-main 之外），未限定范围会撞严格模式冲突。
  const records = page.locator('#admin-main [data-testid="admin-order-detail"]:visible');
  await expect(records).toBeVisible();
  await expect(records.locator('details[id^="detail-"]:not([id^="detail-design-item-"]):not(#detail-packaging)')).toHaveCount(6);
  const sections = [
    ['detail-costs', '工厂成本'],
    ['detail-pricing-tools', '计价与收费维护'],
    ['detail-delivery-records', '配送与发货记录'],
    ['detail-production-records', '生产、用料与计件记录'],
    ['detail-business-records', '生产与业务资料'],
    ['detail-audit-records', '工单动态'],
  ] as const;
  for (const [id, title] of sections) {
    const section = records.locator(`#${id}`);
    await expect(section).toHaveAttribute('open', '');
    const summary = section.locator(':scope > summary');
    const content = section.locator(':scope > div');
    await expect(summary).toContainText(title);
    await expect(summary.getByText('收起', { exact: true })).toBeVisible();
    await expect(content).toBeVisible();
    await summary.click();
    await expect(section).not.toHaveAttribute('open', '');
    await expect(content).toBeHidden();
    await summary.press('Enter');
    await expect(section).toHaveAttribute('open', '');
    await expect(content).toBeVisible();
  }
  await expect(records.locator('#detail-pricing-tools').getByRole('heading', { name: '工单价格状态', exact: true })).toBeVisible();
  await expect(records.locator('#detail-delivery-records').getByRole('heading', { name: '发货地址（1）', exact: true })).toBeVisible();
  await expect(records.locator('#detail-production-records').getByRole('heading', { name: '物料用量估算', exact: true })).toBeVisible();
  await expect(records.locator('#detail-business-records').getByRole('heading', { name: '生产概况与业务资料', exact: true })).toBeVisible();
  await expect(records.locator('#detail-audit-records').getByRole('region', { name: '操作事件', exact: true })).toBeVisible();
  await expect(records.getByRole('complementary', { name: '工单概览与操作' }).locator('#detail-other-actions')).toBeVisible();
  await expect(records.getByRole('complementary', { name: '工单概览与操作' }).getByRole('link', { name: '下载 PDF', exact: true })).toHaveAttribute('href', `/api/orders/${data.orderId}/pdf`);

  // The current detail contract keeps the style name, quantity, materials and
  // saved processing amount in the main card; complete facts remain on demand.
  const mainItem = page.locator(`#order-detail-item-${data.orderItemActiveId}`);
  await expect(mainItem.getByRole('heading', {
    level: 3,
    name: '超长款式名称红包烫金高级定制版ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    exact: true,
  })).toBeVisible();
  await expect(mainItem.getByText('1,234,567 个', { exact: true })).toBeVisible();
  await expect(mainItem.getByText('特种珠光纸ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', { exact: true })).toBeVisible();
  await expect(mainItem.getByText('https://example.invalid/specification/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/very-long-unbroken-value', { exact: true })).toBeVisible();
  const visibleProcessingAmount = mainItem.getByText('¥ 152,345.57', { exact: true }).filter({ visible: true });
  await expect(visibleProcessingAmount).toHaveCount(1);
  await expect(visibleProcessingAmount).toBeVisible();
  await expect(mainItem).not.toContainText(data.craftId);

  const itemDetails = records.locator(`#detail-design-item-${data.orderItemActiveId}`);
  await expect(itemDetails).not.toHaveAttribute('open', '');
  const itemSummary = itemDetails.locator(':scope > summary');
  await expect(itemSummary).toBeVisible();
  await expect(itemSummary.getByText('展开', { exact: true })).toBeVisible();
  await expect(itemSummary.getByText('收起', { exact: true })).toBeHidden();
  await mainItem.getByRole('button', { name: '查看设计文件', exact: true }).click();
  await expect(itemDetails).toHaveAttribute('open', '');
  await expect(itemDetails).toBeFocused();
  await expect(itemSummary.getByText('收起', { exact: true })).toBeVisible();
  await expect(itemSummary.getByText('展开', { exact: true })).toBeHidden();
  const designSummary = itemSummary;
  await designSummary.click();
  await expect(itemDetails).not.toHaveAttribute('open', '');
  await expect(itemDetails.locator(':scope > div')).toBeHidden();
  await designSummary.click();
  await expect(itemDetails).toHaveAttribute('open', '');
  await expect(itemSummary.getByText('收起', { exact: true })).toBeVisible();
  await expect(itemSummary.getByText('展开', { exact: true })).toBeHidden();
  const itemCard = itemDetails;
  const definition = (label: string) =>
    itemCard
      .locator('dt')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('..')
      .locator('dd');

  await expect(itemCard.getByText('1,234,567', { exact: true })).toBeVisible();
  await expect(itemCard.getByText('¥ 0.1234', { exact: true })).toBeVisible();
  await expect(itemCard.getByText('¥ 152,345.57', { exact: true })).toBeVisible();
  await expect(definition('工艺')).toHaveText(data.craftName);
  await expect(definition('加工面')).toHaveText('双面加工');
  await expect(definition('双色烫金')).toHaveText('是');
  await expect(definition('生产工序')).toContainText('局部烫金：进行中');
  await expect(itemCard).not.toContainText(data.craftId);

  const fileName =
    '生产设计图超长文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png';
  const previewLink = page.getByRole('link', {
    name: `查看原图：${fileName}`,
    exact: true,
  });
  const previewImage = page.getByRole('img', {
    name: fileName,
    exact: true,
  });

  await expect(previewLink).toBeVisible();
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveCSS('object-fit', 'contain');

  const box = await previewImage.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(280);
}

async function prepareConfiguredLocalFoilStyle(page: Page) {
  const form = page.locator('[data-slot="order-form-b"]:visible');
  await expect(form).toBeVisible();
  // ce3b6d37 起设计款是文件夹式 tablist（EditorTabs），不再是 aria-pressed 按钮导航。
  await expect(
    form.getByRole('tablist', { name: '设计款', exact: true }).getByRole('tab').first(),
  ).toHaveAttribute('aria-selected', 'true');

  // A second theme visit encounters the local draft from the first visit.
  // Resolve that real recovery state before operating the protected form.
  const discardDraft = page.getByRole('button', {
    name: '放弃本地草稿', exact: true,
  });
  const routePicker = form.getByRole('group', { name: '工单类型' });
  const localFoil = routePicker.getByRole('button', {
    name: '局部烫金', exact: true,
  });
  await expect.poll(async () =>
    (await discardDraft.isVisible()) || (await localFoil.isEnabled()),
  ).toBe(true);
  if (await discardDraft.isVisible()) await discardDraft.click();
  for (const route of ['局部烫金', '专版烫金', '彩印']) {
    await expect(
      routePicker.getByRole('button', { name: route, exact: true }),
    ).toBeVisible();
  }
  await routePicker
    .getByRole('button', { name: '局部烫金', exact: true })
    .click();

  const paperPicker = form.getByRole('group', { name: '纸张材质' });
  await paperPicker
    .getByRole('button', { name: '艳红珠光纸', exact: true })
    .click();
  const specificationPicker = form.getByRole('group', { name: '规格' });
  await specificationPicker
    .getByRole('button', { name: '大号封', exact: true })
    .click();
  const weightPicker = form.getByRole('group', { name: '克重' });
  await weightPicker
    .getByRole('button', { name: '160g', exact: true })
    .click();

  await expect(
    routePicker.getByRole('button', {
      name: '局部烫金',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    paperPicker.getByRole('button', {
      name: '艳红珠光纸',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    specificationPicker.getByRole('button', {
      name: '大号封',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    weightPicker.getByRole('button', {
      name: '160g',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  for (const retiredField of ['报价产品', '成交单价', '人工改价说明']) {
    await expect(form.getByLabel(retiredField, { exact: true })).toHaveCount(0);
  }

  return form;
}

async function prepareAdminOrderCreationState(page: Page) {
  const form = await prepareConfiguredLocalFoilStyle(page);
  await form
    .getByRole('textbox', { name: '工单名称', exact: true })
    .fill('管理员代建超长工单名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  // DECISIONS 2026-09-13：管理员创建不再录入工单客户及简称，该输入框已从建单页移除。
  await expect(
    form.getByRole('textbox', { name: '客户名称/简称', exact: true }),
  ).toHaveCount(0);
  await form
    .getByRole('textbox', { name: '设计款名称', exact: true })
    .fill('超长款式名称珠光艳闪大号封局部烫金高级定制版');
  // DECISIONS 2026-09-24：管理员建单必须挂外部销售，内部建单的「需人工核价的要求」字段随之删除。
  await form
    .getByRole('combobox', { name: '关联外部销售', exact: true })
    .selectOption({ label: 'E2E 销售 · e2e-sales' });

  await form
    .getByRole('button', { name: '添加地址 2', exact: true })
    .click();
  await form
    // 公共粘贴组件（d58f5e79）是受控 textarea，只有 id 没有 name。
    .locator('[id="additionalShipments.0.receiverAddress"]')
    .fill('额外收货地址ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  await form
    .locator('input[name="additionalShipments.0.itemQuantities.0"]')
    .fill('100');
  await expect(
    form.getByRole('heading', { name: '地址 2', exact: true }),
  ).toBeVisible();
}

async function prepareSalesOrderCreationState(page: Page) {
  const form = await prepareConfiguredLocalFoilStyle(page);
  const orderName = '外部销售建单超长工单名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  await form
    .getByRole('textbox', { name: '工单名称', exact: true })
    .fill(orderName);
  // 业主 2026-09-26：外部销售同样填写设计款名称，单款默认跟随工单名称。
  await expect(
    form.getByRole('textbox', { name: '设计款名称', exact: true }),
  ).toHaveValue(orderName);
  await form
    .getByRole('spinbutton', { name: '数量', exact: true })
    .fill('1234567');
  await form
    .getByRole('textbox', { name: '收货地址', exact: true })
    .fill('张三 13800138000 广东省深圳市南山区科技园超长地址压力测试大厦A座12345678901234567890');

  const foilPicker = form.getByRole('group', { name: '烫金颜色' }).first();
  const selectedFoilCount = await foilPicker
    .getByRole('button', { pressed: true })
    .count();
  const configuredFoil = foilPicker
    .getByRole('button', { pressed: false })
    .first();
  await expect(configuredFoil).toBeVisible();
  await configuredFoil.click();
  await expect(
    foilPicker.getByRole('button', { pressed: true }),
  ).toHaveCount(selectedFoilCount + 1);

  const fileName =
    '超长设计图文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png';
  await form.getByLabel('第 1 款 设计图', { exact: true }).setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(
    form.getByRole('img', {
      name: `第 1 款设计图预览：${fileName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(form.getByText(fileName, { exact: false })).toBeVisible();
}

// Shared create form: both roles exercise the same two-level editor.
for (const role of ['owner', 'sales'] as const) {
  test(`${role} design and specification tabs fit light and dark viewports`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    const form = page.locator('[data-slot="order-form-b"]');
    await expect(form).toBeVisible();
    for (let index = 0; index < 3; index++) {
      await form.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
      if (index < 2) await form.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
    }
    const designs = form.getByRole('tablist', { name: '设计款', exact: true });
    const specs = form.getByRole('tablist', { name: '规格明细', exact: true });
    await expect(designs.getByRole('tab')).toHaveCount(3);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate((value) => {
        localStorage.setItem('erp-theme', value);
        document.documentElement.classList.toggle('dark', value === 'dark');
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
      }, theme);
      const design = designs.getByRole('tab').first();
      if (testInfo.project.use.hasTouch) await design.tap();
      else { await design.focus(); await page.keyboard.press('Home'); }
      await expect(design).toHaveAttribute('aria-selected', 'true');
      const specification = specs.getByRole('tab').last();
      if (testInfo.project.use.hasTouch) await specification.tap();
      else { await specs.getByRole('tab').first().focus(); await page.keyboard.press('End'); }
      await expect(specification).toHaveAttribute('aria-selected', 'true');
      await expect(specification).toBeFocused();
      await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(page, testInfo, 'admin', `order-tabs-${role}-${theme}`);
    }
  });
}
