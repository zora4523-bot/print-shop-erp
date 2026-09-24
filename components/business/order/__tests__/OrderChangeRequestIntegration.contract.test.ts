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

describe('工单变更申请 UI 集成契约', () => {
  it('销售调用面把当前业务版本和纸质工单版本传给申请表单', () => {
    expect(salesDetailSource).toContain('expectedRevision={order.revision}');
    expect(salesDetailSource).toContain(
      'expectedWorkOrderVersion={order.workOrderVersion}',
    );
    // 入口判断集中在 lib/order/change-request-options.ts（含「已有地址发货」闸口）。
    expect(salesDetailSource).toContain('resolveOrderChangeRequestOptions({');
    expect(salesDetailSource).toContain('shipments: order.shipments');
  });

  it('已有地址发货：销售详情不渲染取消入口，修改申请只剩交期', () => {
    expect(salesDetailSource).toContain('{options.canRequestCancellation ? (');
    expect(salesDetailSource).toContain('dueDateOnly={!options.allowItemChanges}');
    expect(salesDetailSource).toContain('!changeOptions.shipped &&');
    expect(adminDecisionSource).toContain('approvalBlockedReason ? null : (');
  });

  it('管理员详情不再渲染客服专属的修改 / 取消申请表单', () => {
    expect(detailSource).not.toContain('<OrderChangeRequestForm');
    expect(detailSource).not.toContain('<OrderCancellationRequestForm');
    expect(detailSource).not.toContain('CUSTOMER_SERVICE');
  });

  it('管理员待审记录跳转新版工作台，并由工作台挂载修改计价审核', () => {
    expect(detailSource).toContain(
      '#order-detail-actions',
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
