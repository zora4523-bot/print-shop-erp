import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// 销售 / 客服自服务壳：目前只挂 /sales/bills（看自己的应收账单）。
// 跟 /foreman /owner 一样，每个 Server Action / page 的资源所有权
// 校验仍在自己内部做（详情页比对 bill.salesUserId === user.id），
// 此 layout 只挡 UI shell。
export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { user } = session;
  if (user.role !== Role.SALES && user.role !== Role.CUSTOMER_SERVICE) {
    // OWNER 走自己的 /owner/bills；其他角色没有理由进 /sales。
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              红包印刷 ERP · 我的
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/orders" className="text-muted-foreground hover:text-foreground">
                工单
              </Link>
              <Link href="/sales/bills" className="font-medium">
                我的账单
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {user.displayName} · {roleLabel(user.role)}
            </span>
            <Link
              href="/account/password"
              className="text-muted-foreground hover:text-foreground underline"
            >
              修改密码
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
