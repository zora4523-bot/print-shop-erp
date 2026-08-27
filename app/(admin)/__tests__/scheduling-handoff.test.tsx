import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { boardMock, pendingBoardMock, requirePermissionMock } = vi.hoisted(
  () => ({
    boardMock: vi.fn(),
    pendingBoardMock: vi.fn(() => null),
    requirePermissionMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/production', () => ({
  getPendingSchedulingBoard: boardMock,
}));
vi.mock('@/components/business/production/PendingSchedulingBoard', () => ({
  PendingSchedulingBoard: pendingBoardMock,
}));

import SchedulingListPage, {
  parseSchedulingHandoffOrderIds,
} from '@/app/(admin)/foreman/scheduling/page';

beforeEach(() => {
  boardMock.mockReset();
  pendingBoardMock.mockClear();
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
});

describe('scheduling list handoff', () => {
  it('parses repeated IDs, rejects illegal values and caps unique IDs at 30', () => {
    const validIds = Array.from({ length: 32 }, (_, index) => `order-${index}`);
    const parsed = parseSchedulingHandoffOrderIds([
      validIds[0],
      validIds[0],
      'contains whitespace',
      ...validIds.slice(1),
      'x'.repeat(65),
    ]);

    expect(parsed.provided).toBe(true);
    expect(parsed.orderIds).toEqual(validIds.slice(0, 30));
    expect(parsed.invalidCount).toBe(2);
    expect(parsed.overflowCount).toBe(2);
    expect(parseSchedulingHandoffOrderIds(undefined)).toEqual({
      provided: false,
      orderIds: [],
      invalidCount: 0,
      overflowCount: 0,
    });
  });

  it('keeps permission gating and passes only the pending-board intersection', async () => {
    boardMock.mockResolvedValue({
      orders: [{ id: 'order-1' }, { id: 'order-3' }],
      workers: [{ id: 'worker-1' }],
    });

    renderToStaticMarkup(
      await SchedulingListPage({
        searchParams: Promise.resolve({
          orderIds: ['order-1', 'order-2', 'bad id', 'order-1'],
        }),
      }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('order:schedule');
    expect(boardMock).toHaveBeenCalledTimes(1);
    expect(pendingBoardMock).toHaveBeenCalledTimes(1);
    const pendingBoardProps = pendingBoardMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(pendingBoardProps[0]).toMatchObject({
      handoff: {
        requestedOrderIds: ['order-1', 'order-2'],
        matchedOrderIds: ['order-1'],
        invalidCount: 1,
        overflowCount: 0,
      },
    });
  });

  it('states the outcome when a handoff has no pending order', async () => {
    boardMock.mockResolvedValue({ orders: [], workers: [] });

    const html = renderToStaticMarkup(
      await SchedulingListPage({
        searchParams: Promise.resolve({ orderIds: ['order-1'] }),
      }),
    );

    expect(html).toContain('交接工单未命中当前待排产');
    expect(html).toContain('所选工单当前均不可排产');
    expect(html).toContain('没有分配任何任务');
    expect(html).not.toContain('系统未执行任何写入');
    expect(pendingBoardMock).not.toHaveBeenCalled();
  });
});
