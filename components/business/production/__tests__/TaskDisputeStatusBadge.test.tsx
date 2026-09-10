import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductionTaskDisputeStatus } from '@/generated/prisma/enums';

import { TaskDisputeStatusBadge } from '../TaskDisputeStatusBadge';

// 徽章从 TaskDisputePanel 里的私有 shadcn Badge 提到共享组件后，
// 师傅端与管理端共用同一份 label / tone（PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY）。

describe('TaskDisputeStatusBadge', () => {
  it.each([
    [ProductionTaskDisputeStatus.PENDING, '待处理', 'warning'],
    [ProductionTaskDisputeStatus.RESOLVED, '已解决', 'success'],
    [ProductionTaskDisputeStatus.REJECTED, '已驳回', 'danger'],
  ])('renders %s as a status badge', (status, label, tone) => {
    const html = renderToStaticMarkup(<TaskDisputeStatusBadge status={status} />);
    expect(html).toContain(label);
    expect(html).toContain(`data-tone="${tone}"`);
  });
});
