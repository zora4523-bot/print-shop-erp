import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { OrderExportStatus } from '@/generated/prisma/enums';
import '@/app/globals.css';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/actions/order-export', () => ({ requestOrderExportAction: vi.fn() }));
import { OrderExportControls } from '../OrderExportControls';
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it.each([401, 404, 410])('shows the reason for HTTP %s in the order export drawer without saving JSON', async status => {
  vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{"error":"test"}', { status, headers: { 'Content-Type': 'application/json' } }));
  const create = vi.spyOn(URL, 'createObjectURL');
  flushSync(() => root.render(<OrderExportControls params={{}} filteredTotal={1} hasFilters={false} filteredRequestKey="filtered" allRequestKey="all" recent={[{
    id: 'export1', status: OrderExportStatus.READY, scope: 'all', fileName: '工单.xlsx', matchedOrderCount: 1, byteSize: '100', expiresAt: '2026-10-05T00:00:00Z', completedAt: '2026-10-02T00:00:00Z', createdAt: '2026-10-02T00:00:00Z',
  }]} />));
  await page.getByRole('button', { name: '导出工单', exact: true }).click();
  await page.getByRole('link', { name: '下载', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent(status === 401 ? '请重新登录后重试' : '请重新生成');
  expect(create).not.toHaveBeenCalled();
});
