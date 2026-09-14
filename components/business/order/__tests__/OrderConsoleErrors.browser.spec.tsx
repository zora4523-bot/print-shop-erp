import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, commands } from 'vitest/browser';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ sign: vi.fn(), record: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
// ExternalSalesOrderFormRail 经 ui-business 桶文件带入 NavCard / PendingLink 等
// 真实 next/link 使用者；Browser Mode 里真实 next/link 会因 process 未定义而崩溃。
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: import('react').ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/design-upload', () => ({
  signDesignUploadAction: mocks.sign,
  recordDesignUploadAction: mocks.record,
  deleteOrderItemDesignAction: mocks.remove,
}));
import { OrderFormBRail } from '../ExternalSalesOrderFormRail';
import { DesignUploadPanel } from '../DesignUploadPanel';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  host.dataset.testid = 'console-error-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

function renderRail(message: string | null) {
  flushSync(() => root.render(<OrderFormBRail
    itemCount={2}
    quoteItems={[1, 2].map((index) => ({ key: `item-${index}`, label: `第 ${index} 款`, status: message ? 'error' as const : 'complete' as const, amount: message ? null : '100.00', message: message ?? undefined, components: [] }))}
    packaging={{ status: message ? 'error' : 'complete', amount: message ? null : '10.00', message: message ?? undefined }}
    logistics={{ status: message ? 'error' : 'complete', shippingAmount: message ? null : '20.00', packagingAmount: '5.00', totalAmount: message ? null : '25.00', message: message ?? undefined }}
    usesExternalSalesPricing settlementLabel="外部销售应付工厂" gaps={[]} busy={false} onAttemptSubmit={vi.fn()}
  />));
}

it('deduplicates a shared quote failure, preserves per-item context and removes obsolete errors on recovery', async () => {
  const errors = vi.spyOn(console, 'error');
  const message = '报价失败：款式 1 的纸张目录身份不存在或不唯一，请重新选择';
  renderRail(message);
  const messages = [...host.querySelectorAll('li')].map((item) => item.textContent);
  expect(messages.filter((text) => text === message)).toHaveLength(1);
  expect(messages).toContain(`第 1 款：${message}`);
  expect(messages).toContain(`第 2 款：${message}`);
  expect(errors.mock.calls.some((args) => args.join(' ').includes('same key'))).toBe(false);
  renderRail(null);
  await expect.element(page.getByText('这张单需要管理员终价')).not.toBeInTheDocument();
  expect(host.textContent).not.toContain(message);
  await expect.element(page.getByRole('button', { name: '创建并提交', exact: true })).toBeEnabled();
});

it('explains a blocked file request and retries with a fresh signature without recording failed uploads', async () => {
  const url = 'https://upload.invalid/design/test.png';
  mocks.sign.mockResolvedValue({ status: 'ok', putUrl: url, objectKey: 'design/test.png' });
  mocks.record.mockResolvedValue({ ok: true });
  const originalFetch = globalThis.fetch;
  let blocked = true;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (input === url) return blocked ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response('', { status: 200 }));
    return originalFetch(input, init);
  });
  flushSync(() => root.render(<DesignUploadPanel orderId="order-1" orderItemId="item-1" canEdit designs={[]} />));
  const file = new File(['test'], 'test.png', { type: 'image/png' });
  await page.getByLabelText('上传设计文件', { exact: true }).upload(file);
  await expect.element(page.getByRole('alert')).toHaveTextContent('请检查网络；仍失败请联系管理员核对上传设置后重试');
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', { name: '选择设计文件', exact: true })).toBeEnabled();
  blocked = false;
  await page.getByLabelText('上传设计文件', { exact: true }).upload(file);
  await expect.element(page.getByText('已上传 1 个设计文件')).toBeVisible();
  expect(mocks.sign).toHaveBeenCalledTimes(2);
  expect(mocks.record).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`keeps quote failure guidance usable at ${width}x${height} ${theme}`, async () => {
      await page.viewport(width!, height!);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderRail('报价失败：包装组 1：各款数量与每袋组成无法得到同一袋数，请调整每袋数量；发货记录 1：运费待定');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width!);
      for (const button of host.querySelectorAll('button')) {
        const box = button.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('[data-testid="console-error-fixture"]')).toEqual([]);
    });
  }
}
