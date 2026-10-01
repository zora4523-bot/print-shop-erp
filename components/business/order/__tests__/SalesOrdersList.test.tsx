import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OrderPricingStatus,
  OrderStatus,
} from '@/generated/prisma/enums';
import { SalesOrdersList } from '../SalesOrdersList';
import { query, row } from './sales-orders-list-fixtures';

describe('SalesOrdersList', () => {
  it('uses independent compact ledger columns while retaining preview, copy, billing and detail actions', () => {
    const order = { ...row(), bill: { id: 'bill-1', period: '2026-08', status: 'CONFIRMED' as const } };
    const html = renderToStaticMarkup(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-27T08:00:00Z" />);
    const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
    const headers = [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(headers).toEqual(['工单号', '下单日期', '工单名称', '工艺 / 纸张', '数量', '工单金额', '状态', '月账单', '操作']);
    expect(table).toContain('title="预览工单 GD-260827-001"');
    expect(table).toContain('title="快速预览工单"');
    expect(table).toContain('aria-label="复制工单号 GD-260827-001"');
    expect(table).toContain('查看物流');
    expect(table).toContain('href="/orders/order-1"');
    expect(table).toContain('查看原因');
    expect(table).toContain('href="/sales/bills/bill-1"');
    expect(table).toContain('2026-08 账单 · 待付款');
    expect(table).toContain('局部烫金 · 触感纸');
    expect(table).toContain('待工厂核价');
    expect(table).not.toContain('<img');
    expect(table).not.toContain('75312884629891');
    expect(table).not.toContain('记录版本');
  });

  it('不把缺少款式和数量的记录显示为零件生产', () => {
    const html = renderToStaticMarkup(<SalesOrdersList orders={[{ ...row(), itemCount: 0, totalQuantity: 0, items: [] }]} query={query()} nowIso="2026-09-30T00:00:00Z" />);
    expect(html).toContain('款式与数量未填写');
    expect(html).not.toContain('>0</b> 款');
  });
  it('renders the sales card fields without exposing workshop details', () => {
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[row()]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
        footer={<div>分页</div>}
      />,
    );

    expect(html).toContain('data-slot="sales-orders-list"');
    expect(html).toContain(
      'data-slot="sales-orders-list" class="min-w-0"',
    );
    expect(html).toContain('aria-label="销售工单列表" class="grid gap-2 md:hidden"');
    expect(html).toContain('data-sales-order-card=""');
    expect(html).toContain('data-sales-order-row=""');
    expect(html).toContain('aria-label="销售工单明细表"');
    expect(html).toContain('2026/08/27');
    expect(html).toContain('下单日期');
    expect(html).toContain(
      'data-slot="sales-orders-pagination" class="mt-4"',
    );
    expect(html).toContain('端午定制');
    // 业主 2026-09-27：销售卡片不再展示客户，也不再有「未填客户」占位。
    expect(html).not.toContain('未填客户');
    expect(html).toContain('GD-260827-001');
    expect(html).toContain('>2</b> 款');
    expect(html).toContain('2,000');
    expect(html).toContain('局部烫金 · 触感纸');
    expect(html).toContain('待工厂处理');
    expect(html).toContain('待工厂核价');
    expect(html).toContain('修改申请中');
    expect(html).toContain('中通');
    expect(html).toContain('75312884629891');
    expect(html).not.toContain('师傅');
    expect(html).not.toContain('计件成本');
    expect(html).not.toContain('生产任务');
    // 状态药丸走共享 StatusBadge（SUBMITTED → 待工厂处理 / info），
    // 不再是销售端自带的第二套 tone 类名表。
    expect(html).toContain('data-tone="info"');
    expect(html).not.toContain('bg-foreground text-background');
  });

  it.each(Object.values(OrderStatus))('%s 卡片直接链接完整详情，不受操作权限白名单影响', (status) => {
    const html = renderToStaticMarkup(
      <SalesOrdersList orders={[{ ...row(), status }]} query={query()} nowIso="2026-09-12T08:00:00Z" />,
    );
    expect(html).toContain('href="/orders/order-1"');
    expect(html).not.toContain('href="/orders/order-1#change-request"');
    expect(html).toContain('title="快速预览工单"');
  });

  it('取消申请显示真实类型，不混用修改申请文案', () => {
    const html = renderToStaticMarkup(
      <SalesOrdersList orders={[{ ...row(), pendingChangeRequest: { ...row().pendingChangeRequest!, type: 'CANCEL' } }]} query={query()} nowIso="2026-09-12T08:00:00Z" />,
    );
    expect(html).toContain('取消申请中');
    expect(html).not.toContain('修改申请中');
  });

  it('待定费用不伪装成 0 元，已知合计明确排除待定项', () => {
    const order = {
      ...row(),
      pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
      pricingAttentionReason: null,
      pendingChangeRequest: null,
      needsAction: false,
    };
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[order]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
      />,
    );

    expect(html).toContain('不含待定');
    expect(html).not.toContain('¥待定');
    expect(html).not.toContain('NaN');
  });

  it('有款式照片时提供可访问的画廊预览入口', () => {
    const firstPhoto = {
      url: 'https://static.example.com/styles/dragon-boat-front.jpg',
      previewUrl: 'https://static.example.com/styles/dragon-boat-front.jpg?full',
      fileName: '端午正面.jpg',
    };
    const order = {
      ...row(),
      thumbnail: {
        url: 'https://static.example.com/orders/work-order.png',
        previewUrl: 'https://static.example.com/orders/work-order.png?full',
        fileName: '工单.png',
      },
      items: [
        {
          ...row().items[0]!,
          thumbnail: firstPhoto,
        },
        {
          ...row().items[0]!,
          id: 'item-2',
          sequence: 2,
          name: '端午定制 图2',
          thumbnail: {
            url: 'https://static.example.com/styles/dragon-boat-back.jpg',
            previewUrl: 'https://static.example.com/styles/dragon-boat-back.jpg?full',
            fileName: '端午背面.jpg',
          },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[order]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
      />,
    );

    expect(html).toContain('data-sales-order-thumbnail-trigger=""');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('预览款式照片：端午定制，共 2 款');
    expect(html).toContain('title="点击查看款式照片"');
    expect(html).toContain(
      'src="https://static.example.com/styles/dragon-boat-front.jpg"',
    );
    expect(html).not.toContain(
      'https://static.example.com/orders/work-order.png',
    );
  });

  it('不把打印视觉基线快照当成款式照片', () => {
    const printSnapshot = {
      url: 'https://static.example.com/orders/order-print.png',
      previewUrl: 'https://static.example.com/orders/order-print.png?full',
      fileName: 'order-print-1-designs-chromium-darwin.png',
    };
    const order = {
      ...row(),
      thumbnail: printSnapshot,
      items: [
        {
          ...row().items[0]!,
          thumbnail: printSnapshot,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[order]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
      />,
    );

    expect(html).not.toContain('data-sales-order-thumbnail-trigger=""');
    expect(html).not.toContain(printSnapshot.url);
    expect(html).toContain('暂无款式照片');
  });
});
