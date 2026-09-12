import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import type { AdminOrderDetailModel } from '../admin-order-detail-model';
import '@/app/globals.css';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminOrderDetailView } from '../AdminOrderDetailView';

let host: HTMLDivElement;
let root: Root;
const printHint = '该工单设计图较多，超出部分请查看完整设计文件。';

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport min-w-0 p-4';
  host.dataset.testid = 'order-detail-fixture';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  history.replaceState(null, '', location.pathname);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function designImage(label: string, color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="264" height="356" viewBox="0 0 264 356"><rect width="264" height="356" fill="${color}"/><text x="132" y="180" text-anchor="middle" fill="white" font-size="30">${label}</text></svg>`)}`;
}

function detailModel(overrides: Partial<AdminOrderDetailModel> = {}): AdminOrderDetailModel {
  const diffs = [{ id: 'change-qty', label: '第 2 款 · 数量', before: '1,000', after: '2,000', targetItemId: 'item-2' }];
  return {
    remark: '先核对样稿\n再安排生产',
    id: 'detail-order-1', no: 'GD-260908-DETAIL-001', name: '中秋礼品红包', version: 2,
    status: OrderStatus.FOILING, customer: '华南礼品包装有限公司', sales: '外部销售 · 林女士',
    craft: '局部烫金 · 专版烫金', due: '2026-09-18', dueLeft: '剩 10 天', qty: 3000, isUrgent: false,
    items: [1, 2].map((fig) => ({
      id: `item-${fig}`, fig, sequence: fig, name: fig === 1 ? '花好月圆' : '阖家团圆',
      qty: fig === 1 ? 1000 : 2000, pack: `${fig * 100} 袋 · 10 个/袋`,
      specs: [
        { label: '工艺', value: '局部烫金' }, { label: '纸张', value: '珠光艳闪 · 160g' },
        { label: '规格', value: '大号封' }, { label: '实尺', value: '90 × 165 mm' },
        { label: '正面烫金', value: '亚金、红色' }, { label: '反面烫金', value: '无' },
      ],
      images: [{ id: `image-${fig}`, url: designImage(`图${fig}`, fig === 1 ? '#a8121a' : '#2f6b46'), name: `款式${fig}设计图.svg` }],
      hasCdr: true, fees: [{ id: `item-${fig}-fee`, label: '款式加工费', amount: fig === 1 ? '180.00' : '360.00' }],
      remark: fig === 1 ? '请核对文字方向与烫金位置。' : null, isNew: fig === 2,
      progress: [{ label: '烫金', done: fig === 1 ? '1000' : '600', total: fig === 1 ? '1000' : '2000', unit: '个' }],
    })),
    orderFees: [{ id: 'packaging', label: '入袋费', amount: '30.00' }, { id: 'plate', label: '版费', amount: '0.00' }],
    total: '570.00', feeSource: 'CONFIRMED',
    feeStages: [
      { key: 'quoted', title: '提交报价', total: '550.00', current: false },
      { key: 'confirmed', title: '确认金额', total: '570.00', current: true },
      { key: 'settled', title: '结算金额', total: null, current: false },
    ],
    vdiff: { from: 1, to: 2, at: '2026-09-08T02:00:00Z', items: diffs },
    changes: [{ id: 'change-1', status: 'APPROVED', reason: '第二款追加数量', at: '2026-09-08T01:00:00Z', reviewedAt: '2026-09-08T02:00:00Z', reviewer: '管理员', requester: '林女士', fromVersion: 1, toVersion: 2, diffs }],
    works: [{ id: 'work-1', at: '2026-09-08T03:00:00Z', actor: '张师傅', label: '烫金报工', quantity: '1600', cumulative: '1600', unit: '个' }],
    logs: [{ id: 'log-1', at: '2026-09-08T02:00:00Z', actor: '管理员', label: '批准变更', remark: null, changes: [{ label: '工单版本', before: '1', after: '2' }] }],
    shipments: [{ id: 'shipment-1', sequence: 1, name: '王女士', phone: '13800138000', address: '广东省东莞市南城街道测试路 18 号', trackingNo: 'SF1234567890123', carrier: 'SF', items: ['第 1 款 花好月圆 × 1,000', '第 2 款 阖家团圆 × 2,000'] }],
    progress: { orderTotal: '3000', foilingProgress: '1600', packingProgress: '0', foilingOverLimit: false, packingOverLimit: false, packingAhead: false, stagnant: false, stagnationDays: 0, firstClaimedAt: '2026-09-08T03:00:00Z' },
    ...overrides,
  };
}

