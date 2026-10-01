import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 表单页内容宽度（ui-规范 §8.3「FormPage 档」）的唯一定义：新建 / 编辑 / 配置类
 * 页面统一 max-w-3xl、左对齐，PageHeader 与表单同宽；列表与详情页不包它，保持全宽。
 *
 * `app/_components/FormPage.tsx`、路由级表单骨架与 components/ 内的新建页都复用
 * 这里，不要在别处再写一份宽度。
 */
export const FORM_PAGE_WIDTH_CLASS = 'w-full max-w-3xl';

export function FormPageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="form-page" className={cn(FORM_PAGE_WIDTH_CLASS, 'min-w-0 space-y-6', className)}>
      {children}
    </div>
  );
}
