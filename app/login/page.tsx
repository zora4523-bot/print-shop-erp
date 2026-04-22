import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/business/auth/LoginForm';
import { getSession } from '@/lib/auth/session';

export const metadata = {
  title: '登录 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await getSession();
  const { from } = await searchParams;
  const safeFrom = typeof from === 'string' && from.startsWith('/') ? from : '/';

  if (session) {
    redirect(safeFrom);
  }

  return (
    <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold">红包印刷 ERP</h1>
        <p className="text-sm text-muted-foreground">用内部账号登录</p>
      </div>
      <LoginForm from={safeFrom} />
    </div>
  );
}
