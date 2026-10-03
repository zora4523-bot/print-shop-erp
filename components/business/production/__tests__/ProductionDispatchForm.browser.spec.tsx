import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, commands, userEvent } from 'vitest/browser';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ComponentProps } from 'react';
import '@/app/globals.css';

const mocked = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@/actions/production-dispatch', () => ({ publishProductionDispatchAction: mocked.publish }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, onNavigate, ...props }: ComponentProps<'a'> & { prefetch?: boolean; onNavigate?: unknown }) => {
    void prefetch; void onNavigate;
    return <a {...props} />;
  },
}));
import { ProductionDispatchForm } from '../ProductionDispatchForm';

const order = {
  id: 'dispatch-button-order', name: '排单核查', revision: 1, version: 1,
  tasks: [{ key: 'foil', label: '局部烫金', quantity: '1000', workerId: '', locked: false,
    options: [{ id: 'worker', name: '测试师傅' }] }],
};
const draftKey = 'production-dispatch:dispatch-button-actor:dispatch-button-order:1:1';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-CN';
  localStorage.removeItem(draftKey);
  host = document.createElement('div');
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  host.dataset.testid = 'dispatch-fixture';
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.removeItem(draftKey);
  localStorage.removeItem(`${draftKey}-unrelated`);
  localStorage.removeItem(draftKey.replace(':1:1', ':1:2'));
  document.documentElement.classList.remove('dark');
});
function render(orders = [order]) {
  flushSync(() => root.render(<ProductionDispatchForm actorId="dispatch-button-actor" orders={orders} />));
}
async function review() {
  render();
  await page.getByRole('combobox').selectOptions('worker');
  await page.getByRole('button', { name: '核对排单', exact: true }).click();
}

it('blocks return navigation during submission and shows result links after success', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  mocked.publish.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await review();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  const back = page.getByRole('link', { name: '返回工单列表', exact: true });
  await expect.element(back).toHaveAttribute('aria-disabled', 'true');
  await expect.element(back).toHaveAttribute('tabindex', '-1');
  const link = host.querySelector('a')!;
  expect(link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
  finish({ ok: true, message: '已安排 1 张工单' });
  await expect.element(page.getByRole('status')).toHaveTextContent('已安排 1 张工单');
  await expect.element(back).not.toHaveAttribute('aria-disabled');
  await expect.element(page.getByRole('link', { name: '排单核查：查看排单结果' })).toHaveAttribute('href', `/orders/${order.id}#detail-production-records`);
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('返回修改');
  expect(host.textContent).not.toContain('保存草稿');
  expect(host.textContent).not.toContain('恢复草稿');
  expect(mocked.publish).toHaveBeenCalledTimes(1);
});

it('retains the selected worker and idempotency key after a failed submission', async () => {
  mocked.publish.mockResolvedValue({ ok: false, message: '本次未保存，请核对后重试' });
  await review();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('本次未保存');
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  await expect.element(page.getByRole('combobox')).toHaveValue('worker');
  await expect.element(page.getByRole('combobox')).toBeEnabled();
  await page.getByRole('button', { name: '核对排单', exact: true }).click();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await vi.waitFor(() => expect(mocked.publish).toHaveBeenCalledTimes(2));
  const first = JSON.parse(mocked.publish.mock.calls[0][1].get('payload'));
  const retry = JSON.parse(mocked.publish.mock.calls[1][1].get('payload'));
  expect(retry).toEqual(first);
  expect(retry.orders[0].assignments.foil).toBe('worker');
});

it('clears the submitted draft even when revalidation advances the order revision', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  mocked.publish.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render();
  await page.getByRole('combobox').selectOptions('worker');
  await page.getByRole('button', { name: '保存草稿' }).click();
  expect(localStorage.getItem(draftKey)).not.toBeNull();
  localStorage.setItem(`${draftKey}-unrelated`, 'keep');
  const newerDraft = draftKey.replace(':1:1', ':1:2');
  localStorage.setItem(newerDraft, 'newer draft');
  await page.getByRole('button', { name: '核对排单', exact: true }).click();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  render([{ ...order, revision: 2 }]);
  finish({ ok: true, message: '已安排 1 张工单' });
  await expect.element(page.getByRole('status')).toHaveTextContent('已安排 1 张工单');
  expect(localStorage.getItem(draftKey)).toBeNull();
  expect(localStorage.getItem(newerDraft)).toBe('newer draft');
  expect(localStorage.getItem(`${draftKey}-unrelated`)).toBe('keep');
});

it('keeps locked owners unchanged when restoring a draft', async () => {
  render([{ ...order, tasks: [{ ...order.tasks[0], workerId: 'worker', locked: true }] }]);
  localStorage.setItem(draftKey, JSON.stringify({ [order.id]: { foil: 'someone-else' } }));
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await expect.element(page.getByRole('combobox')).toHaveValue('worker');
  await expect.element(page.getByRole('combobox')).toBeDisabled();
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width} ${theme}: batch success keeps every result reachable without overflow`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      mocked.publish.mockResolvedValue({ ok: true, message: '已安排 2 张工单' });
      render([order, { ...order, id: 'second-order', name: '长工单名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3) }]);
      for (const select of page.getByRole('combobox').all()) await select.selectOptions('worker');
      await page.getByRole('button', { name: '核对排单', exact: true }).click();
      await page.getByRole('button', { name: '发布排单', exact: true }).click();
      await expect.element(page.getByRole('status')).toHaveTextContent('已安排 2 张工单');
      const links = [...host.querySelectorAll('a')];
      expect(links).toHaveLength(3);
      expect(links.map(link => link.getAttribute('href'))).toContain('/orders/second-order#detail-production-records');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const link of links) {
        const box = link.getBoundingClientRect();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(getComputedStyle(link).borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      }
      expect(await commands.checkShellAccessibility('[data-testid="dispatch-fixture"]')).toEqual([]);
    });
  }
}

for (const [width, reduce] of [[320, false], [1280, false], [320, true], [1280, true]] as const) {
  it(`${width}: keyboard review and recovery remain usable with reduced motion ${reduce}`, async () => {
    await page.viewport(width, 844);
    await commands.setReducedMotion(reduce);
    mocked.publish.mockResolvedValue({ ok: false, message: '工单已变化，请刷新后重试' });
    render();
    await page.getByRole('combobox').selectOptions('worker');
    page.getByRole('button', { name: '核对排单', exact: true }).element().focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('button', { name: '发布排单', exact: true })).toBeVisible();
    expect(document.activeElement?.tagName).toBe('H2');
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement?.textContent).toBe('发布排单');
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement?.textContent).toBe('返回修改');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
    await expect.element(page.getByRole('alert')).toHaveTextContent('工单已变化');
    page.getByRole('button', { name: '返回修改', exact: true }).element().focus();
    await userEvent.keyboard(' ');
    await expect.element(page.getByRole('combobox')).toHaveValue('worker');
    expect(document.activeElement?.tagName).toBe('SELECT');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await commands.setReducedMotion(false);
  });
}
