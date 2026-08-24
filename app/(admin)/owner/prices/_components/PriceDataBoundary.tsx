'use client';

import { unstable_catchError as catchError, type ErrorInfo } from 'next/error';
import { ErrorState } from '@/components/ui-business/ErrorState';

type PriceDataBoundaryFallbackProps = {
  title: string;
  description: React.ReactNode;
  preservedContent: React.ReactNode;
};

export type PriceDataBoundaryProps = PriceDataBoundaryFallbackProps & {
  children?: React.ReactNode;
};

function PriceDataBoundaryFallback(
  props: PriceDataBoundaryFallbackProps,
  { unstable_retry }: ErrorInfo,
) {
  return (
    <div className="min-w-0 space-y-4">
      <ErrorState
        scope="section"
        title={props.title}
        description={props.description}
        onRetry={unstable_retry}
      />
      {props.preservedContent}
    </div>
  );
}

const CatchPriceDataError = catchError<PriceDataBoundaryFallbackProps>(
  PriceDataBoundaryFallback,
);

/**
 * 定价工作台中，详情或预览读取失败时不应卸载已成功的列表。
 * 该边界只处理非预期的渲染/读取异常；表单的预期错误仍作为值返回。
 */
export function PriceDataBoundary({
  children,
  ...fallback
}: PriceDataBoundaryProps) {
  return <CatchPriceDataError {...fallback}>{children}</CatchPriceDataError>;
}
