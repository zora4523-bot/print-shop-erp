import { test, expect } from '@playwright/test';
import {
  cleanupAutoCodePartyFixture,
  cleanupSearchSmokeFixtures,
  E2E_PASSWORD,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedSearchSmokeFixtures,
  uniqueSuffix,
} from './_helpers';
import {
  RULE_CENTER_HREFS,
  RULE_CENTER_SIDEBAR_ITEMS,
} from '../../lib/navigation/rule-center';

test.describe('automation smoke', () => {
  test.afterAll(async () => {
    await cleanupSearchSmokeFixtures();
  });

  test('protected routes redirect unauthenticated users to /login', async ({
    page,
  }) => {
    for (const path of [
      '/owner/pigsty',
      RULE_CENTER_HREFS.root,
      '/orders?q=CODX-E2E-ORDER-001',
      '/foreman/materials?q=CODX-E2E-MAT-001',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    }
  });

  test('ADMIN uses direct rule-center sidebar entries and canonical rule pages', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await login(page, {
      from: RULE_CENTER_HREFS.root,
      username: E2E_USERS.owner.username,
      password: E2E_PASSWORD,
    });

    await expect(page).toHaveURL((url) =>
      url.pathname === RULE_CENTER_HREFS.root,
    );
    await expect(
      page.getByRole('heading', {
        name: '规则配置中心',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '客户计价规则' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '建单主数据' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '员工薪酬规则' })).toBeVisible();

    const priceSidebarEntries = [
      [
        '空白封单价',
        '/owner/rules/customer-pricing?section=blank',
        '局部烫金 · 空白封现货单价',
      ],
      [
        '局部烫金机烫费',
        '/owner/rules/customer-pricing?section=machine',
        '局部烫金 · 机烫费与制版费',
      ],
      [
        '专版烫金单价',
        '/owner/rules/customer-pricing?section=tiers',
        '专版烫金 · 阶梯单价',
      ],
      [
        '专版烫金加价',
        '/owner/rules/customer-pricing?section=adds',
        '专版烫金 · 加价',
      ],
      [
        '彩印阶梯价',
        '/owner/rules/customer-pricing?section=print',
        '彩印阶梯总价',
      ],
      [
        '包装与快递',
        '/owner/rules/customer-pricing?purpose=logistics&section=ship',
        '包装 · 纸箱耗材 · 中通快递',
      ],
    ] as const;
    await expect(
      page.getByRole('navigation', { name: '规则配置工作区导航' }),
    ).toHaveCount(0);
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(
      sidebar.locator('[data-menu-group="概览"]'),
    ).toHaveCount(0);
    const dashboardLink = sidebar.getByRole('link', {
      name: '工作台',
      exact: true,
    });
    await expect(dashboardLink).toHaveCount(1);
    await expect(dashboardLink).toHaveAttribute('href', '/owner');
    const ruleRootItem = RULE_CENTER_SIDEBAR_ITEMS.find(
      (item) => !('menuParentId' in item),
    );
    const ruleChildItems = RULE_CENTER_SIDEBAR_ITEMS.filter(
      (item) => 'menuParentId' in item,
    );
    if (!ruleRootItem) throw new Error('规则配置中心父菜单缺失');

    for (const item of RULE_CENTER_SIDEBAR_ITEMS) {
      const entry = sidebar.getByRole('link', {
        name: item.label,
        exact: true,
      });
      await expect(entry).toHaveCount(1);
      await expect(entry).toHaveAttribute('href', item.href);
    }

    const ruleParentLink = sidebar.getByRole('link', {
      name: ruleRootItem.label,
      exact: true,
    });
    const ruleParent = sidebar.locator(
      '[data-menu-level="parent"]:has(a[href="/owner/rules"])',
    );
    const ruleSubmenu = ruleParent.locator('[data-sidebar="menu-sub"]');
    await expect(ruleParent).toHaveCount(1);
    await expect(ruleSubmenu).toHaveCount(1);
    await expect(ruleParentLink).toHaveAttribute('aria-current', 'page');
    await expect(ruleParent).not.toHaveAttribute('data-has-active-child');

    await page.goto('/owner/rules/customer-pricing?section=blank');
    await expect(
      page.getByRole('heading', {
        name: '局部烫金 · 空白封现货单价',
        exact: true,
      }),
    ).toBeVisible();
    await expect(ruleParentLink).not.toHaveAttribute('aria-current', 'page');
    await expect(ruleParent).toHaveAttribute('data-has-active-child', 'true');
    await expect(
      ruleSubmenu.getByRole('link', {
        name: '空白封单价',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      ruleSubmenu.getByRole('link', { name: '客户计价', exact: true }),
    ).toHaveCount(0);
    await expect(
      ruleSubmenu.getByRole('link', { name: '可建单产品组合', exact: true }),
    ).toHaveCount(0);
    for (const groupLabel of [
      '客户计价规则',
      '建单主数据',
      '员工薪酬规则',
    ]) {
      await expect(
        ruleSubmenu.locator(`[data-menu-subgroup="${groupLabel}"]`).first(),
      ).toBeVisible();
    }
    for (const redundantGroupLabel of ['客户计价规则', '建单主数据']) {
      await expect(
        ruleSubmenu.getByText(redundantGroupLabel, { exact: true }),
      ).toHaveCount(0);
    }
    for (const oldGroupLabel of ['对客计价', '基础事实', '内部结算']) {
      await expect(ruleSubmenu.getByText(oldGroupLabel, { exact: true })).toHaveCount(0);
    }
    for (const child of ruleChildItems) {
      await expect(
        ruleSubmenu.getByRole('link', { name: child.label, exact: true }),
      ).toHaveAttribute('href', child.href);
    }

    // 规则分组只显示父入口，子菜单使用专属开关。
    await expect(sidebar.getByRole('button', { name: /^规则 (收起|展开)$/, exact: true })).toHaveCount(0);
    const ruleToggle = () => ruleParent.getByRole('button', { name: /规则配置中心子菜单/ });
    await expect(ruleToggle()).toHaveAttribute('aria-expanded', 'true');
    await ruleToggle().click();
    await expect(ruleToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect(ruleSubmenu).not.toBeVisible();
    await expect(ruleParentLink).toBeVisible();
    await ruleToggle().click();
    await expect(ruleToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(ruleSubmenu).toBeVisible();
    await expect(
      sidebar.locator(
        [
          'a[href="/owner/prices"]',
          'a[href="/owner/prices/external-sales/items"]',
          'a[href="/owner/salary/piecework-rules"]',
          'a[href="/owner/salary/rules"]',
        ].join(','),
      ),
    ).toHaveCount(0);

    const canonicalPages = [
      ...priceSidebarEntries.map(([label, path, heading]) => ({
        label,
        path,
        navPath: path,
        heading,
      })),
      {
        label: '价格版本',
        path: RULE_CENTER_HREFS.priceVersions,
        navPath: RULE_CENTER_HREFS.priceVersions,
        // 2026-09-13 价格版本页重排后标题统一为「价格版本」（docs/价格版本页面-20260913.md）。
        heading: '价格版本',
      },
      {
        label: '员工薪酬规则',
        path: RULE_CENTER_HREFS.employeePay,
        navPath: RULE_CENTER_HREFS.employeePay,
        heading: '员工工资规则',
      },
    ] as const;

    for (const route of canonicalPages) {
      await expect(
        sidebar.getByRole('link', {
          name: route.label,
          exact: true,
        }),
      ).toHaveAttribute('href', route.navPath);
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', {
          name: route.heading,
          exact: true,
        }).first(),
      ).toBeVisible();
      await expect(
        ruleSubmenu.getByRole('link', {
          name: route.label,
          exact: true,
        }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        ruleSubmenu.locator('a[aria-current="page"]'),
      ).toHaveCount(1);
      await expect(
        page.getByRole('navigation', { name: '规则配置工作区导航' }),
      ).toHaveCount(0);
      if (route.path.startsWith(RULE_CENTER_HREFS.customerPricing)) {
        await expect(
          page.getByRole('navigation', { name: '客户计价规则类型' }),
        ).toHaveCount(0);
      }
      await expectNoNextErrorOverlay(page);
    }

    const activePayLink = sidebar.getByRole('link', {
      name: '员工薪酬规则',
      exact: true,
    });
    await expect(activePayLink).toHaveAttribute('aria-current', 'page');
    await expect(ruleParentLink).not.toHaveAttribute('aria-current', 'page');
    await expect(ruleParent).toHaveAttribute('data-has-active-child', 'true');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RULE_CENTER_HREFS.root);
    await expect(page).toHaveURL((url) =>
      url.pathname === RULE_CENTER_HREFS.root,
    );
    await expect(
      page.getByRole('navigation', { name: '规则配置工作区导航' }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: '打开/关闭侧边栏菜单' })
      .click();
    const mobileSidebar = page.locator(
      '[data-sidebar="sidebar"][data-mobile="true"]',
    );
    await expect(mobileSidebar).toBeVisible();
    await expect(
      mobileSidebar.locator('[data-menu-group="概览"]'),
    ).toHaveCount(0);
    await expect(
      mobileSidebar.getByRole('link', {
        name: '工作台',
        exact: true,
      }),
    ).toHaveAttribute('href', '/owner');
    const mobileRuleParent = mobileSidebar.locator(
      '[data-menu-level="parent"]:has(a[href="/owner/rules"])',
    );
    await expect(
      mobileRuleParent.locator('[data-sidebar="menu-sub"]'),
    ).toHaveCount(1);
    await expect(
      mobileSidebar.getByRole('link', { name: '空白封单价', exact: true }),
    ).toHaveAttribute(
      'href',
      '/owner/rules/customer-pricing?section=blank',
    );
    await expect(
      mobileSidebar.getByRole('link', { name: '规则配置中心', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      mobileSidebar.getByRole('link', { name: '可建单产品组合', exact: true }),
    ).toHaveCount(0);
    await expect(
      mobileSidebar.getByRole('link', { name: '客户计价', exact: true }),
    ).toHaveCount(0);
    await mobileSidebar
      .getByRole('link', { name: '价格版本', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${RULE_CENTER_HREFS.priceVersions}$`));
    await expect(mobileSidebar).toBeHidden();
  });

  test('ADMIN can open Pigsty readiness and search core ERP surfaces', async ({
    page,
  }) => {
    test.setTimeout(45_000);

    const ownerId = await getUserIdByUsername(E2E_USERS.owner.username);
    const fixture = await seedSearchSmokeFixtures({ ownerId });

    await login(page, {
      from: '/owner/pigsty',
      username: E2E_USERS.owner.username,
      password: E2E_PASSWORD,
    });

    await expect(page.getByRole('heading', { name: 'Pigsty 运维' })).toBeVisible();
    await expect(page.getByText('搜索索引预检')).toBeVisible();
    await expect(page.getByText('pg_pinyin').first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`${RULE_CENTER_HREFS.productReferences}?q=${fixture.productCode}`);
    await expect(page.getByText(fixture.productCode)).toBeVisible();
    await expect(page.getByText(fixture.productName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/product-categories');
    await expect(
      page.getByRole('heading', { name: '产品结构分类 / 用料清单分类' }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: '空白现货' }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/boms');
    await expect(page.getByRole('heading', { name: '用料清单' })).toBeVisible();
    await expect(page.getByText('Codex E2E 标准 BOM')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/boms/new');
    await expect(page.getByRole('heading', { name: '新建用料清单' })).toBeVisible();
    await expect(page.getByLabel('用料清单名称')).toBeVisible();
    await expect(page.getByRole('combobox', { name: '物料', exact: true }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/owner/parties?q=${fixture.partyCode}`);
    await expect(page.getByRole('heading', { name: '客户/供应商' })).toBeVisible();
    await expect(page.getByText(fixture.partyCode)).toBeVisible();
    await expect(page.getByText(fixture.partyName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/parties/new');
    await expect(page.getByRole('heading', { name: '新建客户/供应商' })).toBeVisible();
    await expect(
      page.getByText('高级设置：自定义客户/供应商编码（通常无需填写）'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(
      '/owner/parties/new?type=SUPPLIER&returnTo=%2Fowner%2Fpurchases%2Fnew',
    );
    await page
      .getByText('高级设置：自定义客户/供应商编码（通常无需填写）')
      .click();
    await page
      .getByLabel('自定义编码（选填）')
      .fill(fixture.supplierPartyCode.toLowerCase());
    await page.getByLabel('名称', { exact: true }).fill('重复供应商回归');
    await page.getByRole('button', { name: '创建客户/供应商' }).click();
    await expect(
      page.getByText('该客户/供应商编码已被占用', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/owner\/parties\/new\?/);
    await expectNoNextErrorOverlay(page);

    const autoSupplierName = `Codex E2E 自动编码供应商 ${uniqueSuffix()}`;
    let autoSupplierId: string | null = null;
    try {
      await page.goto(
        '/owner/parties/new?type=SUPPLIER&returnTo=%2Fowner%2Fpurchases%2Fnew',
      );
      await page.getByLabel('名称', { exact: true }).fill(autoSupplierName);
      await page.getByRole('button', { name: '创建客户/供应商' }).click();
      await page.waitForURL((url) => {
        autoSupplierId = url.searchParams.get('supplierPartyId');
        return url.pathname === '/owner/purchases/new' && Boolean(autoSupplierId);
      });

      // 新建供应商跳回时顶部有「供应商已创建」回执（aria-labelledby），按精确标签取下拉框。
      const supplierSelect = page.getByLabel('供应商', { exact: true });
      await expect(supplierSelect.locator('option:checked')).toHaveText(/^PTY-\d{6} · Codex E2E 自动编码供应商 /);
      await expect(supplierSelect).toHaveValue(autoSupplierId!);
      await expectNoNextErrorOverlay(page);
    } finally {
      if (autoSupplierId) {
        await cleanupAutoCodePartyFixture({
          partyId: autoSupplierId,
          expectedName: autoSupplierName,
        });
      }
    }

    await page.goto('/owner/purchases');
    await expect(
      page.getByRole('heading', { name: '采购单', exact: true }),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/purchases/new');
    await expect(page.getByRole('heading', { name: '新建采购单' })).toBeVisible();
    const supplierSelect = page.getByRole('combobox', { name: '供应商', exact: true });
    await expect(supplierSelect).toBeVisible();
    await expect(supplierSelect).toContainText(fixture.supplierPartyCode);
    await supplierSelect.selectOption(fixture.supplierPartyId);
    await expect(supplierSelect).toHaveValue(fixture.supplierPartyId);
    await expect(page.getByRole('combobox', { name: '物料', exact: true })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/warehouses');
    await expect(page.getByRole('heading', { name: '仓库/库位' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '采购待收货' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '最近库存流水' })).toBeVisible();
    await expect(page.getByText('库存一致性', { exact: true })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/orders/new');
    await expect(page.getByRole('heading', { name: '新建工单' })).toBeVisible();
    // DECISIONS 2026-09-13：管理员创建不再录入工单客户及简称，关联客户与简称控件已从建单页移除。
    await expect(page.getByRole('combobox', { name: '关联客户（选填）', exact: true })).toHaveCount(0);
    await expect(page.locator('input[name="customerRef"]')).toHaveCount(0);
    await expect(page.locator('input[name="receiverName"]')).toHaveCount(0);
    await expect(page.locator('input[name="receiverPhone"]')).toHaveCount(0);
    const receiverAddress = page.getByRole('textbox', {
      name: '收货地址',
      exact: true,
    });
    await expect(receiverAddress).toBeVisible();
    await expect(receiverAddress).toHaveAttribute('required', '');
    await expectNoNextErrorOverlay(page);

    // The admin workspace defaults to the actionable TODO queue. This search
    // fixture is intentionally a DRAFT, so search it through the explicit
    // all-orders queue rather than weakening the queue boundary.
    await page.goto(`/orders?queue=all&q=${fixture.orderNo}`);
    await expect(
      page
        .locator('[data-sidebar="sidebar"]')
        .getByRole('link', { name: '采购单' }),
    ).toBeVisible();
    const matchedOrder = page
      .locator(`[data-order-id="${fixture.orderId}"]:visible`)
      .first();
    await expect(matchedOrder).not.toContainText(fixture.orderNo);
    // 工厂列表按业务员识别对接人；客户已退役（业主 2026-09-27），既不展示也不参与搜索。
    await expect(matchedOrder).toContainText(`业务员：${E2E_USERS.owner.displayName}`);
    await expectNoNextErrorOverlay(page);

    // Name links go directly to full detail; Back restores the filtered list.
    await matchedOrder.getByRole('heading').getByRole('link').click();
    await expect(page).toHaveURL(`/orders/${fixture.orderId}`);
    await expect(page.locator('[data-testid="admin-order-detail"]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/orders' && url.searchParams.get('q') === fixture.orderNo && !url.hash);
    await expect(matchedOrder).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoNextErrorOverlay(page);

    await page.goto(`/orders/${fixture.orderId}`);
    await expect(page.getByRole('heading', { name: '物料用量估算' })).toBeVisible();
    await expect(page.getByText('Codex E2E 标准 BOM')).toBeVisible();
    await expect(
      page.getByText(`${fixture.materialCode} · ${fixture.materialName}`, {
        exact: true,
      }),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/foreman/materials?q=${fixture.materialCode}`);
    // 73e1b5d9（2026-09-13）：库存列表不再展示物料编码，但按编码搜索仍命中目标物料。
    await expect(page.getByText(fixture.materialName)).toBeVisible();
    await expect(page.getByText(fixture.materialCode)).toHaveCount(0);
    await expectNoNextErrorOverlay(page);

    await page.goto(`${RULE_CENTER_HREFS.papers}?q=${fixture.materialCode}`);
    await expect(
      page.getByRole('heading', { name: '纸张', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(fixture.materialCode)).toBeVisible();
    await expect(page.getByText(fixture.materialName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/materials/count');
    await expect(page.getByRole('heading', { name: '库存盘点' })).toBeVisible();
    await page
      .getByPlaceholder('搜索物料编码、名称、规格、拼音')
      .fill(fixture.materialCode);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(fixture.materialCode)).toBeVisible();
    await page
      .getByLabel(`${fixture.materialName} 实盘数`)
      .fill(String(Number(fixture.materialCurrentStock) + 1));
    await expect(page.getByText('+1.00 张')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`${RULE_CENTER_HREFS.papers}?q=${fixture.materialCode}`);
    await page
      .getByRole('link', {
        name: `编辑纸张：${fixture.materialName}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', {
        name: `编辑纸张：${fixture.materialName}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText('库存出入库')).toBeVisible();
    await expect(page.getByRole('heading', { name: '库位库存' })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/materials/new');
    await expect(page.getByRole('heading', { name: '新建物料' })).toBeVisible();
    await expect(
      page.getByText('高级设置：自定义物料编码（通常无需填写）'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });
});
