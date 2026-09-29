import { cn } from '@/lib/utils';

/**
 * 表单页内容宽度（ui-规范 §8.3「FormPage 档」）：新建 / 编辑 / 配置类页面
 * 统一 max-w-3xl、左对齐，PageHeader 与表单同宽；列表与详情页不包它，保持全宽。
 */
export const FORM_PAGE_WIDTH_CLASS = 'w-full max-w-3xl';

export function FormPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="form-page" className={cn(FORM_PAGE_WIDTH_CLASS, 'min-w-0 space-y-6', className)}>
      {children}
    </div>
  );
}