function renderDetail(model = detailModel(), canEdit = true) {
  flushSync(() => root.render(<AdminOrderDetailView
    model={model}
    canEdit={canEdit}
    printHint={printHint}
    decision={<div><p>当前待办：核对本版打印</p><Button type="button">核对打印任务</Button><a href="#pricing-review" className="inline-flex min-h-11 min-w-11 items-center p-3">前往核价</a></div>}
    prints={[{ id: 'print-1', version: 1, state: 'SUPERSEDED', at: '2026-09-07T02:00:00Z' }, { id: 'print-2', version: 2, state: 'PENDING', at: '2026-09-08T02:00:00Z' }]}
    supplementary={[{ id: 'detail-other-actions', title: '其他工单操作', content: <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-11 items-center p-2" href={`/api/orders/${model.id}/pdf?view=inline`}>打印</a><a className="inline-flex min-h-11 items-center p-2" href={`/api/orders/${model.id}/pdf`}>下载 PDF</a>{canEdit ? <a className="inline-flex min-h-11 items-center p-2" href={`/orders/${model.id}/edit`}>编辑工单</a> : null}<Button variant="outline" disabled>发货</Button></div> }, { id: 'detail-audit-records', title: '完整审核记录', content: <section data-testid="embedded-audit" className="rounded-xl border bg-card p-6 shadow-sm"><p>该记录来自已保存的审核结果。</p><section data-testid="nested-card" className="rounded-xl border bg-card p-4"><label htmlFor="audit-note">记录备注</label><input id="audit-note" className="block min-h-11 w-full rounded-md border bg-background" /></section></section> }, { id: 'detail-design-files', title: '设计文件管理', content: <p>设计原稿与生产文件记录。</p> }, { id: 'detail-pricing-tools', title: '计价与核价', content: <Disclosure data-testid="nested-pricing"><DisclosureSummary>核价明细</DisclosureSummary><section id="pricing-review"><h3>待核价费用明细</h3></section></Disclosure> }]}
    packaging={<section data-testid="embedded-packaging" className="rounded-xl border bg-card p-6 shadow-sm"><p>分袋明细：300 袋，每袋 10 个。</p></section>}
  />));
}

async function settleLayout() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
}

function geometryFailures(scope: ParentNode, width: number, touch = width <= 768) {
  const failures: string[] = [];
  if (document.documentElement.scrollWidth > width + 1) failures.push(`页面横向溢出：${document.documentElement.scrollWidth} > ${width}`);
  for (const element of scope.querySelectorAll<HTMLElement>('a[href], button, summary, input:not([aria-hidden="true"]):not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"]')) {
    if (!element.checkVisibility()) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const label = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName;
    if (rect.left < -1 || rect.right > width + 1) failures.push(`${label} 超出视口 [${rect.left}, ${rect.right}]`);
    if (touch && (rect.width < 44 || rect.height < 44)) failures.push(`${label} 触控尺寸 ${rect.width} × ${rect.height}`);
  }
  return failures;
}

async function expectHashTargetUnobscured(target: HTMLElement) {
  await expect.poll(() => document.activeElement).toBe(target);
  await expect.poll(() => target.getBoundingClientRect().top).toBeLessThan(window.innerHeight - 44);
  // Wait for native smooth scrolling to finish; CSS animation completion alone
  // does not cover scrollIntoView and could pass while the target is still moving.
  let previousTop = Number.NaN;
  let stableFrames = 0;
  const deadline = performance.now() + 3000;
  while (stableFrames < 4 && performance.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const top = target.getBoundingClientRect().top;
    stableFrames = Math.abs(top - previousTop) < 0.25 ? stableFrames + 1 : 0;
    previousTop = top;
  }
  expect(stableFrames, '锚点滚动应当停止后再检查遮挡').toBe(4);
  expect(getComputedStyle(host.querySelector('[data-slot="order-page-heading"]')!).position).toBe('static');
  const targetRect = target.getBoundingClientRect();
  expect(targetRect.top, '目标不能被全局导航遮挡').toBeGreaterThanOrEqual(0);
  const title = target.querySelector<HTMLElement>('h3')!;
  const titleRect = title.getBoundingClientRect();
  expect(titleRect.bottom, '定位后的标题完整处于视口内').toBeLessThanOrEqual(window.innerHeight);
  const hit = document.elementFromPoint(titleRect.left + Math.min(10, titleRect.width / 2), titleRect.top + titleRect.height / 2);
  expect(target.contains(hit), '标题位置应命中目标内容而非吸顶遮挡层').toBe(true);
}

const viewports = [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080], [2205, 1203]] as const;

describe('admin order detail design and interaction gates', () => {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      it(`${width}×${height} ${theme}: layout, touch targets and accessibility`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        renderDetail();
        await settleLayout();
        for (const id of ['embedded-audit', 'embedded-packaging']) {
          const style = getComputedStyle(host.querySelector(`[data-testid="${id}"]`)!);
          expect(style.backgroundColor, `${id} 应共用页面底色`).toBe('rgba(0, 0, 0, 0)');
        }
        const card = host.querySelector('[data-testid="nested-card"]')!;
        const input = host.querySelector('#audit-note')!;
        const reference = document.createElement('div');
        reference.className = 'bg-card';
        host.append(reference);
        expect(getComputedStyle(card).backgroundColor).toBe(getComputedStyle(reference).backgroundColor);
        expect(getComputedStyle(card).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        reference.className = 'bg-background';
        expect(getComputedStyle(input).backgroundColor).toBe(getComputedStyle(reference).backgroundColor);
        expect(getComputedStyle(input).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        reference.remove();
        expect(geometryFailures(host, width)).toEqual([]);
        const surface = host.querySelector<HTMLElement>('[data-testid="admin-order-detail"]')!;
        const actions = document.getElementById('order-detail-actions')!;
        expect(actions.querySelector('#detail-other-actions')).not.toBeNull();
        expect(host.querySelectorAll('#detail-other-actions')).toHaveLength(1);
        expect(host.textContent).not.toContain('其他工单操作');
        const itemsHeading = document.getElementById('order-detail-items-title')!;
        if (width === 2205) expect(surface.getBoundingClientRect().width).toBeGreaterThanOrEqual(1700);
        if (width <= 960) expect(actions.getBoundingClientRect().top).toBeLessThan(itemsHeading.getBoundingClientRect().top);
        for (const link of host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="工单区块导航"] a')) expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
        expect(document.getElementById('order-detail-overview')?.textContent).toContain('业务员：');
        expect(document.getElementById('order-detail-fees')!.compareDocumentPosition(document.getElementById('order-history-records')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(host.textContent).not.toMatch(/¥\s*¥/);
        await expect.element(page.getByText('¥ 570.00', { exact: true }).first()).toBeVisible();
        expect(await commands.checkShellAccessibility('[data-testid="order-detail-fixture"]')).toEqual([]);
        await expect.element(page.getByText('花好月圆', { exact: true }).first()).toBeVisible();
        await expect.element(page.getByRole('link', { name: /编辑/ })).toHaveAttribute('href', '/orders/detail-order-1/edit');
        if (width >= 1024) await expect.element(page.getByText(printHint, { exact: true })).toBeVisible();
      });
    }
  }

  it('opens design previews, loops by keyboard and buttons, and returns focus on Escape', async () => {
    await page.viewport(1280, 900);
    renderDetail();
    const records = document.getElementById('detail-audit-records') as HTMLDetailsElement;
    await page.getByText('完整审核记录', { exact: true }).click();
    expect(records.open).toBe(false);
    const thumbnail = page.getByRole('button', { name: '查看第 1 款设计图', exact: true });
    await thumbnail.click();
    expect(records.open).toBe(false);
    const dialog = page.getByRole('dialog');
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole('heading', { name: /花好月圆/ })).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(dialog.getByRole('heading', { name: /阖家团圆/ })).toBeVisible();
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await expect.element(dialog.getByRole('heading', { name: /花好月圆/ })).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(dialog.getByRole('heading', { name: /阖家团圆/ })).toBeVisible();
    await page.getByRole('button', { name: '上一张', exact: true }).click();
    await expect.element(dialog.getByRole('heading', { name: /花好月圆/ })).toBeVisible();
    expect(await commands.checkShellAccessibility('[role="dialog"]')).toEqual([]);
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(thumbnail).toHaveFocus();
    expect(records.open).toBe(false);
  });

  it('keeps the mobile lightbox and its controls inside the viewport', async () => {
    await page.viewport(375, 667);
    renderDetail();
    await page.getByRole('button', { name: '查看第 1 款设计图', exact: true }).click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await settleLayout();
    expect(geometryFailures(dialog!, 375)).toEqual([]);
    const rect = dialog!.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(668);
    expect(await commands.checkShellAccessibility('[role="dialog"]')).toEqual([]);
    await userEvent.keyboard('{Escape}');
  });

  it('copies the actual order number without exposing or altering other data', async () => {
    await page.viewport(1280, 900);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderDetail();
    const records = document.getElementById('detail-audit-records') as HTMLDetailsElement;
    await page.getByText('完整审核记录', { exact: true }).click();
    expect(records.open).toBe(false);
    await expect.element(page.getByRole('heading', { name: '中秋礼品红包', exact: true })).toBeVisible();
    expect(host.querySelector<HTMLElement>('[aria-label="复制工单号"]')!.checkVisibility()).toBe(false);
    await page.getByText('工单信息', { exact: true }).click();
    await page.getByRole('button', { name: '复制工单号', exact: true }).click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('GD-260908-DETAIL-001');
    expect(records.open).toBe(false);
  });

  it('jumps to the matching item and lets every additional record close and reopen by mouse and keyboard', async () => {
    await page.viewport(393, 852);
    renderDetail();
    await page.getByRole('button', { name: /第 2 款 · 数量/ }).click();
    const target = document.getElementById('order-detail-item-item-2');
    expect(target).not.toBeNull();
    await expect.poll(() => target!.getBoundingClientRect().top).toBeLessThan(852);
    expect(target!.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    const details = [...host.querySelectorAll('details')].find((element) => element.querySelector('summary')?.textContent?.includes('完整审核记录'));
    expect(details).toBeDefined();
    expect(details!.open).toBe(true);
    await page.getByText('完整审核记录', { exact: true }).click();
    expect(details!.open).toBe(false);
    await expect.element(page.getByText('完整审核记录', { exact: true })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(details!.open).toBe(true);
    await userEvent.keyboard(' ');
    expect(details!.open).toBe(false);
    await page.getByText('完整审核记录', { exact: true }).click();
    expect(details!.open).toBe(true);
    await expect.element(page.getByText('该记录来自已保存的审核结果。', { exact: true })).toBeVisible();
    expect(geometryFailures(host, 393)).toEqual([]);
  });

  it('renders empty saved data and a valid zero confirmed amount without invented values or edit access', async () => {
    await page.viewport(393, 852);
    renderDetail(detailModel({
      items: [], qty: 0, total: '0.00', orderFees: [{ id: 'plate-zero', label: '版费', amount: '0.00' }],
      vdiff: null, changes: [], works: [], logs: [], shipments: [], due: null, dueLeft: '',
      feeStages: [{ key: 'quoted', title: '提交报价', total: '0.00', current: false }, { key: 'confirmed', title: '确认金额', total: '0.00', current: true }, { key: 'settled', title: '结算金额', total: null, current: false }],
      progress: { orderTotal: '0', foilingProgress: '0', packingProgress: '0', foilingOverLimit: false, packingOverLimit: false, packingAhead: false, stagnant: false, stagnationDays: 0, firstClaimedAt: null },
    }), false);
    await settleLayout();
    expect(host.textContent).toMatch(/未记录款式|暂无款式/);
    // The supplied audit section owns history; do not duplicate an empty feed.
    expect(host.textContent).not.toMatch(/暂无变更/);
    expect(host.textContent).toContain('该记录来自已保存的审核结果。');
    expect(host.textContent).toMatch(/暂无报工|生产开始后|尚无报工/);
    expect(host.textContent).toMatch(/未填写收货|暂无配送|未记录配送/);
    expect(host.textContent).toMatch(/¥\s*0\.00/);
    expect(host.textContent).not.toMatch(/¥\s*¥/);
    expect(host.textContent).not.toMatch(/NaN|Infinity|undefined/);
    await expect.element(page.getByRole('link', { name: /编辑/ })).not.toBeInTheDocument();
    expect(geometryFailures(host, 393)).toEqual([]);
    expect(await commands.checkShellAccessibility('[data-testid="order-detail-fixture"]')).toEqual([]);
  });

  it('keeps long saved identifiers readable and does not offer a lightbox without an image', async () => {
    await page.viewport(375, 667);
    const original = detailModel();
    renderDetail({
      ...original,
      no: `GD-${'LONGORDER'.repeat(9)}`,
      customer: '华南地区中秋礼品及节庆包装生产采购联合服务有限公司',
      items: original.items.map((item) => ({
        ...item,
        name: `${item.name} · 企业中秋活动定制纪念红包套装`,
        images: [],
        hasCdr: false,
        specs: item.specs.map((spec) => spec.label === '规格' ? { ...spec, value: 'CUSTOM-SPECIFICATION-WITH-CONTINUOUS-IDENTIFIER-001' } : spec),
      })),
    });
    await page.getByText('工单信息', { exact: true }).click();
    await expect.element(page.getByRole('button', { name: '复制工单号', exact: true })).toBeVisible();
    await settleLayout();
    expect(geometryFailures(host, 375)).toEqual([]);
    expect(host.textContent).toContain(`GD-${'LONGORDER'.repeat(9)}`);
    await expect.element(page.getByRole('button', { name: '查看第 1 款设计图', exact: true })).not.toBeInTheDocument();
    expect(await commands.checkShellAccessibility('[data-testid="order-detail-fixture"]')).toEqual([]);
  });

  it('opens the design-file disclosure from a style card without navigating away', async () => {
    await page.viewport(1280, 900);
    renderDetail();
    const files = document.getElementById('detail-design-files') as HTMLDetailsElement;
    expect(files.open).toBe(true);
    await page.getByText('设计文件管理', { exact: true }).click();
    expect(files.open).toBe(false);
    await page.getByRole('button', { name: '查看设计文件', exact: true }).first().click();
    expect(files.open).toBe(true);
    await expect.element(page.getByText('设计原稿与生产文件记录。', { exact: true })).toBeVisible();
    expect(document.activeElement).toBe(files);
  });

  it('opens the nested disclosure of an initial pricing hash and focuses the target', async () => {
    await page.viewport(393, 852);
    history.replaceState(history.state, '', '#pricing-review');
    host.style.paddingBottom = '100vh';
    renderDetail();
    const outer = document.getElementById('detail-pricing-tools') as HTMLDetailsElement;
    const inner = host.querySelector<HTMLDetailsElement>('[data-testid="nested-pricing"]')!;
    const target = document.getElementById('pricing-review')!;
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(false);
    expect(target.hasAttribute('tabindex')).toBe(false);
    await expect.poll(() => outer.open && inner.open).toBe(true);
    await expectHashTargetUnobscured(target);
    await expect.element(page.getByRole('heading', { name: '待核价费用明细', exact: true })).toBeVisible();
    expect(geometryFailures(host, 393)).toEqual([]);
  });

  it('reveals a pricing target when the hash changes after the page is mounted', async () => {
    await page.viewport(1280, 900);
    host.style.paddingBottom = '100vh';
    renderDetail();
    expect(document.getElementById('pricing-review')!.hasAttribute('tabindex')).toBe(false);
    await settleLayout();
    const outer = document.getElementById('detail-pricing-tools') as HTMLDetailsElement;
    expect(outer.open).toBe(true);
    await page.getByText('计价与核价', { exact: true }).click();
    expect(outer.open).toBe(false);
    location.hash = '#pricing-review';
    await expect.poll(() => outer.open).toBe(true);
    await expectHashTargetUnobscured(document.getElementById('pricing-review')!);
    await expect.element(page.getByRole('heading', { name: '待核价费用明细', exact: true })).toBeVisible();
  });

  it('a same-page link reopens its collapsed pricing destination even when the hash is unchanged', async () => {
    await page.viewport(1280, 900);
    host.style.paddingBottom = '100vh';
    renderDetail();
    expect(document.getElementById('pricing-review')!.hasAttribute('tabindex')).toBe(false);
    await settleLayout();
    const outer = document.getElementById('detail-pricing-tools') as HTMLDetailsElement;
    const inner = host.querySelector<HTMLDetailsElement>('[data-testid="nested-pricing"]')!;
    await page.getByRole('link', { name: '前往核价', exact: true }).click();
    expect(outer.open && inner.open).toBe(true);
    expect(location.hash).toBe('#pricing-review');
    await page.getByText('核价明细', { exact: true }).click();
    await page.getByText('计价与核价', { exact: true }).click();
    expect(outer.open || inner.open).toBe(false);
    await page.getByRole('link', { name: '前往核价', exact: true }).click();
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(true);
    expect(location.hash).toBe('#pricing-review');
    await expectHashTargetUnobscured(document.getElementById('pricing-review')!);
    await expect.element(page.getByRole('heading', { name: '待核价费用明细', exact: true })).toBeVisible();
  });
});

it('opens the selected style supplement and preserves fee and print destinations', async () => {
  await page.viewport(1280, 900);
  const model = detailModel();
  flushSync(() => root.render(<AdminOrderDetailView model={model} canEdit prints={[]} decision={null}
    supplementary={[{ id: 'detail-design-files', title: '设计文件', content: <>
      {model.items.map((item) => <Disclosure key={item.id} id={`detail-design-item-${item.id}`}>
        <DisclosureSummary>{item.name}补充资料</DisclosureSummary><p>{item.name}原稿</p>
      </Disclosure>)}
    </> }]} />));
  await page.getByRole('button', { name: '查看设计文件', exact: true }).nth(1).click();
  const selected = document.getElementById('detail-design-item-item-2') as HTMLDetailsElement;
  expect(selected.open).toBe(true);
  expect((document.getElementById('detail-design-item-item-1') as HTMLDetailsElement).open).toBe(false);
  await expect.poll(() => document.activeElement).toBe(selected);
  const fees = document.getElementById('order-detail-fees')!;
  expect(fees.textContent).toContain('入袋费');
  expect(fees.textContent).toContain('费用记录');
  expect(fees.textContent).toContain('¥ 570.00');
  expect(host.querySelector('a[href="/api/orders/detail-order-1/pdf?view=inline"]')).not.toBeNull();
  expect(geometryFailures(host, 1280)).toEqual([]);
});
