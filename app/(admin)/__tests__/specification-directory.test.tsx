import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), find: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/db', () => ({ db: { product: { findMany: mocks.find } } }));
import SpecificationsPage from '../owner/rules/specifications/page';
beforeEach(() => { vi.resetAllMocks(); });
it('无产品管理权限不能读取规格', async () => {
  mocks.permission.mockRejectedValue(new Error('forbidden'));
  await expect(SpecificationsPage()).rejects.toThrow('forbidden');
  expect(mocks.find).not.toHaveBeenCalled();
});
it('三条路线分别展示，彩印不套用空白封尺寸且无写入口', async () => {
  mocks.find.mockResolvedValue([
    { id: 'color', category: 'COLOR_PRINT', specification: '大号88×165' },
    { id: 'custom', category: 'CUSTOM_FLAT_FOIL', specification: '大号封90×165' },
  ]);
  const html = renderToStaticMarkup(await SpecificationsPage());
  expect(html).toContain('迷你封50×80');
  expect(html).toContain('大号88×165');
  expect(html).toContain('专版烫金');
  expect(html).toContain('尚未建立统一规格目录');
  expect(html).not.toContain('<form');
  expect(html).not.toContain('<button');
});
