import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateBundleResult } from '@/actions/foreman-cdr.types';

const { formState, refresh } = vi.hoisted(() => ({
  formState: {
    value: null as CreateBundleResult | null,
    pending: false,
  },
  refresh: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [formState.value, vi.fn(), formState.pending],
    useEffect: vi.fn(),
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock('@/actions/foreman-cdr', () => ({
  createBundleAction: vi.fn(),
}));

import { RegenerateBundleForm } from '../RegenerateBundleForm';

function render() {
  return renderToStaticMarkup(
    <RegenerateBundleForm
      from="2026-08-20"
      to="2026-08-21"
      orderIds={['order-1', 'order-2']}
    />,
  );
}

beforeEach(() => {
  formState.value = null;
  formState.pending = false;
  refresh.mockReset();
});

describe('RegenerateBundleForm state contract', () => {
  it('preserves the original date window and exact order selection', () => {
    const html = render();

    expect(html).toContain('按同条件重新生成');
    expect(html).toContain('name="from" value="2026-08-20"');
    expect(html).toContain('name="to" value="2026-08-21"');
    expect(html.match(/name="orderIds"/g)).toHaveLength(2);
    expect(html).toContain('value="order-1"');
    expect(html).toContain('value="order-2"');
    expect(html).toContain('原记录仍保留');
  });

  it('announces a queued retry receipt without hiding the action context', () => {
    formState.value = {
      status: 'queued',
      bundleId: 'bundle-new',
      jobId: 'job-new',
      fileCount: 4,
    };

    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain('已受理，回执 job-new');
  });

  it('shows recoverable validation feedback', () => {
    formState.value = {
      status: 'invalid',
      fieldErrors: { orderIds: ['原工单已不存在，请重新选择'] },
    };

    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('原工单已不存在，请重新选择');
  });

  it('uses the readable foreground token for compact success feedback', () => {
    formState.value = {
      status: 'success',
      bundleId: 'bundle-new',
      downloadUrl: 'https://example.test/api/cdr/bundles/bundle-new',
      relativePath: '/api/cdr/bundles/bundle-new',
      expiresAt: '2026-08-25T00:00:00.000Z',
      fileCount: 4,
      isMock: false,
    };

    const html = render();
    expect(html).toContain('text-success-foreground');
    expect(html).not.toMatch(/\btext-success(?:\s|")/);
  });
});
