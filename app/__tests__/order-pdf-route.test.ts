import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), order: vi.fn(), mode: vi.fn(), html: vi.fn(), render: vi.fn(),
  enqueue: vi.fn(), wait: vi.fn(), read: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({ auth: (handler: unknown) => handler }));
vi.mock('@/lib/auth/session', () => ({ requireVerifiedSession: mocks.session }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: mocks.order }));
vi.mock('@/lib/public-base-url', () => ({ derivePublicBaseUrl: async () => 'https://erp.example.com' }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: '测试工厂' }) }));
vi.mock('@/lib/background-jobs/mode', () => ({ backgroundJobsMode: mocks.mode }));
vi.mock('@/lib/order/print-html', async (original) => ({
  ...await original<typeof import('@/lib/order/print-html')>(), buildPrintHtml: mocks.html,
}));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: mocks.render }));
vi.mock('@/lib/background-jobs/pdf', () => ({
  enqueueOrderPdfJob: mocks.enqueue, waitForOrderPdfJob: mocks.wait,
  readAndDeletePdfArtifact: mocks.read,
}));

import { handleOrderPdfGet } from '@/app/api/orders/[id]/pdf/route';

const request = (query = '') => handleOrderPdfGet(Object.assign(new NextRequest(`https://erp.example.com/api/orders/order-1/pdf${query}`), { auth: null }) as NextAuthRequest, {
  params: Promise.resolve({ id: 'order-1' }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: Role.ADMIN } });
  mocks.order.mockResolvedValue({ id: 'order-1', orderNo: 'GD-001', customerName: '客户', workOrderVersion: 3 });
  mocks.mode.mockReturnValue('inline');
  mocks.html.mockResolvedValue('<html>ready</html>');
  mocks.render.mockResolvedValue(Buffer.from('pdf'));
  mocks.enqueue.mockResolvedValue('job-1');
  mocks.wait.mockResolvedValue({ status: 'timeout' });
});

describe('order PDF route', () => {
  it('requires authentication before disclosing order information', async () => {
    mocks.session.mockRejectedValue(new UnauthorizedError());
    expect((await request()).status).toBe(401);
    expect(mocks.order).not.toHaveBeenCalled();
  });

  it('returns 404 for an inaccessible order', async () => {
    mocks.order.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each(['?mode=tasks', '?mode=invalid', '?mode=order&mode=tasks'])('rejects invalid or ambiguous mode %s', async (query) => {
    const response = await request(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid print mode' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(['', '?mode=order'])('renders only the production order (%s)', async (query) => {
    const response = await request(query);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(mocks.html).toHaveBeenCalledWith(expect.anything(), { factoryName: '测试工厂' });
    expect(decodeURIComponent(response.headers.get('content-disposition') ?? '')).toContain('_客户.pdf');
  });

  it('binds a queued PDF to the actor, order and version on retries', async () => {
    mocks.mode.mockReturnValue('durable');
    const response = await request();
    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', expectedWorkOrderVersion: 3 }));
    expect(mocks.wait).toHaveBeenCalledWith('job-1', expect.objectContaining({
      expected: { orderId: 'order-1', actorId: 'admin-1', workOrderVersion: 3 },
    }));
    expect(response.headers.get('refresh')).toBe('5;url=/api/orders/order-1/pdf?jobId=job-1');
  });

  it('retries a failed PDF without reusing its failed job', async () => {
    mocks.mode.mockReturnValue('durable');
    mocks.wait.mockResolvedValue({ status: 'failed', errorCode: 'PrintLayoutOverflowError' });
    const response = await request('?jobId=job-old');
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain('href="/api/orders/order-1/pdf"');
    expect(html).not.toContain('job-old');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('discards a PDF if the work order changed during rendering', async () => {
    mocks.order.mockResolvedValueOnce({ id: 'order-1', orderNo: 'GD-001', workOrderVersion: 3 })
      .mockResolvedValueOnce({ id: 'order-1', workOrderVersion: 4 });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('href="/api/orders/order-1/pdf"');
  });
});

it('does not return renderer diagnostics or durable error payloads', async () => {
  const diagnostic = '/private/db/password=secret https://internal.example';
  mocks.render.mockRejectedValue(new Error(diagnostic));
  const response = await request();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'PDF 生成失败', code: 'PDF_GENERATION_FAILED', message: '请重新生成；如仍失败，请联系管理员' });
  mocks.mode.mockReturnValue('durable');
  mocks.wait.mockResolvedValue({ status: 'failed', errorCode: diagnostic });
  const queued = await request('?jobId=job-1');
  expect(queued.status).toBe(500);
  const body = await queued.text();
  expect(body).not.toContain(diagnostic);
  expect(body).toContain('PDF_GENERATION_FAILED');
});

it('passes request auth for verification and uses the verified actor for scope and jobs', async () => {
  const authSession = { user: { id: 'old-token', role: Role.ADMIN }, expires: '2099-01-01' };
  mocks.session.mockResolvedValue({ user: { id: 'worker-1', role: Role.WORKER } });
  mocks.mode.mockReturnValue('durable');
  const req = Object.assign(new NextRequest('https://erp.example.com/api/orders/order-1/pdf'), { auth: authSession }) as NextAuthRequest;
  await handleOrderPdfGet(req, { params: Promise.resolve({ id: 'order-1' }) });
  expect(mocks.session).toHaveBeenCalledWith(authSession);
  expect(mocks.order).toHaveBeenCalledWith('order-1', { id: 'worker-1', role: Role.WORKER }, 'https://erp.example.com');
  expect(mocks.wait).toHaveBeenCalledWith('job-1', expect.objectContaining({ expected: { orderId: 'order-1', actorId: 'worker-1', workOrderVersion: 3 } }));
});
