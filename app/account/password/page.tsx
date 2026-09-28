import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { ChangePasswordForm } from '@/components/business/auth/ChangePasswordForm';

export const metadata = {
  title: '修改密码',
};

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login?from=/account/password');

  return (
    // main + touch-viewport：这条路由同样在 (admin)/(worker) 壳之外，
    // 既没有地标也拿不到 44px 触控兜底。见 app/(auth)/login/layout.tsx。
    <main className="touch-viewport min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">修改密码</h1>
          <p className="text-sm text-muted-foreground">请输入当前密码以验证身份</p>
        </div>
        <ChangePasswordForm />
        <div className="text-sm">
          <Link href="/" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
