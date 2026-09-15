import { redirect } from 'next/navigation';
import { COMPANY_NAME } from '@/lib/app-brand';
import { LoginForm } from '@/components/business/auth/LoginForm';
import { getSession } from '@/lib/auth/session';
import { safeInternalPath } from '@/lib/auth/redirect';

export const metadata = {
  title: '登录',
};

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await getSession();
  const { from } = await searchParams;
  // Guard against open-redirect via `?from=//evil` .
  const safeFrom = safeInternalPath(from);

  if (session) {
    redirect(safeFrom);
  }

  return (
    <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{COMPANY_NAME}</h1>
      </div>
      <LoginForm from={safeFrom} />
    </div>
  );
}
