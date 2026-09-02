import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const detailSource = readFileSync(
  path.join(process.cwd(), 'app/(admin)/orders/[id]/page.tsx'),
  'utf8',
);
const salesDetailSource = readFileSync(
  path.join(
    process.cwd(),
    'components/business/order/SalesOrderDetailView.tsx',
  ),
  'utf8',
);

function sourceBlock(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('工单变更申请 UI 集成契约', () => {
  it('销售与客服调用面都把当前业务版本和纸质工单版本传给申请表单', () => {
    for (const source of [detailSource, salesDetailSource]) {
      expect(source).toContain('expectedRevision={order.revision}');
      expect(source).toContain(
        'expectedWorkOrderVersion={order.workOrderVersion}',
      );
    }
  });

  it('客服修改状态覆盖后端允许集合，并在生产版本状态提供取消申请', () => {
    const requestPolicy = sourceBlock(
      detailSource,
      'const canRequestChange =',
      'const customerChargeByShipmentAndCategory =',
    );
    for (const status of [
      'DRAFT',
      'SUBMITTED',
      'SCHEDULING',
      'IN_PRODUCTION',
      'CONFIRMED',
      'RELEASED',
      'FOILING',
      'PACKING',
    ]) {
      expect(requestPolicy).toContain(`order.status === OrderStatus.${status}`);
    }
    expect(requestPolicy).toContain('user.role === Role.CUSTOMER_SERVICE');
    expect(requestPolicy).toContain('order.submitterId === user.id');
    expect(requestPolicy).toContain('!pendingChangeRequest');
    expect(requestPolicy).toContain('const canRequestCancellation =');
    expect(detailSource).toContain('<OrderCancellationRequestForm');
  });

  it('管理员待审记录跳转新版工作台，不再挂载旧审核表单', () => {
    expect(detailSource).toContain(
      '/orders?queue=all&signal=pending-change#wo=${encodeURIComponent(order.orderNo)}',
    );
    expect(detailSource).not.toContain('OrderChangeReviewForm');
  });
});
