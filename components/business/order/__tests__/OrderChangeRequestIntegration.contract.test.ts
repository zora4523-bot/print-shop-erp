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
const adminDecisionSource = readFileSync(
  path.join(
    process.cwd(),
    'components/business/order/AdminOrderDecisionPanel.tsx',
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
    expect(requestPolicy).toContain('canRequestOrderModification(user, order, Boolean(pendingChangeRequest))');
    expect(requestPolicy).toContain('user.role === Role.CUSTOMER_SERVICE');
    expect(salesDetailSource).toContain('ORDER_MODIFIABLE_STATUSES.includes(order.status)');
    expect(requestPolicy).toContain('const canRequestCancellation =');
    expect(detailSource).toContain('<OrderCancellationRequestForm');
  });

  it('管理员待审记录跳转新版工作台，并由工作台挂载修改计价审核', () => {
    expect(detailSource).toContain(
      '/orders?queue=all&signal=pending-change#wo=${encodeURIComponent(order.orderNo)}',
    );
    expect(detailSource).not.toContain('OrderChangeReviewForm');
    expect(adminDecisionSource).toContain("=== 'MODIFY'");
    expect(adminDecisionSource).toContain('<OrderChangeReviewForm');
    expect(adminDecisionSource).toContain(
      'requestId={order.pendingChangeRequest.id}',
    );
    expect(adminDecisionSource).toContain('currentItems={order.items.map');
    expect(adminDecisionSource).toContain(
      "order.pendingChangeRequest?.type === 'CANCEL'",
    );
  });
});
