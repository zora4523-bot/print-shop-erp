import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const m = vi.hoisted(() => ({ permission: vi.fn(), list: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: m.permission }));
vi.mock('@/lib/inventory-count', () => ({ listInventoryCountMaterials: m.list }));
vi.mock('@/actions/owner-inventory', () => ({ postInventoryCountAction: vi.fn() }));
vi.mock('@/components/business/material/InventoryCountClient', () => ({ InventoryCountClient: m.client }));
vi.mock('@/components/ui-business', () => ({ PageHeader: () => <h1>库存盘点</h1> }));
import Page from '../owner/materials/count/page';
beforeEach(() => { vi.resetAllMocks(); m.client.mockReturnValue(<div>盘点表单</div>); });
it('keeps the stocktake form and enables client retry after the initial query fails', async () => {
  m.list.mockRejectedValue(new Error('database timeout'));
  expect(renderToStaticMarkup(await Page())).toContain('盘点表单');
  expect(m.client.mock.calls[0][0].initialRows).toBeUndefined();
});
it('retains successful server rows and enforces permission before the query', async () => {
  m.list.mockResolvedValue([]);
  renderToStaticMarkup(await Page());
  expect(m.client.mock.calls[0][0].initialRows).toEqual([]);
  m.list.mockClear(); m.permission.mockRejectedValue(new Error('Forbidden'));
  await expect(Page()).rejects.toThrow('Forbidden');
  expect(m.list).not.toHaveBeenCalled();
});
