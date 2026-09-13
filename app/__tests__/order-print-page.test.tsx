import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), requireSession: vi.fn(), title: vi.fn(), order: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session, requireSession: mocks.requireSession }));
vi.mock('@/lib/order/print-access', () => ({ getOrderPrintTitleRef: mocks.title }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: mocks.order }));
vi.mock('@/lib/public-base-url', () => ({ derivePublicBaseUrl: async () => 'https://erp.example.com' }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: '测试工厂' }) }));
vi.mock('@/lib/order/print-layout', () => ({ OrderPrintLayout: () => null }));
vi.mock('@/components/business/order/AutoPrint', () => ({ AutoPrint: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));

import OrderPrintViewPage, { generateMetadata } from '@/app/print/orders/[id]/page';
import { orderPrintTitle } from '@/lib/page-title/titles';

const props = () => ({ params: Promise.resolve({ id: 'order-1' }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.resetAllMocks();
  const session = { user: { id: 'worker-1', role: Role.WORKER } };
  mocks.session.mockResolvedValue(session);
  mocks.requireSession.mockResolvedValue(session);
});

describe('order print page and metadata', () => {
  it('uses a generic title without looking up any order before login', async () => {
    mocks.session.mockResolvedValue(null);
    await expect(generateMetadata(props())).resolves.toEqual({ title: '工单打印' });
    expect(mocks.title).not.toHaveBeenCalled();
  });

  it('uses the print-specific title scope and verified session actor', async () => {
    mocks.title.mockResolvedValue({ orderNo: 'GD-001' });
    await expect(generateMetadata(props())).resolves.toEqual({ title: orderPrintTitle('GD-001') });
    expect(mocks.title).toHaveBeenCalledWith('order-1', { id: 'worker-1', role: Role.WORKER });
  });

  it('does not expose an unauthorized order number in either the title or body', async () => {
    mocks.title.mockResolvedValue(null);
    mocks.order.mockResolvedValue(null);
    await expect(generateMetadata(props())).resolves.toEqual({ title: orderPrintTitle(null) });
    await expect(OrderPrintViewPage(props())).rejects.toThrow('NOT_FOUND');
    expect(mocks.order).toHaveBeenCalledWith('order-1', { id: 'worker-1', role: Role.WORKER }, 'https://erp.example.com');
  });
});
