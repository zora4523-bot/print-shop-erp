import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { versionDraft, versionList, versionPreview } from './price-versions-fixture';
const { publish, refresh } = vi.hoisted(() => ({ publish: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
  void prefetch; return <a {...props} />;
}, useLinkStatus: () => ({ pending: false }) }));
vi.mock('@/actions/customer-price-books', () => ({
  publishCustomerPriceBookDraftAction: publish, createCustomerPriceBookDraftAction: vi.fn(),
  discardCustomerPriceBookDraftAction: vi.fn(), cancelScheduledCustomerPriceBookAction: vi.fn(),
  rescheduleCustomerPriceBookAction: vi.fn(), updateCustomerPriceRuleDraftAction: vi.fn(),
}));
import { ExternalSalesPriceBookVersionPanel } from '../ExternalSalesPriceBookVersionPanel';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div'); host.dataset.testid = 'versions-ui'; host.className = 'p-4';
  document.body.append(host); root = createRoot(host); publish.mockReset(); refresh.mockReset();
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
function mount(state: Parameters<typeof versionPreview>[0] = 'ready') {
  flushSync(() => root.render(<ExternalSalesPriceBookVersionPanel versions={versionList} draft={versionDraft}
    preview={versionPreview(state)} invalidDraftSelection={false} defaultPublishAt="" />));
}
for (const width of [375, 393, 768, 1024, 1280, 1920]) for (const dark of [false, true]) {
  for (const state of ['empty', 'ready', 'invalid', 'risk'] as const) {
    it(`versions ${width} ${dark ? 'dark' : 'light'} ${state}`, async () => {
      await page.viewport(width, 1000); host.style.width = `${width >= 1024 ? width - 256 : width}px`;
      document.documentElement.classList.toggle('dark', dark); mount(state);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (state === 'empty') {
        expect(host.textContent).toContain('草稿与当前版本一致，无需发布');
        expect(host.querySelector('[aria-label="发布价目草稿"]')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
      } else {
        expect(submit?.disabled).toBe(state !== 'ready');
        if (state === 'invalid') expect(host.textContent).toContain('数量范围重叠');
      }
      expect(await commands.checkShellAccessibility('[data-testid="versions-ui"]')).toEqual([]);
    });
  }
}
it('差异完整精度及历史展开', async () => {
  mount();
  expect(host.textContent).toContain('¥ 0.325 / 个'); expect(host.textContent).toContain('¥ 0.3251 / 个');
  const history = page.getByText('版本历史（2 个版本）', { exact: true });
  await userEvent.click(history);
  await expect.element(page.getByText('当前生效', { exact: true })).toBeVisible();
});
it('高风险确认、预约、提交中锁定和冲突恢复', async () => {
  mount('risk');
  await userEvent.click(page.getByRole('checkbox', { name: '我已逐条核对高风险变更，确认按当前新规则发布' }));
  await userEvent.click(page.getByText('预约生效或补充发布说明（可选）', { exact: true }));
  await page.getByLabelText('预约生效时间（上海时间）').fill('2026-10-01T09:00');
  let finish!: (value: { status: 'error'; message: string }) => void;
  publish.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await userEvent.click(page.getByRole('button', { name: '确认预约发布', exact: true }));
  await expect.poll(() => publish.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('button', { name: '正在发布…', exact: true })).toBeDisabled();
  expect(publish.mock.calls[0]?.[0]).toMatchObject({ priceBookId: versionDraft.id, confirmedHighRisk: true });
  finish({ status: 'error', message: '价格已被其他管理员修改，请刷新后重试' });
  await userEvent.click(page.getByRole('button', { name: '刷新最新内容', exact: true }));
  expect(refresh).toHaveBeenCalledOnce();
});

it('无修改也保留真实校验错误', () => {
  const preview = versionPreview('empty');
  preview.validation.issues.push({ path: 'rules', message: '缺少大号规格，请补齐' });
  flushSync(() => root.render(<ExternalSalesPriceBookVersionPanel versions={versionList} draft={versionDraft}
    preview={preview} invalidDraftSelection={false} defaultPublishAt="" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('缺少大号规格');
  expect(host.querySelector('[aria-label="发布价目草稿"]')).toBeNull();
});
