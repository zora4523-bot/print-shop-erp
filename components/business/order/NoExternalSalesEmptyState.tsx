import Link from 'next/link';
import { EmptyState } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';

/** 业主 2026-09-24：管理员建单必须归属一个启用的外部销售；一个都没有时不能建单。 */
export function NoExternalSalesEmptyState() {
  return (
    <EmptyState
      title="暂无可关联的外部销售账号"
      description="管理员建单必须归属一个启用的外部销售。请先在账号管理中创建或启用外部销售账号，再回来新建工单。"
      action={
        <Link href="/owner/accounts" className={buttonVariants()}>
          前往账号管理
        </Link>
      }
    />
  );
}
