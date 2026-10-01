import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), order: vi.fn(), enqueue: vi.fn(), wait: vi.fn(),
  read: vi.fn(), html: vi.fn(), render: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireVerifiedSession: mocks.session }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: mocks.order }));
vi.mock('@/lib/public-base-url', () => ({ derivePublicBaseUrl: async () => 'https://erp.example.test' }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: '测试工厂' }) }));
vi.mock('@/lib/background-jobs/mode', () => ({ backgroundJobsMode: () => 'durable' }));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: mocks.html, buildOrderPdfFilename: vi.fn() }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: mocks.render }));
vi.mock('@/lib/background-jobs/pdf', () => ({
  enqueueOrderPdfJob: mocks.enqueue, waitForOrderPdfJob: mocks.wait,
  readPdfArtifact: mocks.read,
}));

import { handleOrderPdfGet } from '@/app/api/orders/[id]/pdf/handler';

it('recovers a ready job whose PDF file was removed without exposing its diagnostics or reusing the job', async () => {
  const artifactName = 'private-consumed-artifact.pdf';
  const artifactPath = `/private/erp-artifacts/${artifactName}`;
  const missingFile = Object.assign(new Error(`ENOENT: open '${artifactPath}'`), {
    code: 'ENOENT', path: artifactPath, syscall: 'open',
    bytes: Buffer.from('%PDF-private-recovery-bytes'),
  });
  missingFile.stack = `Error: ENOENT\n at private-stack-frame (${artifactPath}:1:2)`;
  mocks.session.mockResolvedValue({ user: { id: 'admin-recovery', role: Role.ADMIN } });
  mocks.order.mockResolvedValue({ id: 'order-recovery', workOrderVersion: 3, items: [] });
  mocks.wait.mockResolvedValue({ status: 'ready', artifactName });
  mocks.read.mockRejectedValue(missingFile);

  const request = Object.assign(new NextRequest(
    'https://erp.example.test/api/orders/order-recovery/pdf?jobId=job-consumed&mode=order',
  ), { auth: null }) as NextAuthRequest;
  const response = await handleOrderPdfGet(request, {
    params: Promise.resolve({ id: 'order-recovery' }),
  });

  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(artifactName);
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.html).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
  expect(response.status).toBe(500);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-disposition')).toBeNull();
  expect(response.headers.get('refresh')).toBeNull();

  const body = await response.text();
  expect(body).toContain('PDF 产物不可用');
  expect(body).toContain('生成结果已过期或被清理，请点击下方按钮重新生成。');
  const retryLinks = [...body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  expect(retryLinks).toEqual(['/api/orders/order-recovery/pdf?regenerate=1', '/print/orders/order-recovery', '/orders/order-recovery', '/owner/background-jobs']);
  const publicPayload = JSON.stringify({ headers: Object.fromEntries(response.headers), body });
  for (const diagnostic of [artifactName, artifactPath, 'ENOENT', 'private-stack-frame', '%PDF', 'job-consumed', 'jobId']) {
    expect(publicPayload).not.toContain(diagnostic);
  }
});
