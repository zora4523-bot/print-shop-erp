import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { boundaryCapture } = vi.hoisted(() => ({
  boundaryCapture: {
    fallback: null as null | ((props: Record<string, unknown>, info: {
      error: Error;
      reset: () => void;
      retry: () => void;
    }) => React.ReactNode),
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

import { ErrorBoundary } from '../ErrorBoundary';

describe('ErrorBoundary', () => {
  it('matches the installed Next.js runtime export rather than only the mock', async () => {
    const runtime = await vi.importActual<typeof import('next/error')>('next/error');
    expect(runtime.catchError).toBeTypeOf('function');
  });

  it('uses the Next component boundary and leaves healthy children intact', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>已加载的区域</p>
      </ErrorBoundary>,
    );

    expect(html).toContain('已加载的区域');
    expect(boundaryCapture.fallback).toBeTypeOf('function');
  });

  it('renders a scoped retry fallback for an unexpected render error', () => {
    const retry = vi.fn();
    const fallback = boundaryCapture.fallback!;
    const rendered = fallback(
      { scope: 'section', title: '这块数据没加载出来' },
      { error: new Error('boom'), reset: vi.fn(), retry },
    ) as React.ReactElement<{ onRetry: () => void }>;
    expect(rendered.props.onRetry).toBe(retry);
    rendered.props.onRetry();
    expect(retry).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain('data-scope="section"');
    expect(html).toContain('这块数据没加载出来');
    expect(html).toContain('>重试<');
  });
});
