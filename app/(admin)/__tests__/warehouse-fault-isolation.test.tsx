import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requirePermissionMock,
  getWarehouseDashboardMock,
  listRecentStockTransfersMock,
  listRecentInventoryCountsMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getWarehouseDashboardMock: vi.fn(),
  listRecentStockTransfersMock: vi.fn(),
  listRecentInventoryCountsMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/warehouse', () => ({
  getWarehouseDashboard: getWarehouseDashboardMock,
}));

vi.mock('@/lib/stock-transfer', () => ({
  listRecentStockTransfers: listRecentStockTransfersMock,
}));

vi.mock('@/lib/inventory-count-posting', () => ({
  listRecentInventoryCounts: listRecentInventoryCountsMock,
}));

import OwnerWarehousesPage from '@/app/(admin)/owner/warehouses/page';

function neverSettles(): Promise<never> {
  return new Promise(() => undefined);
}

function findElementProps(
  node: ReactNode,
  componentName: string,
): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementProps(child, componentName));
  }
  if (!isValidElement(node)) return [];

  const type = node.type as { name?: string };
  const props = node.props as Record<string, unknown>;
  const matches = type.name === componentName ? [props] : [];
  return matches.concat(
    findElementProps(props.children as ReactNode, componentName),
  );
}

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  getWarehouseDashboardMock.mockReset();
  listRecentStockTransfersMock.mockReset();
  listRecentInventoryCountsMock.mockReset();
});

describe('warehouse page fault isolation', () => {
  it('returns the page shell without waiting for any warehouse read', async () => {
    const dashboardPromise = neverSettles();
    const transfersPromise = neverSettles();
    const countsPromise = neverSettles();
    getWarehouseDashboardMock.mockReturnValue(dashboardPromise);
    listRecentStockTransfersMock.mockReturnValue(transfersPromise);
    listRecentInventoryCountsMock.mockReturnValue(countsPromise);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      OwnerWarehousesPage(),
      new Promise<'timed-out'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timed-out'), 500);
      }),
    ]);
    clearTimeout(timeoutId);

    expect(result).not.toBe('timed-out');
    if (result === 'timed-out') return;

    expect(requirePermissionMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock).toHaveBeenCalledWith('warehouse:manage');
    expect(getWarehouseDashboardMock).toHaveBeenCalledOnce();
    expect(listRecentStockTransfersMock).toHaveBeenCalledOnce();
    expect(listRecentStockTransfersMock).toHaveBeenCalledWith(8);
    expect(listRecentInventoryCountsMock).toHaveBeenCalledOnce();
    expect(listRecentInventoryCountsMock).toHaveBeenCalledWith(8);
    for (const read of [
      getWarehouseDashboardMock,
      listRecentStockTransfersMock,
      listRecentInventoryCountsMock,
    ]) {
      expect(requirePermissionMock.mock.invocationCallOrder[0]).toBeLessThan(
        read.mock.invocationCallOrder[0]!,
      );
    }

    expect(
      findElementProps(result, 'WarehouseDashboardContent'),
    ).toEqual([{ dashboardPromise }]);
    expect(findElementProps(result, 'WarehouseSettingsContent')).toEqual([
      { dashboardPromise },
    ]);
    expect(findElementProps(result, 'RecentStockTransfersContent')).toEqual([
      { recentTransfersPromise: transfersPromise },
    ]);
    expect(findElementProps(result, 'RecentInventoryCountsContent')).toEqual([
      { recentCountsPromise: countsPromise },
    ]);

    const boundaries = findElementProps(result, 'ErrorBoundary');
    expect(boundaries.map((props) => props.title)).toEqual([
      '仓库作业数据暂时无法加载',
      '最近调拨单暂时无法加载',
      '最近盘点单暂时无法加载',
      '仓库与库位设置暂时无法加载',
    ]);
    expect(
      findElementProps(
        boundaries[1]!.children as ReactNode,
        'RecentStockTransfersContent',
      ),
    ).toHaveLength(1);
    expect(
      findElementProps(
        boundaries[2]!.children as ReactNode,
        'RecentInventoryCountsContent',
      ),
    ).toHaveLength(1);
  });
});
