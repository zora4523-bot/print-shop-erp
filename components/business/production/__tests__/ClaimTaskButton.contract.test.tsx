import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/production', () => ({
  claimTaskFormAction: vi.fn(),
}));

import { ClaimTaskButton } from '../ClaimTaskButton';

describe('ClaimTaskButton', () => {
  it('使用 hidden taskId 的原生 Server Action form，并保留车间触控尺寸', () => {
    const html = renderToStaticMarkup(<ClaimTaskButton taskId="task-1" />);
    expect(html).toContain('<form');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="task-1"');
    expect(html).toContain('抢下这个任务');
    expect(html).toContain('min-h-12');
  });
});
