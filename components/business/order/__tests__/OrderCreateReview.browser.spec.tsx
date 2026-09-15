import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
import { OrderCreateFeeDetails } from '../OrderCreateFeeDetails';
import { OrderSubmissionReviewDialog } from '../order-form-b/OrderSubmissionReviewDialog';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width} ${theme}: review keeps fee sources and reachable confirmation at every viewport`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const onConfirm = vi.fn();
    flushSync(() => root.render(<OrderSubmissionReviewDialog
      open onOpenChange={() => {}} orderName="新年工单"
      items={[{ id: 'style', number: 1, quantityLabel: '1,000', specification: '大号封',
        materialSummary: '珠光艳闪 160g', processSummary: '正面亚金', artwork: { name: '未上传设计图', missing: true }, amountLabel: '¥ 123.45' }]}
      receiver={{ name: '张先生', phone: '13800138000', address: '广东省佛山市南海区测试路1号' }}
      feeDetails={<OrderCreateFeeDetails
        usesExternalSalesPricing={false}
        quoteItems={[{ key: 'style', label: '局部烫金 · 大号封', status: 'complete', amount: '123.45', pricingSource: 'ADMIN', components: [] }]}
        packaging={{ label: '不包装', status: 'complete', amount: '0' }} logistics={null}
      />}
      totalLabel="¥ 123.45" onBack={() => {}} onConfirm={onConfirm}
    />));
    await expect.element(page.getByRole('dialog')).toBeVisible();
    const review = page.getByRole('region', { name: '费用复核' });
    await expect.element(review.getByText('人工价', { exact: true })).toBeVisible();
    await expect.element(review.getByText('¥ 0.00', { exact: true })).toBeVisible();
    for (const button of document.querySelectorAll('[role="dialog"] button')) {
      const rect = button.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[role="dialog"]')).toEqual([]);
    await page.getByRole('button', { name: '确认无误，提交', exact: true }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
}
