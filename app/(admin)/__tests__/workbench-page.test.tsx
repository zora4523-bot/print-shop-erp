import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  options: vi.fn(),
  crafts: vi.fn(),
  sales: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/order/create-order-options', () => ({
  listExternalCreateOrderOptions: mocks.options,
}));
vi.mock('@/lib/craft', () => ({ listActiveCraftOrderOptions: mocks.crafts }));
vi.mock('@/lib/order/external-sales-association', () => ({ listExternalSalesAccountOptions: mocks.sales }));
vi.mock('@/components/business/workbench/SalesWorkbench', () => ({
  SalesWorkbench: () => null,
}));
import WorkbenchPage from '../workbench/page';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ id: 's', role: 'SALES' });
  mocks.crafts.mockResolvedValue([]);
});
it('checks permission before catalog access', async () => {
  mocks.permission.mockRejectedValue(new Error('unauthorized'));
  await expect(WorkbenchPage()).rejects.toThrow('unauthorized');
  expect(mocks.options).not.toHaveBeenCalled();
});
it('keeps editorial material available when the catalog fails', async () => {
  mocks.options.mockRejectedValue(new Error('database unavailable'));
  const page = await WorkbenchPage();
  expect(page.props.catalogUnavailable).toBe(true);
  expect(page.props.options.products).toEqual([]);
});
it('uses the current catalog', async () => {
  const options = {
    products: [{ id: 'current' }],
    papers: [],
    specifications: [],
    foilColors: [],
  };
  mocks.options.mockResolvedValue(options);
  const page = await WorkbenchPage();
  expect(page.props.options).toBe(options);
  expect(page.props.catalogUnavailable).toBe(false);
});
// 业主 2026-09-24：管理员从工作台直接建寄样品 / 打样也必须选择外部销售。
it('passes active external salespeople to administrators only', async () => {
  mocks.options.mockResolvedValue({ products: [], papers: [], specifications: [], foilColors: [] });
  const sales = await WorkbenchPage();
  expect(sales.props.externalSalesAccounts).toBeUndefined();
  expect(mocks.sales).not.toHaveBeenCalled();
  const accounts = [{ id: 'sales-1', displayName: '外销甲', username: 'a' }];
  mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  mocks.sales.mockResolvedValue(accounts);
  const admin = await WorkbenchPage();
  expect(admin.props.externalSalesAccounts).toBe(accounts);
  mocks.sales.mockResolvedValue([]);
  expect((await WorkbenchPage()).props.externalSalesAccounts).toEqual([]);
});
