import type { ComponentProps, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { createExternalOrderItem } from '@/lib/order/order-item-configuration';
import {
  WORKBENCH_CATALOG as catalog,
  WORKBENCH_CRAFTS as crafts,
} from '@/lib/workbench/__tests__/item-fixtures';
import { workbenchItemQuoteSchema } from '@/lib/workbench/item-quote';
import { saveWorkbenchTransfer } from '@/lib/workbench/order-transfer';
import {
  localOrderFormDraftStorageKey,
  serializeLocalOrderFormDraft,
} from '../order-form-local-draft';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void _prefetch;
    return <a {...props} />;
  },
}));
import { WorkbenchOrderTransfer } from '../WorkbenchOrderTransfer';
import { LocalOrderDrafts } from '../LocalOrderDrafts';

let host: HTMLDivElement;
let root: Root;
const scope = 'review-sales';
const baseKey = localOrderFormDraftStorageKey(scope, true);
const input = workbenchItemQuoteSchema.parse({
  item: createExternalOrderItem(
    crafts,
    catalog.products,
    catalog.papers,
    '亚金',
  ),
});
const values = {
  customName: '待继续的报价工单',
  items: [input.item],
  additionalShipments: [],
  packagingGroups: [],
};
const raw = () => serializeLocalOrderFormDraft(values, 'external-sales')!;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'transfer-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
});
function render(node: ReactNode) {
  flushSync(() => root.render(node));
}
function transfer(
  id: string,
  apply = vi.fn((): string | null => null),
  resume = vi.fn(),
) {
  render(
    <WorkbenchOrderTransfer
      id={id}
      scope={scope}
      pricingScope="external-sales"
      existingDraftKey={baseKey}
      transferDraftKey={`${baseKey}:workbench:${id}`}
      onApply={apply}
      onContinue={resume}
    />,
  );
  return { apply, resume };
}

it('falls back from corrupt local data to the validated session item', async () => {
  const id = saveWorkbenchTransfer(sessionStorage, scope, input);
  localStorage.setItem(`${baseKey}:workbench:${id}`, 'invalid json');
  localStorage.setItem(baseKey, 'also invalid');
  const { apply, resume } = transfer(id);
  await expect.poll(() => apply.mock.calls).toEqual([[input]]);
  expect(resume).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole('region', { name: '带入报价条件' }))
    .not.toBeInTheDocument();
});
it('falls back when JSON parses but cannot be safely restored as a form', async () => {
  const id = saveWorkbenchTransfer(sessionStorage, scope, input);
  const draft = JSON.parse(raw());
  delete draft.values.items[0].frontFoilColors;
  localStorage.setItem(`${baseKey}:workbench:${id}`, JSON.stringify(draft));
  const { apply, resume } = transfer(id);
  await expect.poll(() => apply.mock.calls).toEqual([[input]]);
  expect(resume).not.toHaveBeenCalled();
});
it('continues a valid local draft without an expired or missing session, retaining later edits', async () => {
  const id = crypto.randomUUID();
  localStorage.setItem(`${baseKey}:workbench:${id}`, raw());
  const { apply, resume } = transfer(id);
  await expect.poll(() => resume.mock.calls.length).toBe(1);
  expect(apply).not.toHaveBeenCalled();
});
it('does not treat a different pricing scope as a recoverable draft', async () => {
  const id = saveWorkbenchTransfer(sessionStorage, scope, input);
  localStorage.setItem(
    `${baseKey}:workbench:${id}`,
    serializeLocalOrderFormDraft(values, 'internal')!,
  );
  const { apply, resume } = transfer(id);
  await expect.poll(() => apply.mock.calls).toEqual([[input]]);
  expect(resume).not.toHaveBeenCalled();
});
it('blocks missing or malformed conditions instead of enabling the default order', async () => {
  const id = crypto.randomUUID();
  localStorage.setItem(`${baseKey}:workbench:${id}`, 'invalid json');
  const { apply, resume } = transfer(id);
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('报价条件已过期或无法读取');
  expect(apply).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '返回工作台' }).click();
  expect(mocks.replace).toHaveBeenCalledWith('/workbench');
});
it('offers separate storage or the original order without overwriting it', async () => {
  const id = saveWorkbenchTransfer(sessionStorage, scope, input);
  const original = raw();
  localStorage.setItem(baseKey, original);
  const { apply } = transfer(id);
  await expect
    .element(page.getByRole('button', { name: '继续原工单' }))
    .toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '继续原工单' }).click();
  expect(mocks.replace).toHaveBeenCalledWith('/orders/new');
  await page.getByRole('button', { name: '使用本次报价创建工单' }).click();
  expect(apply).toHaveBeenCalledWith(input);
  expect(localStorage.getItem(baseKey)).toBe(original);
});
it('keeps a failed apply visible and never claims completion', async () => {
  const id = saveWorkbenchTransfer(sessionStorage, scope, input);
  const { resume } = transfer(
    id,
    vi.fn(() => '报价条件保存失败，请释放浏览器存储空间后返回工作台重试'),
  );
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('报价条件保存失败');
  expect(resume).not.toHaveBeenCalled();
});
it('reports unavailable browser storage with a recovery action', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied');
  });
  transfer(crypto.randomUUID());
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('浏览器暂时无法读取');
  await expect
    .element(page.getByRole('button', { name: '返回工作台' }))
    .toBeVisible();
});

for (const width of [375, 393, 768, 1024, 1280, 1920]) {
  for (const theme of ['light', 'dark']) {
    it(`recovers saved orders at ${width}px in ${theme} with accessible controls`, async () => {
      await page.viewport(width, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const id = crypto.randomUUID();
      localStorage.setItem(`${baseKey}:workbench:${id}`, raw());
      const navigate = vi.fn(() => false);
      render(
        <LocalOrderDrafts
          baseKey={baseKey}
          pricingScope="external-sales"
          onNavigate={navigate}
        />,
      );
      await page.getByText('报价工单草稿（1）', { exact: true }).click();
      const link = page.getByRole('link', { name: '恢复草稿' });
      await expect
        .element(link)
        .toHaveAttribute('href', `/orders/new?fromWorkbench=${id}`);
      await link.click();
      expect(navigate).toHaveBeenCalledOnce();
      const anchor = host.querySelector('a')!;
      expect(anchor.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      anchor.focus();
      await userEvent.keyboard('{Enter}');
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(
        await commands.checkShellAccessibility(
          '[data-testid="transfer-fixture"]',
        ),
      ).toEqual([]);
    });
  }
}
it('hides the currently open draft and reacts to saved drafts in another tab', async () => {
  const currentId = crypto.randomUUID();
  localStorage.setItem(`${baseKey}:workbench:${currentId}`, raw());
  render(
    <LocalOrderDrafts
      baseKey={baseKey}
      pricingScope="external-sales"
      currentId={currentId}
      onNavigate={() => false}
    />,
  );
  expect(host.textContent).toBe('');
  localStorage.setItem(`${baseKey}:workbench:${crypto.randomUUID()}`, raw());
  window.dispatchEvent(new StorageEvent('storage'));
  await expect
    .element(page.getByText('报价工单草稿（1）', { exact: true }))
    .toBeVisible();
});
