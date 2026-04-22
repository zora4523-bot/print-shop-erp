import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { ChangePasswordForm } from '@/components/business/auth/ChangePasswordForm';

export const metadata = {
  title: '修改密码 · 红包印刷 ERP',
};

export default async function ChangePasswordPage() {
  await requireSession();

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">修改密码</h1>
          <p className="text-sm text-muted-foreground">请输入当前密码以验证身份</p>
        </div>
        <ChangePasswordForm />
        <div className="text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground underline">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
