import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import { canAttachOutsource } from '@/lib/order/status-machine';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { CreateOrderOutsourceLink } from '../CreateOrderOutsourceLink';

const { requirePermission, listOutsourceOrders } = vi.hoisted(() => ({
  requirePermission: vi.fn(), listOutsourceOrders: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission }));
vi.mock('@/lib/outsource', () => ({ listOutsourceOrders }));
import OutsourceListPage from '@/app/(admin)/foreman/outsource/page';

describe('外协创建入口', () => {
  it.each(Object.values(OrderStatus))('管理员在 %s 得到真实操作或状态原因', (status) => {
    const html = renderToStaticMarkup(<CreateOrderOutsourceLink orderId="order-1" canManage status={status} />);
    if (canAttachOutsource(status)) {
      expect(html).toContain('href="/foreman/outsource/new?orderId=order-1"');
      expect(html).not.toContain('不能新建外协单');
    } else {
      expect(html).not.toContain('href=');
      expect(html).toContain(`当前工单${ORDER_STATUS_REGISTRY[status].label}，不能新建外协单`);
      expect(html).toContain('disabled');
    }
  });
  it('不向无权限用户提供管理入口', () => {
    expect(renderToStaticMarkup(<CreateOrderOutsourceLink orderId="order-1" canManage={false} status={OrderStatus.DRAFT} />)).toBe('');
  });
  it('包装中且已完工不能新建外协单，原因默认折叠', () => {
    const html = renderToStaticMarkup(<CreateOrderOutsourceLink orderId="order-1" canManage status={OrderStatus.PACKING} completedAt="2026-09-27T12:00:00Z" />);
    expect(html).toContain('当前工单已完成生产');
    expect(html).not.toContain('href=');
    expect(html).toContain('<details');
    expect(html).not.toContain(' open');
  });
  it('空态只有一个去工单列表的创建入口', async () => {
    const html = renderToStaticMarkup(await OutsourceListPage());
    expect(requirePermission).toHaveBeenCalledWith('outsource:manage');
    expect(html).toContain('href="/orders"');
    expect(html.match(/从工单创建外协/g)).toHaveLength(1);
    expect(html).toContain('先选择工单，再创建外协');
  });
  it('列表拒绝权限不足，不读取全局列表', async () => {
    listOutsourceOrders.mockClear();
    requirePermission.mockRejectedValueOnce(new Error('无权限'));
    await expect(OutsourceListPage()).rejects.toThrow('无权限');
    expect(listOutsourceOrders).not.toHaveBeenCalled();
  });
});
