import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { boundaryCapture } = vi.hoisted(() => ({
  boundaryCapture: {
    fallback: null as null | ((
      props: Record<string, unknown>,
      info: {
        error: Error;
        reset: () => void;
        retry: () => void;
      },
    ) => React.ReactNode),
  },
}));

vi.mock('next/error', () => ({
  catchError:
    (fallback: typeof boundaryCapture.fallback) =>
    ({ children }: { children?: React.ReactNode }) => {
      boundaryCapture.fallback = fallback;
      return children;
    },
}));

import { PriceDataBoundary } from '../PriceDataBoundary';

describe('PriceDataBoundary', () => {
  it('leaves healthy pricing content intact', () => {
    const html = renderToStaticMarkup(
      <PriceDataBoundary
        title="预览暂时无法加载"
        description="版本列表仍可使用"
        preservedContent={<p>已加载的版本列表</p>}
      >
        <p>完整发布预览</p>
      </PriceDataBoundary>,
    );

    expect(html).toContain('完整发布预览');
    expect(html).not.toContain('已加载的版本列表');
    expect(boundaryCapture.fallback).toBeTypeOf('function');
  });

  it('shows a retry without leaking the error and retains successful content', () => {
    const retry = vi.fn();
    const fallback = boundaryCapture.fallback!;
    const html = renderToStaticMarkup(
      fallback(
        {
          title: '发布预览暂时无法加载',
          description: '版本列表仍可使用',
          preservedContent: <p>已加载的版本列表</p>,
        },
        {
          error: new Error('database password leaked'),
          reset: vi.fn(),
          retry: retry,
        },
      ),
    );

    expect(html).toContain('发布预览暂时无法加载');
    expect(html).toContain('已加载的版本列表');
    expect(html).toContain('>重试<');
    expect(html).not.toContain('database password leaked');
  });
});
