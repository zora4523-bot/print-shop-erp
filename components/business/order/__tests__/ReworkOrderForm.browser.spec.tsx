import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, commands } from 'vitest/browser';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock('@/actions/order', () => ({ createReworkOrderAction: mocks.create }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/ui-business', () => import('@/components/ui-business/ConfirmActionDialog'));
import { ReworkOrderForm } from '../ReworkOrderForm';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ status: 'error', message: '测试未写入' });
  host = document.createElement('div'); host.dataset.testid = 'rework-fixture';
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<ReworkOrderForm sourceOrderId="order-1" items={[{ id: 'item-1', sequence: 1, name: '红包', quantity: 500, crafts: [] }]} />));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
async function prepare() {
  await page.getByRole('textbox', { name: '详细原因' }).fill('运输途中受潮');
  await page.getByRole('checkbox', { name: '选择重做款式 1：红包' }).click();
  await page.getByRole('button', { name: '创建重做单（1 款）', exact: true }).click();
}
it('confirms once, permits cancellation and submits the selected payload only on confirmation', async () => {
  await prepare();
  expect(mocks.create).not.toHaveBeenCalled();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('500 个');
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('原工单状态、应收账单和历史工资保持不变');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(mocks.create).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', { name: '创建重做单（1 款）', exact: true })).toHaveFocus();
  await page.getByRole('button', { name: '创建重做单（1 款）', exact: true }).click();
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ sourceOrderId: 'order-1', reason: '运输途中受潮', items: [{ sourceOrderItemId: 'item-1', quantity: 500, craftIds: [] }] });
});
for (const [width, height] of [[375,667],[393,852],[768,1024],[1024,768],[1280,800],[1920,1080]]) for (const theme of ['light','dark']) {
  it(`${width} ${theme}: confirmation fits and remains accessible`, async () => {
    await page.viewport(width,height); document.documentElement.classList.toggle('dark',theme==='dark');
    await prepare();
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[role="alertdialog"]')).toEqual([]);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    for (const button of dialog.querySelectorAll('button')) expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
}
