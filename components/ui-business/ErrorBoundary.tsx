'use client';

import { unstable_catchError as catchError, type ErrorInfo } from 'next/error';
import { ErrorState, type ErrorStateScope } from './ErrorState';

type ErrorBoundaryFallbackProps = {
  scope?: ErrorStateScope;
  title?: string;
  description?: React.ReactNode;
  retryLabel?: string;
  action?: React.ReactNode;
  className?: string;
};

export type ErrorBoundaryProps = ErrorBoundaryFallbackProps & {
  children?: React.ReactNode;
};

function ErrorBoundaryFallback(
  props: ErrorBoundaryFallbackProps,
  { unstable_retry }: ErrorInfo,
) {
  return (
    <ErrorState
      scope={props.scope}
      title={props.title}
      description={
        props.description ?? '其他内容仍可继续使用，请重试当前区域。'
      }
      retryLabel={props.retryLabel}
      onRetry={unstable_retry}
      action={props.action}
      className={props.className}
    />
  );
}

/**
 * Next.js 16 的真实组件级错误边界。预期的表单错误仍应作为值返回；
 * 这里只捕获渲染期的非预期异常，并通过 unstable_retry 重取当前区域。
 */
const CatchErrorBoundary = catchError<ErrorBoundaryFallbackProps>(
  ErrorBoundaryFallback,
);

export function ErrorBoundary({ children, ...fallback }: ErrorBoundaryProps) {
  return <CatchErrorBoundary {...fallback}>{children}</CatchErrorBoundary>;
}
