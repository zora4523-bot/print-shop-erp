import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps, ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

// 模拟 next/form + next/link 的软导航：只拦截提交 / 点击并记录目标，
// 由测试按「新 URL」重新渲染同一棵树 —— 与真实路由一样，React 按位置复用组件，
// 非受控字段是否按 URL 重建完全取决于表单 key。
const nav = vi.hoisted(() => ({ submits: [] as FormData[], clicks: [] as string[] }));
vi.mock('next/form', () => ({
  __esModule: true,
  default: ({ scroll, prefetch, action, ...props }: ComponentProps<'form'> & { scroll?: boolean; prefetch?: boolean }) => {
    void scroll; void prefetch; void action;
    return <form {...props} onSubmit={(event) => { event.preventDefault(); nav.submits.push(new FormData(event.currentTarget)); }} />;
  },
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  __esModule: true,
  default: ({ prefetch, scroll, onClick, href, ...props }: ComponentProps<'a'> & { prefetch?: boolean; scroll?: boolean; href: string }) => {
    void prefetch; void scroll;
    return <a {...props} href={href} onClick={(event) => { onClick?.(event); event.preventDefault(); nav.clicks.push(href); }} />;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/actions/order-workspace', () => ({ setOrderStarredAction: vi.fn() }));
vi.mock('@/actions/order-export', () => ({ requestOrderExportAction: vi.fn() }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({ previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn() }));
vi.mock('@/actions/order-batch-print', () => ({ requestBatchPrintAction: vi.fn() }));
vi.mock('@/actions/admin-order-workflow', () => ({
  runAdminOrderBatchAction: vi.fn(), confirmFactoryOrderAction: vi.fn(), holdFactoryOrderAction: vi.fn(),
  rejectFactoryOrderAction: vi.fn(), releaseFactoryOrderAction: vi.fn(), resumeFactoryOrderAction: vi.fn(), settleFactoryOrderAction: vi.fn(),
}));
vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: vi.fn(), finalizeOrderPricingAction: vi.fn(), shipOrderAction: vi.fn(),
  previewOrderChangeRequestPricingAction: vi.fn(), previewOrderCancellationSettlementAction: vi.fn(), reviewOrderChangeRequestAction: vi.fn(),
}));
vi.mock('@/generated/prisma/client', async () => ({
  ...await import('@/generated/prisma/enums'),
  Prisma: { Decimal: (await import('decimal.js')).default },
}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { AdminListToolbar } from '../AdminDataTable';
import { AdminOrderWorkspace } from '../../order/AdminOrderWorkspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';

let host: HTMLElement; let root: Root;
beforeEach(() => { nav.submits = []; nav.clicks = []; host = document.createElement('main'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
const show = (tree: ReactElement) => flushSync(() => root.render(tree));

function toolbar(q: string, type = '') {
  return (
    <AdminListToolbar
      action="/owner/parties"
      query={q}
      placeholder="搜索"
      clearHref="/owner/parties"
      hiddenParams={{ pageSize: 20 }}
      filterValues={{ type }}
      filters={<NativeSelect aria-label="类型" name="type" defaultValue={type}><option value="">全部</option><option value="CUSTOMER">客户</option></NativeSelect>}
    />
  );
}

it('AdminListToolbar：提交 → 清空 → 字段为空；后退 / 前进时按 URL 重建', async () => {
  show(toolbar(''));
  const q = page.getByRole('textbox');
  const type = page.getByRole('combobox', { name: '类型' });
  await q.fill('旧词'); await type.selectOptions('CUSTOMER');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  expect(nav.submits.at(-1)?.get('q')).toBe('旧词');
  show(toolbar('旧词', 'CUSTOMER'));

  await page.getByRole('link', { name: '清空', exact: true }).click();
  expect(nav.clicks.at(-1)).toBe('/owner/parties');
  show(toolbar(''));
  await expect.element(q).toHaveValue('');
  await expect.element(type).toHaveValue('');

  // 再提交不会带回旧条件。
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  expect(nav.submits.at(-1)?.get('q')).toBe('');
  expect(nav.submits.at(-1)?.get('type')).toBe('');

  show(toolbar('旧词', 'CUSTOMER')); // 后退
  await expect.element(q).toHaveValue('旧词');
  await expect.element(type).toHaveValue('CUSTOMER');
  show(toolbar('')); // 前进
  await expect.element(q).toHaveValue('');
});

function workspace(params: Record<string, string>) {
  return (
    <AdminOrderWorkspace
      query={parseAdminOrderWorkspaceQuery(params).query}
      issues={[]}
      options={{ submitters: [], workers: [], crafts: [] }}
      billingStats={{ receivableAmount: '0', receivableBillCount: 0, unbilledOrderCount: 0, draftBillCount: 0 }}
      exportControls={<Button type="button">导出工单</Button>}
      selectedExportRequestKey="soft-nav-test"
      data={{ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 1,
        summary: { orderCount: 0, totalQuantity: 0, effectiveFee: '0.00', manualPricingCount: 0, incompleteFeeExcludedCount: 0, legacyFeeExcludedCount: 0 },
        counts: { queues: { todo: 0, print: 0, production: 0, shipped: 0, done: 0, all: 0 }, signals: { 'pending-quantity': 0, 'pending-confirmation': 0, 'pending-pricing': 0, 'pending-change': 0, 'pending-release': 0, 'on-hold': 0, overdue: 0, 'due-today': 0 } },
      }}
    />
  );
}

it('AdminOrderWorkspace：提交后清除 → 搜索框为空', async () => {
  show(workspace({}));
  const q = page.getByRole('textbox', { name: '搜索工单', exact: true });
  await q.fill('GD-1');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  expect(nav.submits.at(-1)?.get('q')).toBe('GD-1');
  show(workspace({ q: 'GD-1' }));
  // 第 0 个在筛选栏里，第 1 个在列表空态里。
  await page.getByRole('link', { name: '清除筛选', exact: true }).nth(0).click();
  show(workspace({}));
  await expect.element(q).toHaveValue('');
});

it.each([['筛选栏', 0], ['列表空态', 1]] as const)('AdminOrderWorkspace：已应用搜索为空时，%s的清除筛选也丢弃未提交输入；切队列仍保留', async (_where, index) => {
  // 只有「仅星标」生效，已应用 q 为空 → 清除前后表单 key 不变。
  show(workspace({ starred: 'yes' }));
  const q = page.getByRole('textbox', { name: '搜索工单', exact: true });
  await q.fill('未提交');
  show(workspace({ starred: 'yes', queue: 'all' })); // 切队列：保留未应用输入（审查 #38）
  await expect.element(q).toHaveValue('未提交');

  await page.getByRole('link', { name: '清除筛选', exact: true }).nth(index).click();
  expect(nav.clicks.at(-1)).toBe('/orders?queue=all');
  show(workspace({ queue: 'all' }));
  await expect.element(q).toHaveValue('');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  expect(nav.submits.at(-1)?.get('q')).toBe('');
});
