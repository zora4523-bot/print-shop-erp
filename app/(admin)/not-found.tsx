import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  EMPTY_NO_ACCESS_DESCRIPTION,
  EMPTY_NO_ACCESS_TITLE,
  EmptyState,
} from '@/components/ui-business';

// 管理外壳同时服务管理员与外部销售：返回入口统一走 `/` 角色分发，
// 不把销售引到 /owner（审查 #25）。
export default function AdminNotFound() {
  return (
    <EmptyState
      icon={ShieldOff}
      title={EMPTY_NO_ACCESS_TITLE}
      description={EMPTY_NO_ACCESS_DESCRIPTION}
      action={
        <Link href="/" prefetch={false} className={buttonVariants({ className: 'min-h-11 px-3' })}>
          返回首页
        </Link>
      }
    />
  );
}
