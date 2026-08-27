import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/production', () => ({
  reassignProductionTaskAction: vi.fn(),
  releaseTaskToClaimPoolAction: vi.fn(),
}));

import { ReassignTaskForm } from '../ReassignTaskForm';

describe('ReassignTaskForm claim-pool boundary', () => {
  it('自由抢单开启且没有可改派师傅时，保留显式释放入池的服务端表单', () => {
    const html = renderToStaticMarkup(
      <ReassignTaskForm
        taskId="task-1"
        orderId="order-1"
        currentWorkerId={null}
        craftId="craft-1"
        eligibleWorkers={[]}
        selfClaimEnabled
      />,
    );

    expect(html).toContain('没有岗位/机型匹配的启用师傅');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="task-1"');
    expect(html).toContain('释放到抢单池');
    expect(html).not.toContain('选择师傅…');
  });

  it('自由抢单关闭时不渲染可执行的释放表单', () => {
    const html = renderToStaticMarkup(
      <ReassignTaskForm
        taskId="task-1"
        orderId="order-1"
        currentWorkerId={null}
        craftId="craft-1"
        eligibleWorkers={[]}
        selfClaimEnabled={false}
      />,
    );

    expect(html).toContain('自由抢单当前已关闭');
    expect(html).not.toContain('释放到抢单池');
    expect(html).not.toContain('name="taskId"');
  });
});
