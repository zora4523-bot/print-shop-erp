import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  'components/business/order/AdminOrderWorkspaceList.tsx',
  'utf8',
);
const batchSource = readFileSync(
  'components/business/order/AdminOrderBatchActions.tsx',
  'utf8',
);
const decisionSource = readFileSync(
  'components/business/order/AdminOrderDecisionPanel.tsx',
  'utf8',
);

describe('admin order asynchronous action contract', () => {
  it('keeps star writes pending and synchronously guards against duplicate clicks', () => {
    expect(workspaceSource).toContain('if (inFlightRef.current) return;');
    expect(workspaceSource).toContain('startTransition(async () =>');
    expect(workspaceSource).toContain('await setOrderStarredAction');
    expect(workspaceSource).toContain('inFlightRef.current = false;');
    expect(workspaceSource).not.toContain(
      'void setOrderStarredAction({ orderId: order.id, starred: next }).then',
    );
  });

  it('keeps batch writes pending through the server response and reports exceptions', () => {
    expect(batchSource).toContain('if (inFlightRef.current) return;');
    expect(batchSource).toContain('startTransition(async () =>');
    expect(batchSource).toContain('await runAdminOrderBatchAction');
    expect(batchSource).toContain('请先打开工单核对实际记录，再决定是否重试');
    expect(batchSource).not.toContain('void runAdminOrderBatchAction');
  });

  it('refreshes both batch surfaces after a structured partial failure', () => {
    expect(batchSource).toContain("result.status === 'partial_failure'");
    expect(batchSource).toContain('结果未知');
    expect(decisionSource).toContain("result.status === 'partial_failure'");
    expect(decisionSource).toContain('router.refresh()');
  });
});
