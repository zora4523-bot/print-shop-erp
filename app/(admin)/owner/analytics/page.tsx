import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { OwnerAnalytics } from '@/components/business/dashboard/OwnerAnalytics';

export const metadata = { title: '经营概览' };

export default async function OwnerAnalyticsPage() {
  await requirePermission('report:all');

  return (
    <div className="space-y-4">
      <PageHeader
        title="经营概览"
        actions={
          <Link
            href="/owner"
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" />
            返回工作台
          </Link>
        }
      />
      <OwnerAnalytics />
    </div>
  );
}
