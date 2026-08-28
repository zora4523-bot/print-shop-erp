import {
  renderToReadableStream,
  renderToStaticMarkup,
} from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAdjustmentsMock, listTiersMock, requirePermissionMock } = vi.hoisted(
  () => ({
    listAdjustmentsMock: vi.fn(),
    listTiersMock: vi.fn(),
    requirePermissionMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/price', () => ({
  listPriceAdjustments: listAdjustmentsMock,
  listPriceTiers: listTiersMock,
}));

import InternalPricingPage from '@/app/(admin)/owner/rules/internal-pricing/page';

async function renderToResolvedMarkup(node: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  requirePermissionMock.mockReset();
  listAdjustmentsMock.mockReset();
  listTiersMock.mockReset();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1' });
  listAdjustmentsMock.mockResolvedValue([]);
  listTiersMock.mockResolvedValue([]);
});

describe('internal direct-order pricing entry', () => {
  it('renders the concise header without waiting for price reads', async () => {
    listTiersMock.mockReturnValue(new Promise(() => {}));
    listAdjustmentsMock.mockReturnValue(new Promise(() => {}));

    const html = renderToStaticMarkup(
      await InternalPricingPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain('内部直单价格');
    expect(html).not.toContain('href="/owner/rules/customer-pricing"');
    expect(html).not.toContain('/owner/prices/external-sales/items');
    expect(html).toContain('正在加载内容');
    expect(listTiersMock).toHaveBeenCalledTimes(1);
    expect(listAdjustmentsMock).toHaveBeenCalledTimes(1);
  });

  it('uses canonical rule-center links and exposes price rules by default', async () => {
    const html = await renderToResolvedMarkup(
      await InternalPricingPage({ searchParams: Promise.resolve({}) }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(html).toContain('内部直单价格');
    expect(html).toContain(
      'href="/owner/rules/internal-pricing/adjustments/new"',
    );
    expect(html).toContain('href="/owner/rules/internal-pricing/tiers/new"');
    expect(html).not.toContain('href="/owner/rules/employee-pay"');
    expect(html).not.toContain('href="/owner/rules/worker-piecework"');
    expect(html).toContain('action="/owner/rules/internal-pricing"');
    expect(html).not.toContain('/owner/prices/external-sales');
    expect(html).not.toContain('/owner/salary/rules');
    expect(html).not.toContain('/owner/salary/piecework-rules');
    expect(html).toContain('价格规则');
    expect(html).toContain('价格阶梯');
    expect(html).toContain('加价规则');
    expect(html).not.toContain('金额口径');
    expect(listTiersMock).toHaveBeenCalledTimes(1);
    expect(listAdjustmentsMock).toHaveBeenCalledTimes(1);
    expect(requirePermissionMock.mock.invocationCallOrder[0]).toBeLessThan(
      listTiersMock.mock.invocationCallOrder[0]!,
    );
    expect(requirePermissionMock.mock.invocationCallOrder[0]).toBeLessThan(
      listAdjustmentsMock.mock.invocationCallOrder[0]!,
    );
    const priceRuleDetails = html.match(/<details\b[^>]*>/)?.[0];
    expect(priceRuleDetails).toBeDefined();
    expect(priceRuleDetails).toMatch(/\sopen=""/);
    expect(priceRuleDetails).toContain('group');
    expect(html).toContain('min-h-11');
  });

  it('opens the internal compatibility area when an internal-price search is active', async () => {
    const html = await renderToResolvedMarkup(
      await InternalPricingPage({
        searchParams: Promise.resolve({ q: '红包' }),
      }),
    );

    expect(listTiersMock).toHaveBeenCalledWith({ q: '红包' });
    expect(listAdjustmentsMock).toHaveBeenCalledWith({ q: '红包' });
    expect(listTiersMock).toHaveBeenCalledTimes(1);
    expect(listAdjustmentsMock).toHaveBeenCalledTimes(1);
    expect(html.match(/<details\b[^>]*>/)?.[0]).toMatch(/\sopen=""/);
  });
});
