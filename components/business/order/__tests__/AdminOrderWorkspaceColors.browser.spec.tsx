import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';
import { Button } from '@/components/ui/button';
import { batchOrder } from './admin-order-batch-fixture';
import '@/app/globals.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/order-workspace', () => ({ setOrderStarredAction: vi.fn() }));
vi.mock('@/actions/order-export', () => ({ requestOrderExportAction: vi.fn() }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({
  previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn(),
}));
vi.mock('@/actions/admin-order-workflow', () => ({
  runAdminOrderBatchAction: vi.fn(), confirmFactoryOrderAction: vi.fn(),
  holdFactoryOrderAction: vi.fn(), rejectFactoryOrderAction: vi.fn(),
  releaseFactoryOrderAction: vi.fn(), resumeFactoryOrderAction: vi.fn(),
  settleFactoryOrderAction: vi.fn(),
}));
vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: vi.fn(), finalizeOrderPricingAction: vi.fn(),
  shipOrderAction: vi.fn(), previewOrderChangeRequestPricingAction: vi.fn(),
  previewOrderCancellationSettlementAction: vi.fn(), reviewOrderChangeRequestAction: vi.fn(),
}));
vi.mock('@/generated/prisma/client', async () => ({
  ...await import('@/generated/prisma/enums'),
  Prisma: { Decimal: (await import('decimal.js')).default },
}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { AdminOrderWorkspace } from '../AdminOrderWorkspace';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport relative p-4';
  host.dataset.testid = 'order-colors-fixture';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  history.replaceState(null, '', location.pathname);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fixtureRows(): AdminOrderWorkspaceRow[] {
  const ready = batchOrder({
    id: 'ready', orderNo: 'GD-260908-001', status: OrderStatus.PENDING_FACTORY,
    statusSummary: '费用已核定，待下发检查',
    capabilities: { ...batchOrder().capabilities, confirm: true, release: false },
  });
  return [
    ready,
    {
      ...ready, id: 'legacy', orderNo: 'GD-260908-002', status: OrderStatus.SUBMITTED,
      isUrgent: true, printPending: true, statusSummary: '待打印',
      promisedDate: '2026-09-10', dueAlert: { kind: 'due-soon', days: 2 },
    },
    {
      ...ready, id: 'pricing', orderNo: 'GD-260908-003', statusSummary: '待核价 · 缺少专版报价',
      fee: { amount: null, source: 'PENDING', estimated: false },
      confirmationPreflight: { ok: false, issues: ['缺少专版报价'] },
      capabilities: { ...ready.capabilities, confirm: false },
    },
    {
      ...ready, id: 'review', orderNo: 'GD-260908-004', statusSummary: '⚠ 第 1 款缺 CDR',
      confirmationPreflight: { ok: false, issues: ['第 1 款缺 CDR'] },
      capabilities: { ...ready.capabilities, confirm: false },
    },
    {
      ...ready, id: 'change', orderNo: 'GD-260908-005', status: OrderStatus.CONFIRMED,
      pendingChangeRequest: {
        id: 'request-1', type: 'MODIFY', reason: '修改数量', createdAt: '2026-09-08T00:00:00Z',
      },
      capabilities: { ...ready.capabilities, confirm: false, reviewChange: true },
    },
    {
      ...ready, id: 'hold', orderNo: 'GD-260908-006', status: OrderStatus.ON_HOLD,
      statusSummary: '等待补充设计文件',
      capabilities: { ...ready.capabilities, confirm: false, resume: true },
    },
    {
      ...ready, id: 'rejected', orderNo: 'GD-260908-007', status: OrderStatus.REJECTED,
      statusSummary: '设计文件不符，已驳回',
      capabilities: { ...ready.capabilities, confirm: false },
    },
    {
      ...ready, id: 'overdue', orderNo: 'GD-260908-008', status: OrderStatus.FOILING,
      statusSummary: null, promisedDate: '2026-09-01', dueAlert: { kind: 'overdue', days: 7 },
      capabilities: { ...ready.capabilities, confirm: false },
    },
  ];
}

function renderWorkspace(signal?: string, zeroCounts = false) {
  const rows = fixtureRows();
  flushSync(() => root.render(<>
    <div aria-hidden="true" data-testid="order-colors-pointer-parking"
      style={{ position: 'absolute', left: 1, top: 1, width: 8, height: 8 }} />
    <AdminOrderWorkspace
      query={parseAdminOrderWorkspaceQuery(signal ? { signal, queue: 'all' } : {}).query}
      issues={[]}
      options={{ submitters: [{ id: 'sales-1', label: '业务员甲' }], workers: [], crafts: [] }}
      billingStats={{ receivableAmount: '500', receivableBillCount: 1, unbilledOrderCount: 0, draftBillCount: 0 }}
      exportControls={<Button type="button">导出工单</Button>}
      selectedExportRequestKey="color-review"
      data={{
        rows, total: rows.length, page: 1, pageSize: 20, pageCount: 1,
        summary: { orderCount: rows.length, totalQuantity: 8000, effectiveFee: '8641.50', manualPricingCount: 1, incompleteFeeExcludedCount: 0, legacyFeeExcludedCount: 0 },
        counts: {
          queues: { todo: 6, print: 0, production: 1, shipped: 0, done: 1, all: 8 },
          signals: zeroCounts
            ? { 'pending-confirmation': 0, 'pending-pricing': 0, 'pending-change': 0, 'pending-release': 0, 'on-hold': 0, overdue: 0, 'due-today': 0 }
            : { 'pending-confirmation': 4, 'pending-pricing': 1, 'pending-change': 1, 'pending-release': 1, 'on-hold': 1, overdue: 1, 'due-today': 2 },
        },
      }}
    />
  </>));
}

function requiredElement(selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}

function tokenColor(element: HTMLElement, token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  element.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

function rowText(id: string, text: string): HTMLElement {
  const row = requiredElement(`[data-order-id="${id}"]`);
  const element = [...row.querySelectorAll<HTMLElement>('p, span, time')].reverse().find((candidate) => candidate.textContent === text);
  expect(element, `${id}: ${text}`).toBeDefined();
  return element!;
}

function expectTextToken(element: HTMLElement, token: string) {
  expect(getComputedStyle(element).color).toBe(tokenColor(element, token));
}

async function settleStyles() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await Promise.all(host.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
}

async function parkPointer() {
  await page.getByTestId('order-colors-pointer-parking').hover();
  await settleStyles();
}

function expectNeutralCard(element: HTMLElement) {
  const style = getComputedStyle(element);
  expect(style.borderTopWidth).toBe('1px');
  expect(style.borderTopColor).toBe(tokenColor(element, '--border'));
  expect(style.backgroundImage).toBe('none');
  expect(style.backgroundColor).toBe(tokenColor(element, '--card'));
}

function expectControlsWithinViewport(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  for (const element of host.querySelectorAll<HTMLElement>('a[href], button, select, input:not([aria-hidden="true"]):not([type="hidden"]), [role="checkbox"]')) {
    let rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !element.checkVisibility()) continue;
    const label = element.getAttribute('aria-label') ?? element.textContent ?? element.tagName;
    const queue = element.closest<HTMLElement>('nav[aria-label="工单队列"]');
    if (queue && ['auto', 'scroll'].includes(getComputedStyle(queue).overflowX) && queue.scrollWidth > queue.clientWidth) {
      const queueRect = queue.getBoundingClientRect();
      expect(queueRect.left, '可滚动队列容器').toBeGreaterThanOrEqual(0);
      expect(queueRect.right, '可滚动队列容器').toBeLessThanOrEqual(width);
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      rect = element.getBoundingClientRect();
    }
    const compact = element.closest('[data-order-id]') && matchMedia('(min-width: 921px) and (hover: hover) and (pointer: fine)').matches;
    expect(rect.left, label).toBeGreaterThanOrEqual(0);
    expect(rect.right, label).toBeLessThanOrEqual(width);
    expect(rect.width, label).toBeGreaterThanOrEqual(compact ? 24 : 44);
    expect(rect.height, label).toBeGreaterThanOrEqual(compact ? 24 : 44);
  }
}

const viewports = [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]] as const;

describe('admin order workspace restrained semantic colors', () => {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      it(`${width}×${height} ${theme}: neutral rows and statistics, touch targets and accessibility`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        renderWorkspace();
        await parkPointer();
        for (const row of host.querySelectorAll<HTMLElement>('li[data-order-id]')) expectNeutralCard(row);
        const dashboard = requiredElement('[aria-label="工单决定看板"]');
        for (const card of dashboard.querySelectorAll<HTMLElement>('a')) expectNeutralCard(card);
        const cards = [...dashboard.querySelectorAll<HTMLElement>('a')];
        expect(cards).toHaveLength(8);
        if (width >= 1280) expect(new Set(cards.map((card) => card.getBoundingClientRect().top)).size).toBe(1);
        expectControlsWithinViewport(width);
        expect(await commands.checkShellAccessibility('[data-testid="order-colors-fixture"]')).toEqual([]);
      });
    }

    it(`${theme}: selection and hover stay neutral while keyboard focus remains visible`, async () => {
      await page.viewport(1280, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderWorkspace();
      await parkPointer();
      const row = requiredElement('[data-order-id="ready"]');
      const defaultBorder = getComputedStyle(row).borderTopColor;
      const defaultBackground = getComputedStyle(row).backgroundColor;
      await page.getByRole('link', { name: '中秋红包', exact: true }).first().hover();
      await expect.poll(() => getComputedStyle(row).borderTopColor).not.toBe(defaultBorder);
      expect(getComputedStyle(row).borderTopColor).not.toBe(tokenColor(row, '--primary'));
      expect(getComputedStyle(row).backgroundImage).toBe('none');
      const checkbox = page.getByRole('checkbox', { name: '选择工单 中秋红包（GD-260908-001）', exact: true });
      await checkbox.click();
      await parkPointer();
      await expect.element(checkbox).toBeChecked();
      expect(location.hash).toBe('');
      await expect.poll(() => getComputedStyle(row).backgroundColor).not.toBe(defaultBackground);
      await expect.poll(() => getComputedStyle(row).borderTopColor).toBe(defaultBorder);
      expect(getComputedStyle(row).backgroundImage).toBe('none');
      await settleStyles();
      const selectedBackground = getComputedStyle(row).backgroundColor;
      await page.getByRole('link', { name: '中秋红包', exact: true }).first().hover();
      await expect.poll(() => getComputedStyle(row).borderTopColor).not.toBe(defaultBorder);
      await settleStyles();
      expect(getComputedStyle(row).backgroundColor).toBe(selectedBackground);
      await parkPointer();
      const checkboxElement = requiredElement('[data-order-id="ready"] [role="checkbox"]');
      checkboxElement.focus();
      await userEvent.keyboard('{Tab}');
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
      expect(document.activeElement).toBe(checkboxElement);
      expect(checkboxElement.matches(':focus-visible')).toBe(true);
      expect(getComputedStyle(checkboxElement).boxShadow).not.toBe('none');
      await userEvent.keyboard(' ');
      await expect.element(checkbox).not.toBeChecked();
      await expect.poll(() => getComputedStyle(row).backgroundColor).toBe(defaultBackground);
      expect(location.hash).toBe('');
      await expect.element(page.getByRole('link', { name: '中秋红包', exact: true }).first()).toHaveAttribute('href', '/orders/ready');
    });

    it(`${theme}: warnings and failures occupy numbers and labels instead of whole cards`, async () => {
      await page.viewport(1280, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderWorkspace();
      await parkPointer();
      const dashboard = requiredElement('[aria-label="工单决定看板"]');
      for (const card of dashboard.querySelectorAll<HTMLAnchorElement>('a')) {
        const signal = new URL(card.href).searchParams.get('signal');
        const number = card.firstElementChild as HTMLElement;
        const label = card.lastElementChild as HTMLElement;
        const expectedToken = signal === 'overdue' ? '--destructive'
          : ['pending-pricing', 'pending-change', 'on-hold', 'due-today'].includes(signal ?? '') ? '--warning-foreground'
            : '--foreground';
        expectTextToken(number, expectedToken);
        expectTextToken(label, '--muted-foreground');
        expectNeutralCard(card);
      }
      expectTextToken(rowText('ready', '费用已核定，待下发检查'), '--muted-foreground');
      expectTextToken(rowText('legacy', '待打印'), '--muted-foreground');
      expectTextToken(rowText('legacy', '急单'), '--warning-foreground');
      expectTextToken(rowText('legacy', '2026-09-10'), '--warning-foreground');
      expectTextToken(rowText('pricing', '待核价 · 缺少专版报价'), '--warning-foreground');
      expectTextToken(rowText('pricing', '待工厂核价'), '--warning-foreground');
      expectTextToken(rowText('review', '⚠ 第 1 款缺 CDR'), '--warning-foreground');
      expectTextToken(rowText('hold', '等待补充设计文件'), '--warning-foreground');
      expectTextToken(rowText('rejected', '设计文件不符，已驳回'), '--destructive');
      const overdue = rowText('overdue', '逾期 7 天');
      expectTextToken(overdue, '--destructive');
      expectTextToken(rowText('overdue', '2026-09-01'), '--destructive');
      expectTextToken(rowText('legacy', '剩 2 天'), '--warning-foreground');
      for (const row of host.querySelectorAll<HTMLElement>('li[data-order-id]')) expectNeutralCard(row);
    });

    it(`${theme}: zero counters stay neutral and an active filter remains distinct`, async () => {
      await page.viewport(1280, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderWorkspace('pending-pricing', true);
      await parkPointer();
      const dashboard = requiredElement('[aria-label="工单决定看板"]');
      const active = dashboard.querySelector<HTMLElement>('a[aria-current="page"]');
      expect(active).not.toBeNull();
      expect(active?.textContent).toContain('待核价');
      expect(getComputedStyle(active!).borderTopColor).toBe(tokenColor(active!, '--foreground'));
      expect(getComputedStyle(active!).backgroundColor).not.toBe(tokenColor(active!, '--card'));
      expect(getComputedStyle(active!).backgroundImage).toBe('none');
      expect(dashboard.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
      for (const card of dashboard.querySelectorAll<HTMLElement>('a')) {
        expectTextToken(card.firstElementChild as HTMLElement, '--foreground');
        if (card !== active) expectNeutralCard(card);
      }
    });
  }
});
