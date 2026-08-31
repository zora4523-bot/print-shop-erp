import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineType, WorkerType } from '@/generated/prisma/enums';

const { getCraftSummaryMock, requirePermissionMock } = vi.hoisted(() => ({
  getCraftSummaryMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/craft', () => ({
  getCraftSummary: getCraftSummaryMock,
  listCraftsPage: vi.fn(),
}));
vi.mock('@/actions/owner-crafts', () => ({
  createCraftAction: vi.fn(),
  createRuleCenterCraftAction: vi.fn(),
  updateCraftAction: vi.fn(async () => ({ status: 'success' as const })),
}));
vi.mock('@/components/business/craft/ToggleActiveButton', () => ({
  ToggleActiveButton: () => null,
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

import { EditCraftCatalogItem } from '../catalog/CraftCatalogPages';

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  getCraftSummaryMock.mockReset();
});

describe('craft catalog business language', () => {
  it('does not expose the internal craft code on the edit page', async () => {
    const internalCode = 'INTERNAL_CRAFT_CODE';
    getCraftSummaryMock.mockResolvedValue({
      id: 'craft-1',
      name: '局部烫金',
      code: internalCode,
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.HAND_PRESS,
      sortOrder: 10,
      isActive: true,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const page = await EditCraftCatalogItem({
      params: Promise.resolve({ id: 'craft-1' }),
      routeBase: '/owner/rules/crafts',
    });
    const text = visibleText(renderToStaticMarkup(page));

    expect(text).toContain('编辑工艺：局部烫金');
    expect(text).not.toContain('代码');
    expect(text).not.toContain(internalCode);
  });
});
