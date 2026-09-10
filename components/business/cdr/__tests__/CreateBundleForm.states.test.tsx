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
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock('@/actions/foreman-cdr', () => ({
  createBundleAction: vi.fn(),
}));

import { CreateBundleForm } from '../CreateBundleForm';

const eligible = [
  {
    id: 'order-1',
    orderNo: '20260824001',
    customerRef: '测试客户',
    submittedAt: '2026-08-24T01:00:00.000Z',
    cdrCount: 3,
  },
];

function render(items = eligible) {
  return renderToStaticMarkup(
    <CreateBundleForm from="2026-08-24" to="2026-08-24" eligible={items} />,
  );
}

beforeEach(() => {
  formState.value = null;
  formState.pending = false;
  refresh.mockReset();
});

describe('CreateBundleForm state contract', () => {
  it('通过共享 Checkbox 保留全选与逐单 FormData 契约', () => {
    const html = render();

    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="全选 / 全不选"');
    expect(html).toContain('aria-label="选择工单 20260824001"');
    expect(html).toMatch(
      /<input[^>]*name="orderIds"[^>]*value="order-1"/,
    );
  });

  it('生成中锁定全选与逐单复选框', () => {
    formState.pending = true;
    const html = render();
    const checkboxRoots =
      html.match(/<span[^>]*data-slot="checkbox"[^>]*>/g) ?? [];

    expect(checkboxRoots).toHaveLength(2);
    for (const checkbox of checkboxRoots) {
      expect(checkbox).toContain('data-disabled=""');
      expect(checkbox).toContain('aria-disabled="true"');
    }
  });

  it('uses the no-result state and keeps the disabled reason visible', () => {
    const html = render([]);

    expect(html).toContain('data-kind="no-result"');
    expect(html).toContain('没有匹配的含 CDR 文件的工单');
    expect(html).toContain('调整日期范围');
    expect(html).toContain('先勾选至少一个工单');
    expect(html).not.toContain('title="先勾选');
  });

  it('renders an immediately recoverable receipt for a queued long task', () => {
    formState.value = {
      status: 'queued',
      bundleId: 'bundle-1',
      jobId: 'job-1',
      fileCount: 3,
    };
    const html = render();

    expect(html).toContain('data-slot="long-task-receipt"');
    expect(html).toContain('data-status="accepted"');
    expect(html).toContain('回执 job-1');
    expect(html).toContain('可以离开页面');
    expect(html).toContain('刷新进度');
  });

  it('separates a ready receipt from its mock environment notice', () => {
    formState.value = {
      status: 'success',
      bundleId: 'bundle-2',
      downloadUrl: 'https://files.example.test/bundle-2',
      relativePath: '/api/cdr/bundles/bundle-2',
      expiresAt: '2026-08-25T01:00:00.000Z',
      fileCount: 3,
      isMock: true,
    };
    const html = render();

    expect(html).toContain('data-status="ready"');
    expect(html).toContain('回执 bundle-2');
    expect(html).toContain('https://files.example.test/bundle-2');
    expect(html).toContain('data-slot="env-notice"');
    expect(html).toContain('border-l-info-neutral');
    expect(html).not.toContain('bg-warning');
  });
});
