import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { OrderActivityEvent, OrderActivityPage } from '@/lib/order/activity-presentation';
import '@/app/globals.css';
vi.mock('@/actions/order-activity', () => ({ loadOrderActivity: vi.fn() }));
import { loadOrderActivity } from '@/actions/order-activity';
import { OrderActivity } from '../OrderActivity';
let host: HTMLDivElement;
let root: Root;
function event(id: string): OrderActivityEvent {
  return { id, at: '2026-09-11T10:33:00.000Z', date: '2026/09/11', time: '18:33', actor: '管理员', title: '新增制版明细', remark: `专版烫金 · ${'珠光艳闪大号封'.repeat(10)}`, changes: {
    primary: [{ field: 'confirmedFee', label: '确认金额', before: '¥ 454.32', after: '¥ 466.32' }],
    details: [{ field: 'priceRevision', label: '价格修订', before: '2', after: '3' }], unavailable: true,
  } };
}
function render(initialPage: OrderActivityPage = { events: [event('first')], nextCursor: { at: event('first').at, id: 'first' } }) {
  flushSync(() => root.render(<OrderActivity orderId="order" initialPage={initialPage} />));
}
beforeEach(() => {
  vi.mocked(loadOrderActivity).mockReset();
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div'); host.dataset.testid = 'activity-fixture'; host.className = 'p-4 min-w-0'; document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
const viewports = [[375,667],[393,852],[768,1024],[1024,768],[1280,800],[1920,1080],[2205,1203]] as const;
describe('activity layout and interactions', () => {
  for (const theme of ['light','dark']) for (const [width,height] of viewports) {
    it(`${width} ${theme}: readable changes, disclosure, touch, overflow and axe`, async () => {
      await page.viewport(width,height); document.documentElement.classList.toggle('dark',theme === 'dark'); render();
      await page.getByText('查看变更详情', { exact: false }).click();
      await expect.element(page.getByText('部分历史变更详情暂无法展示')).toBeVisible();
      expect(host.querySelector('details')?.open).toBe(true);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width+1);
      for (const control of host.querySelectorAll<HTMLElement>('button, summary')) {
        const rect = control.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width+1);
        if(width<=768) { expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.width).toBeGreaterThanOrEqual(44); }
      }
      await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      expect(await commands.checkShellAccessibility('[data-testid="activity-fixture"]')).toEqual([]);
    });
  }
  it('appends and deduplicates older events, groups dates and ends pagination', async () => {
    await page.viewport(1280,800); render();
    vi.mocked(loadOrderActivity).mockResolvedValue({ ok: true, page: { events: [event('first'),event('older')], nextCursor: null } });
    await page.getByRole('button',{ name:'加载更早记录' }).click();
    await expect.element(page.getByText('已显示 2 条')).toBeVisible();
    expect(host.querySelectorAll('article')).toHaveLength(2); expect(host.querySelectorAll('h3')).toHaveLength(1);
    await expect.element(page.getByRole('button',{ name:'加载更早记录' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(host.querySelector('ol'));
  });
  it('preserves loaded records on failure and allows a retry', async () => {
    render(); vi.mocked(loadOrderActivity).mockRejectedValueOnce(new Error('private server error'));
    await page.getByRole('button',{name:'加载更早记录'}).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('加载失败，请重试');
    expect(host.querySelectorAll('article')).toHaveLength(1);
    vi.mocked(loadOrderActivity).mockResolvedValue({ok:true,page:{events:[],nextCursor:null}});
    await page.getByRole('button',{name:'重试加载'}).click();
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
  });
  it('prevents duplicate pending loads', async () => {
    let finish!: (value: Awaited<ReturnType<typeof loadOrderActivity>>) => void;
    vi.mocked(loadOrderActivity).mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    render(); await page.getByRole('button',{name:'加载更早记录'}).click();
    await expect.element(page.getByRole('button',{name:'正在加载…'})).toBeDisabled();
    expect(loadOrderActivity).toHaveBeenCalledTimes(1);
    finish({ok:true,page:{events:[],nextCursor:null}});
    await expect.element(page.getByRole('button',{name:'正在加载…'})).not.toBeInTheDocument();
  });
});
