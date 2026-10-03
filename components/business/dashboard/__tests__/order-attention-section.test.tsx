import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

vi.mock('server-only', () => ({}));

const { permission, count } = vi.hoisted(() => ({ permission: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/db', () => ({ db: { order: { count } } }));
import { OrderAttentionSection } from '../OrderAttentionSection';
import { buildAdminWorkspaceResultWhere } from '@/lib/order/admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';

const actor = { id: 'admin', role: Role.ADMIN };
beforeEach(() => { vi.clearAllMocks(); permission.mockResolvedValue(actor); count.mockResolvedValue(0); });
describe('工单待办', () => {
  it('每个计数与其目标列表使用相同筛选，变更按工单计数', async () => {
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const html = renderToStaticMarkup(await OrderAttentionSection());
    for (const signal of ['pending-confirmation', 'pending-pricing', 'pending-change', 'pending-release']) {
      expect(count).toHaveBeenCalledWith({ where: buildAdminWorkspaceResultWhere(actor, parseAdminOrderWorkspaceQuery({ queue: 'all', signal }).query) });
      expect(html).toContain(`/orders?queue=all&amp;signal=${signal}`);
    }
    expect(html).toContain('待审核变更工单');
    expect(html).toContain('待安排');
    expect(html).not.toContain('待排产');
    expect(html).toContain('3 单');
  });
  it('授权失败时不读取计数', async () => {
    permission.mockRejectedValueOnce(new Error('unauthorized'));
    await expect(OrderAttentionSection()).rejects.toThrow('unauthorized');
    expect(count).not.toHaveBeenCalled();
  });
  it('读取失败交由错误边界处理，不能显示为零', async () => {
    count.mockRejectedValueOnce(new Error('unavailable'));
    await expect(OrderAttentionSection()).rejects.toThrow('unavailable');
  });
});
