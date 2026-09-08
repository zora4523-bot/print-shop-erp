import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/actions/admin-order-edit', () => ({
  previewAdminOrderEditAction: mocks.preview,
  saveAdminOrderEditAction: mocks.save,
}));
vi.mock('@/actions/order', () => ({
  updateOrderAction: vi.fn(),
  previewOrderChangeRequestPricingAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('../DesignUploadPanel', () => ({
  DesignUploadPanel: () => <p>设计图与 CDR 生产文件</p>,
}));
import { AdminOrderEditor } from '../AdminOrderEditor';
let host: HTMLDivElement;
let root: Root;
const item = {
  id: 'item-1',
  sequence: 1,
  name: '迎春红包',
  quantity: 1000,
  pack: 10,
  productId: null,
  pricingRoute: 'STOCK_BLANK' as const,
  specification: '大号封',
  paperType: '珠光艳闪',
  paperWeightGsm: 160,
  frontFoilColors: ['亚金'],
  backFoilColors: [],
  subtotal: '180.00',
  packagingEditable: true,
  designs: [],
};
function mount(
  overrides: Partial<ComponentProps<typeof AdminOrderEditor>> = {},
) {
  flushSync(() =>
    root.render(
      <AdminOrderEditor
        orderId="order-1"
        orderNo="GD-260908-001"
        status="SUBMITTED"
        revision={1}
        workOrderVersion={1}
        items={[item]}
        products={[]}
        canModify
        canAdd={false}
        productionLocked={false}
        canEditDesigns={false}
        fees={<p>当前金额 ¥180.00</p>}
        form={{
          orderId: 'order-1',
          expectedEditVersion: 4,
          fieldset: 'FULL',
          isExternalSales: true,
          initial: {
            customName: '迎春红包',
            customerRef: '老客户',
            packageRequirement: '',
            remark: '',
            promisedDate: '2026-10-01',
            isUrgent: true,
            receiverAddress: '',
            expressCode: '',
          },
          shipments: [
            {
              id: 'shipment-1',
              sequence: 1,
              status: 'PLANNED',
              receiverName: '张三',
              receiverPhone: '13800138000',
              receiverAddress: '广东省佛山市测试路',
              expressCode: null,
              destinationProvince: '广东',
            },
          ],
          externalSalesAssociation: {
            current: {
              id: 'sales-1',
              displayName: '外部销售张先生',
              username: 'zhang',
            },
            options: [
              {
                id: 'sales-1',
                displayName: '外部销售张先生',
                username: 'zhang',
              },
            ],
            blockedReason: null,
          },
        }}
        {...overrides}
      />,
    ),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue({
    status: 'preview',
    preview: {
      oldTotal: '180.00',
      newTotal: '340.00',
      quoteToken: 'quote-1',
      priceRevision: 2,
      complete: true,
      changesRevision: true,
      blockers: [],
    },
  });
  mocks.save.mockResolvedValue({ status: 'saved' });
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  host.dataset.testid = 'admin-edit-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
describe('administrator edit design', () => {
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ]) {
    for (const theme of ['light', 'dark'])
      it(`${width}×${height} ${theme}: usable controls and no overflow`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        mount();
        await expect
          .element(page.getByRole('heading', { name: '编辑工单', exact: true }))
          .toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const element of host.querySelectorAll<HTMLElement>(
          'button, input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea',
        )) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await commands.checkShellAccessibility(
            '[data-testid="admin-edit-fixture"]',
          ),
        ).toEqual([]);
      });
  }
  it('previews changed quantities and packaging together, then confirms the server quote', async () => {
    mount();
    await page
      .getByRole('spinbutton', { name: '数量（个）', exact: true })
      .fill('2000');
    await page
      .getByRole('spinbutton', { name: '包装（个/包）', exact: true })
      .fill('20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    expect(mocks.preview.mock.calls[0][0]).toMatchObject({
      items: [
        { operation: 'UPDATE', itemId: 'item-1', quantity: 2000, pack: 20 },
      ],
      fields: { expectedEditVersion: '4' },
    });
    expect(mocks.preview.mock.calls[0][0].fields.isUrgent).toBeUndefined();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.poll(() => mocks.save.mock.calls.length).toBe(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      expectedQuoteToken: 'quote-1',
      expectedPriceRevision: 2,
    });
  });
  it('tracks urgent changes, preserves metadata on errors, and restores undo state', async () => {
    mount();
    await page.getByRole('checkbox', { name: '标记为急单' }).click();
    await expect
      .element(page.getByText('已改 1 处', { exact: true }))
      .toBeVisible();
    mocks.preview.mockResolvedValueOnce({
      status: 'error',
      message: '工单已被其他人修改，请刷新页面后再编辑',
    });
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect
      .element(page.getByText('工单已被其他人修改，请刷新页面后再编辑'))
      .toBeVisible();
    expect(mocks.preview.mock.calls[0][0].fields.isUrgent).toBe('false');
    await page.getByRole('checkbox', { name: '标记为急单' }).click();
    await expect
      .element(page.getByRole('button', { name: '保存修改…', exact: true }))
      .toBeDisabled();
  });
  it('requires a fresh quote after entering pending freight', async () => {
    await page.viewport(375, 667);
    const charge = {
      businessKey: 'SHIPMENT:1:SHIPPING_FEE',
      categoryCode: 'SHIPPING_FEE',
      shipmentId: 'shipment-1',
      shipmentSequence: 1,
      destinationProvince: '广东',
      projectedQuantity: 2000,
      description: '物流费待核',
      errors: [],
      amount: null,
      reason: null,
    };
    mocks.preview.mockResolvedValueOnce({
      status: 'preview',
      preview: {
        oldTotal: '180.00',
        newTotal: null,
        quoteToken: 'pending',
        priceRevision: 2,
        complete: false,
        changesRevision: true,
        blockers: [],
        pendingCharges: [charge],
      },
    });
    mount();
    await page
      .getByRole('spinbutton', { name: '数量（个）', exact: true })
      .fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await page.getByRole('textbox', { name: '第 1 票运费金额' }).fill('30.00');
    // The shared dialog animates its opening scale. Inspect its settled hit areas.
    await expect
      .poll(
        () =>
          document
            .querySelector('[role="dialog"]')
            ?.getAnimations()
            .filter((animation) => animation.playState === 'running').length ??
          0,
      )
      .toBe(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    for (const control of dialog.querySelectorAll('button, input, textarea')) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByRole('textbox', { name: '第 1 票运费依据' })
      .fill('物流商报价单');
    await expect
      .element(page.getByRole('button', { name: '确认保存', exact: true }))
      .toBeDisabled();
    mocks.preview.mockResolvedValueOnce({
      status: 'preview',
      preview: {
        oldTotal: '180.00',
        newTotal: '370.00',
        quoteToken: 'resolved',
        priceRevision: 2,
        complete: true,
        changesRevision: true,
        blockers: [],
        pendingCharges: [
          { ...charge, amount: '30.00', reason: '物流商报价单' },
        ],
      },
    });
    await page.getByRole('button', { name: '补齐运费并重新核价' }).click();
    await expect
      .element(page.getByRole('button', { name: '确认保存', exact: true }))
      .toBeEnabled();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.poll(() => mocks.save.mock.calls.length).toBe(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      expectedQuoteToken: 'resolved',
      pendingChargeResolutions: [
        {
          amount: '30.00',
          reason: '物流商报价单',
          expectedProjectedQuantity: 2000,
        },
      ],
    });
  });
  it('retains a different specification on an added style using the same product', async () => {
    mount({
      canAdd: true,
      items: [
        { ...item, productId: 'product-1', specification: '大号封90×165' },
      ],
      products: [
        {
          id: 'product-1',
          category: 'BLANK_STOCK',
          specification: '大号封90×165 / 中号封80×115',
          paperType: '160g珠光艳闪',
          weight: 160,
          isActive: true,
        },
      ],
    });
    await page
      .getByRole('button', { name: '新增款式（沿用第 1 款工艺和纸张）' })
      .click();
    await page
      .getByRole('textbox', { name: '第 2 款名称', exact: true })
      .fill('中号红包');
    await page
      .getByRole('combobox', { name: '规格', exact: true })
      .nth(1)
      .selectOptions(
        page
          .getByRole('combobox', { name: '规格', exact: true })
          .nth(1)
          .getByRole('option', { name: '中号封80×115', exact: true }),
      );
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      expect.objectContaining({
        operation: 'ADD',
        templateItemId: 'item-1',
        targetProductId: 'product-1',
        specification: '中号封80×115',
        name: '中号红包',
      }),
    ]);
  });
  it('asks before discarding a changed draft', async () => {
    mount();
    await page
      .getByRole('spinbutton', { name: '数量（个）', exact: true })
      .fill('2000');
    await page.getByRole('button', { name: '放弃', exact: true }).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect
      .element(
        page.getByRole('spinbutton', { name: '数量（个）', exact: true }),
      )
      .toHaveValue(2000);
  });
});
