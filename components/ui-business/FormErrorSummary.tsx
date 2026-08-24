import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FormErrorSummaryItem = {
  fieldId: string;
  label: string;
  message: string;
};

export type FormErrorSummaryProps = {
  errors: readonly FormErrorSummaryItem[];
  title?: string;
  className?: string;
};

/** 表单提交失败后的可聚焦错误索引；每一项直接跳转到对应控件 id。 */
export function FormErrorSummary({
  errors,
  title = '请检查以下内容',
  className,
}: FormErrorSummaryProps) {
  const titleId = useId();
  if (errors.length === 0) return null;

  return (
    <section
      data-slot="form-error-summary"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        'rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        <h2 id={titleId} className="font-medium">
          {title}
        </h2>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-7 text-sm">
        {errors.map((error) => (
          <li key={`${error.fieldId}:${error.message}`}>
            <a
              href={`#${error.fieldId}`}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              {error.label}：{error.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
