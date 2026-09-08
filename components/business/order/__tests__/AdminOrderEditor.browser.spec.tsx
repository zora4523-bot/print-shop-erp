import { useState, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOrderEditorAuxiliary } from '@/components/business/order/use-order-editor-auxiliary';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  feeSave: vi.fn(),
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
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/orders/order-1/edit',
}));
vi.mock('@/actions/account', () => ({ signOutAction: vi.fn() }));
vi.mock('@/components/business/order/DesignUploadPanel', () => ({
  DesignUploadPanel: ({ canEdit }: { canEdit: boolean }) => (
    <div>
      <p>设计图与 CDR 生产文件</p>
      <Button type="button" disabled={!canEdit}>上传设计文件</Button>
    </div>
  ),
}));
import { AdminOrderEditor } from '../AdminOrderEditor';
import { AdminHeader } from '@/components/business/admin/AdminHeader';
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
function AuxiliaryFeeFixture({ initialAmount = '0.00' }: { initialAmount?: string }) {
  const [amount, setAmount] = useState(initialAmount);
  const [savedAmount, setSavedAmount] = useState('0.00');
  const [pending, setPending] = useState(false);
  const coordination = useOrderEditorAuxiliary({ dirty: amount !== savedAmount, pending });
  return (
    <fieldset disabled={coordination.blocked || pending}>
      <Input aria-label="测试费用金额" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Button type="button" onClick={() => setAmount(savedAmount)}>还原费用输入</Button>
      <Button type="button" onClick={async () => {
        setPending(true);
        try {
          await mocks.feeSave();
          setSavedAmount(amount);
        } finally {
          setPending(false);
        }
      }}>保存测试费用</Button>
    </fieldset>
  );
}
function mount(
  overrides: Partial<ComponentProps<typeof AdminOrderEditor>> = {},
  withShell = false,
) {
  const editor = (
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
      />
  );
  if (withShell) host.className = 'admin-viewport bg-background text-foreground';
  flushSync(() => root.render(withShell ? (
    <SidebarProvider>
      <SidebarInset id="admin-main">
        <AdminHeader {...{
          displayName: '编辑核验管理员',
          roleLabel: '管理员',
          environmentLabel: 'development',
          quickLinks: [],
        }} />
        <div className="admin-safe-inline admin-safe-bottom min-w-0 flex-1 py-4 sm:py-6">
          {editor}
        </div>
      </SidebarInset>
    </SidebarProvider>
  ) : editor));
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
  mocks.feeSave.mockResolvedValue(undefined);
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
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  localStorage.removeItem('erp-theme');
  window.scrollTo(0, 0);
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
    // Inspect the shared confirmation layer after its opening transition settles.
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
      status: 'DRAFT',
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

  it('restores every changed field in a style and returns the draft to clean', async () => {
    mount();
    await page.getByRole('textbox', { name: '第 1 款名称', exact: true }).fill('新款名称');
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await page.getByRole('spinbutton', { name: '包装（个/包）', exact: true }).fill('20');
    await page.getByRole('button', { name: '还原第 1 款', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: '第 1 款名称', exact: true })).toHaveValue('迎春红包');
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toHaveValue(1000);
    await expect.element(page.getByRole('spinbutton', { name: '包装（个/包）', exact: true })).toHaveValue(10);
    await expect.element(page.getByText('未修改', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: '保存修改…', exact: true })).toBeDisabled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('removes an unsaved added style without deleting the existing order style', async () => {
    mount({ canAdd: true, status: 'DRAFT' });
    await page.getByRole('button', { name: '新增款式（沿用第 1 款工艺和纸张）' }).click();
    await page.getByRole('textbox', { name: '第 2 款名称', exact: true }).fill('新增红包');
    await page.getByRole('button', { name: '移除新增款式', exact: true }).click();
    await expect.element(page.getByRole('region', { name: '第 2 款', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('textbox', { name: '第 1 款名称', exact: true })).toHaveValue('迎春红包');
    await expect.element(page.getByRole('button', { name: '保存修改…', exact: true })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('discards the previous quote when returning to edit and saves only the new preview', async () => {
    mount();
    const quantity = page.getByRole('spinbutton', { name: '数量（个）', exact: true });
    await quantity.fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: '确认保存修改' })).toBeVisible();
    await page.getByRole('button', { name: '再改改', exact: true }).click();
    await quantity.fill('3000');
    mocks.preview.mockResolvedValueOnce({
      status: 'preview',
      preview: {
        oldTotal: '180.00',
        newTotal: '510.00',
        quoteToken: 'quote-for-3000',
        priceRevision: 3,
        complete: true,
        changesRevision: true,
        blockers: [],
      },
    });
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.element(page.getByText('保存后 ¥510.00', { exact: true })).toBeVisible();
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', quantity: 2000 },
    ]);
    expect(mocks.preview.mock.calls[1][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', quantity: 3000 },
    ]);
    expect(mocks.preview.mock.calls[1][0].requestId).not.toBe(mocks.preview.mock.calls[0][0].requestId);
    expect(mocks.save).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.poll(() => mocks.save.mock.calls.length).toBe(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 3000 }],
      expectedQuoteToken: 'quote-for-3000',
      expectedPriceRevision: 3,
    });
  });

  it('preserves edits after a save conflict and requires another preview before retrying', async () => {
    mount();
    const quantity = page.getByRole('spinbutton', { name: '数量（个）', exact: true });
    await quantity.fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    mocks.save.mockResolvedValueOnce({ status: 'error', message: '费用规则已更新，请重新预览' });
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.element(page.getByText('费用规则已更新，请重新预览')).toBeVisible();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(quantity).toHaveValue(2000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole('button', { name: '确认保存', exact: true })).toBeEnabled();
  });

  it('shows an incomplete server quote and prevents confirmation without losing the draft', async () => {
    mocks.preview.mockResolvedValueOnce({
      status: 'preview',
      preview: {
        oldTotal: '180.00',
        newTotal: null,
        quoteToken: 'incomplete',
        priceRevision: 2,
        complete: false,
        changesRevision: true,
        blockers: ['未匹配到有效加工价，请维护规则后重新预览'],
      },
    });
    mount();
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.element(page.getByText('未匹配到有效加工价，请维护规则后重新预览')).toBeVisible();
    await expect.element(page.getByRole('button', { name: '确认保存', exact: true })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toHaveValue(2000);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('uses material catalog choices for each foil side and previews distinct selected colors', async () => {
    mount({ foilColors: ['亚金', '红色', '蓝色'] });
    const front = page.getByRole('group', { name: '第 1 款正面烫金', exact: true });
    const back = page.getByRole('group', { name: '第 1 款反面烫金', exact: true });
    await expect.element(front.getByRole('button', { name: '亚金', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(back.getByRole('button', { name: '不烫', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await front.getByRole('button', { name: '红色', exact: true }).click();
    await front.getByRole('button', { name: '更多颜色', exact: true }).click();
    await front.getByRole('button', { name: '蓝色', exact: true }).click();
    await front.getByRole('button', { name: '蓝色', exact: true }).click();
    await back.getByRole('button', { name: '更多颜色', exact: true }).click();
    await back.getByRole('button', { name: '蓝色', exact: true }).click();
    await expect.element(back.getByRole('button', { name: '不烫', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await back.getByRole('button', { name: '不烫', exact: true }).click();
    await expect.element(back.getByRole('button', { name: '蓝色', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      {
        operation: 'UPDATE', itemId: 'item-1',
        frontFoilColors: ['亚金', '红色'], backFoilColors: [],
      },
    ]);
  });

  it('keeps recorded foil visible when it is absent from the current catalog and does not rewrite it', async () => {
    mount({
      foilColors: ['亚金', '红色'],
      items: [{ ...item, frontFoilColors: ['历史金色'] }],
    });
    const recorded = page.getByRole('group', { name: '第 1 款正面烫金', exact: true }).getByRole('button', { name: '历史金色', exact: true });
    await expect.element(recorded).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', quantity: 2000 },
    ]);
  });

  it('prevents selecting a fourth foil color on one side until an existing selection is removed', async () => {
    mount({
      foilColors: ['亚金', '红色', '蓝色', '黑色'],
      items: [{ ...item, frontFoilColors: ['亚金', '红色', '蓝色'] }],
    });
    const front = page.getByRole('group', { name: '第 1 款正面烫金', exact: true });
    await front.getByRole('button', { name: '更多颜色', exact: true }).click();
    await expect.element(front.getByRole('button', { name: '黑色', exact: true })).toBeDisabled();
    await front.getByRole('button', { name: '红色', exact: true }).click();
    await expect.element(front.getByRole('button', { name: '黑色', exact: true })).toBeEnabled();
    await front.getByRole('button', { name: '黑色', exact: true }).click();
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items[0].frontFoilColors).toEqual([
      '亚金', '蓝色', '黑色',
    ]);
  });

  it('keeps compact foil controls large enough to tap on a phone', async () => {
    await page.viewport(393, 852);
    mount({ foilColors: ['亚金', '红色', '蓝色'] });
    for (const side of ['正面', '反面']) {
      const group = page.getByRole('group', { name: `第 1 款${side}烫金`, exact: true });
      await expect.element(group.getByRole('button', { name: '更多颜色', exact: true })).toBeVisible();
      for (const control of group.element().querySelectorAll('button')) {
        const rect = control.getBoundingClientRect();
        expect(rect.width, control.textContent ?? '').toBeGreaterThanOrEqual(44);
        expect(rect.height, control.textContent ?? '').toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('keeps file viewing available but prevents independent file or fee writes while the draft is dirty', async () => {
    mount({ canEditDesigns: true, fees: <Button type="button">核定人工费用</Button> });
    await page.getByRole('button', { name: '设计图 0', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '上传设计文件', exact: true })).toBeEnabled();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await expect.element(page.getByRole('button', { name: '核定人工费用', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '设计图 0', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '上传设计文件', exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '还原第 1 款', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '核定人工费用', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'CDR 0', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '上传设计文件', exact: true })).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('allows renaming a manual-quote style without offering unsupported production edits', async () => {
    mount({
      canAdd: true,
      status: 'DRAFT',
      foilColors: ['亚金', '红色'],
      items: [{ ...item, pricingRoute: 'MANUAL_QUOTE' }],
    });
    await expect.element(page.getByRole('textbox', { name: '第 1 款名称', exact: true })).toBeEnabled();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('spinbutton', { name: '包装（个/包）', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('combobox', { name: '规格', exact: true })).toBeDisabled();
    const foil = page.getByRole('group', { name: '第 1 款正面烫金', exact: true });
    await expect.element(foil.getByRole('button', { name: '红色', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: /新增款式（沿用第/ })).not.toBeInTheDocument();
    await page.getByRole('textbox', { name: '第 1 款名称', exact: true }).fill('人工核价旧款');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', name: '人工核价旧款' },
    ]);
  });

  it('allows changing existing foil on a color-print style while preserving at least one color', async () => {
    mount({
      foilColors: ['亚金', '红色'],
      items: [{ ...item, pricingRoute: 'COLOR_PRINT' }],
    });
    const front = page.getByRole('group', { name: '第 1 款正面烫金', exact: true });
    await expect.element(front.getByRole('button', { name: '亚金', exact: true })).toBeDisabled();
    await expect.element(front.getByRole('button', { name: '红色', exact: true })).toBeEnabled();
    await front.getByRole('button', { name: '红色', exact: true }).click();
    await front.getByRole('button', { name: '亚金', exact: true }).click();
    await expect.element(front.getByRole('button', { name: '红色', exact: true })).toBeDisabled();
    await expect.element(front.getByRole('button', { name: '不烫', exact: true })).not.toBeInTheDocument();
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', frontFoilColors: ['红色'], backFoilColors: [] },
    ]);
  });

  it('keeps pure color-print foil disabled while allowing supported quantity changes', async () => {
    mount({
      foilColors: ['亚金', '红色'],
      items: [{ ...item, pricingRoute: 'COLOR_PRINT', frontFoilColors: [], backFoilColors: [] }],
    });
    for (const side of ['正面', '反面']) {
      const group = page.getByRole('group', { name: `第 1 款${side}烫金`, exact: true });
      await expect.element(group.getByRole('button', { name: '亚金', exact: true })).toBeDisabled();
      await expect.element(group.getByRole('button', { name: '不烫', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      { operation: 'UPDATE', itemId: 'item-1', quantity: 2000 },
    ]);
  });

  it('uses a supported style as the new-style template when the first style uses manual pricing', async () => {
    mount({
      canAdd: true,
      status: 'DRAFT',
      items: [
        { ...item, id: 'manual-item', name: '旧版人工款', pricingRoute: 'MANUAL_QUOTE' },
        { ...item, sequence: 2 },
      ],
    });
    await page.getByRole('button', { name: /新增款式（沿用第/ }).click();
    await page.getByRole('textbox', { name: '第 3 款名称', exact: true }).fill('新增自动计价款');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0].items).toEqual([
      expect.objectContaining({ operation: 'ADD', templateItemId: 'item-1', name: '新增自动计价款' }),
    ]);
  });

  for (const status of ['SUBMITTED', 'CONFIRMED'] as const) {
    it(`${status}: does not offer a new style whose design files cannot be uploaded at this stage`, async () => {
      mount({ status, canAdd: true });
      await expect.element(page.getByRole('button', { name: /新增款式（沿用第/ })).not.toBeInTheDocument();
      await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toBeEnabled();
      expect(mocks.preview).not.toHaveBeenCalled();
    });
  }

  it('protects unsaved fee input from main edits, file writes, and the return action until it is restored', async () => {
    mount({ canEditDesigns: true, fees: <AuxiliaryFeeFixture /> });
    await page.getByRole('textbox', { name: '测试费用金额', exact: true }).fill('30.00');
    await expect.element(page.getByText('费用有未保存修改', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('textbox', { name: '工单名称' })).toBeDisabled();
    await page.getByRole('button', { name: '设计图 0', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '上传设计文件', exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '返回工单', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true })).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: '测试费用金额', exact: true })).toHaveValue('30.00');
    await page.getByRole('button', { name: '还原费用输入', exact: true }).click();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toBeEnabled();
    await expect.element(page.getByText('未修改', { exact: true })).toBeVisible();
    expect(mocks.feeSave).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('captures a complete metadata baseline after initially dirty auxiliary fees are restored', async () => {
    mount({ fees: <AuxiliaryFeeFixture initialAmount="30.00" /> });
    await expect.element(page.getByRole('textbox', { name: '工单名称' })).toBeDisabled();
    await page.getByRole('button', { name: '还原费用输入', exact: true }).click();
    await page.getByRole('textbox', { name: '工单名称' }).fill('只改了工单名称');
    await expect.element(page.getByText('已改 1 处', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect.poll(() => mocks.preview.mock.calls.length).toBe(1);
    expect(mocks.preview.mock.calls[0][0]).toMatchObject({
      items: [],
      fields: { customName: '只改了工单名称', expectedEditVersion: '4' },
    });
    expect(Object.keys(mocks.preview.mock.calls[0][0].fields).sort()).toEqual(['customName', 'expectedEditVersion']);
  });

  it('blocks main edits and leaving while an auxiliary fee save is pending, then restores the main baseline', async () => {
    let finishFeeSave: (() => void) | undefined;
    mocks.feeSave.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFeeSave = resolve; }));
    mount({ fees: <AuxiliaryFeeFixture /> });
    await page.getByRole('textbox', { name: '测试费用金额', exact: true }).fill('30.00');
    try {
      await page.getByRole('button', { name: '保存测试费用', exact: true }).click();
      await expect.element(page.getByText('费用处理中…', { exact: true })).toBeVisible();
      await expect.element(page.getByRole('button', { name: '返回工单', exact: true })).toBeDisabled();
      await expect.element(page.getByRole('textbox', { name: '工单名称' })).toBeDisabled();
      await expect.element(page.getByText('存在待审批申请', { exact: true })).not.toBeInTheDocument();
    } finally {
      finishFeeSave?.();
    }
    await expect.element(page.getByRole('textbox', { name: '工单名称' })).toBeEnabled();
    await page.getByRole('textbox', { name: '工单名称' }).fill('费用完成后改名');
    await expect.element(page.getByText('已改 1 处', { exact: true })).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('locks duplicate previews without reporting a nonexistent pending approval', async () => {
    let finishPreview: (() => void) | undefined;
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => {
      finishPreview = () => resolve({ status: 'error', message: '预览请求已结束' });
    }));
    mount();
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    try {
      await page.getByRole('button', { name: '保存修改…', exact: true }).click();
      await expect.element(page.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
      await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toBeDisabled();
      await expect.element(page.getByText('存在待审批申请', { exact: true })).not.toBeInTheDocument();
      expect(mocks.preview).toHaveBeenCalledTimes(1);
    } finally {
      finishPreview?.();
    }
    await expect.element(page.getByText('预览请求已结束', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toHaveValue(2000);
    await expect.element(page.getByRole('button', { name: '保存修改…', exact: true })).toBeEnabled();
  });

  it('keeps the review open and prevents duplicate confirmation while saving', async () => {
    let finishSave: (() => void) | undefined;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = () => resolve({ status: 'error', message: '本次保存未完成，请重新核对' });
    }));
    mount();
    await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    const review = page.getByRole('dialog', { name: '确认保存修改', exact: true });
    try {
      await page.getByRole('button', { name: '确认保存', exact: true }).click();
      await expect.element(page.getByRole('button', { name: '保存中…', exact: true })).toBeDisabled();
      await expect.element(page.getByRole('button', { name: '再改改', exact: true })).toBeDisabled();
      await userEvent.keyboard('{Escape}');
      await expect.element(review).toBeVisible();
      expect(mocks.save).toHaveBeenCalledTimes(1);
    } finally {
      finishSave?.();
    }
    await expect.element(page.getByText('本次保存未完成，请重新核对', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toHaveValue(2000);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  for (const [width, height] of [[393, 852], [1440, 1000]]) {
    it(`${width}×${height}: saving opens a bottom confirmation layer and Escape retains the draft`, async () => {
      await page.viewport(width, height);
      mount();
      await page.getByRole('spinbutton', { name: '数量（个）', exact: true }).fill('2000');
      const save = page.getByRole('button', { name: '保存修改…', exact: true });
      await save.click();
      const dialog = page.getByRole('dialog', { name: '确认保存修改', exact: true });
      await expect.element(dialog).toBeVisible();
      await expect.poll(() => dialog.element().hasAttribute('data-starting-style')).toBe(false);
      await expect.poll(() => dialog.element().getAnimations().filter((animation) => animation.playState === 'running').length).toBe(0);
      const rect = dialog.element().getBoundingClientRect();
      expect(rect.bottom).toBeCloseTo(height, 0);
      expect(rect.width).toBeLessThanOrEqual(Math.min(620, width));
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
      expect(await commands.checkShellAccessibility('[role="dialog"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(page.getByRole('spinbutton', { name: '数量（个）', exact: true })).toHaveValue(2000);
      await expect.element(save).toHaveFocus();
      expect(mocks.save).not.toHaveBeenCalled();
    });

    it(`${width}×${height}: scrolling the editor preserves visible, clickable shell controls`, async () => {
      await page.viewport(width, height);
      mount({}, true);
      await expect.element(page.getByRole('heading', { name: '编辑工单', exact: true })).toBeVisible();
      const shellHeader = host.querySelector<HTMLElement>('[data-slot="admin-header"]')!;
      const editorHeader = host.querySelector<HTMLElement>('#admin-main header:not([data-slot="admin-header"])')!;
      window.scrollTo(0, 400);
      await expect.poll(() => window.scrollY).toBeGreaterThan(100);
      await expect.poll(() => editorHeader.getBoundingClientRect().top).toBeGreaterThanOrEqual(shellHeader.getBoundingClientRect().bottom);
      // Safe-area or enlarged text can change the shared header's actual height.
      shellHeader.style.minHeight = '88px';
      await expect.poll(() => shellHeader.getBoundingClientRect().height).toBeGreaterThanOrEqual(88);
      await expect.poll(() => editorHeader.getBoundingClientRect().top).toBeGreaterThanOrEqual(shellHeader.getBoundingClientRect().bottom);
      const account = page.getByRole('button', { name: '用户菜单：编辑核验管理员', exact: true });
      const accountRect = account.element().getBoundingClientRect();
      const hit = document.elementFromPoint(accountRect.left + accountRect.width / 2, accountRect.top + accountRect.height / 2);
      expect(account.element().contains(hit)).toBe(true);
      await account.click();
      await expect.element(page.getByRole('menuitem', { name: '修改密码', exact: true })).toBeVisible();
      await userEvent.keyboard('{Escape}');
    });
  }
});
