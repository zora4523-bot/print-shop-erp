import Link from 'next/link';
import type { OrderStatus } from '@/generated/prisma/enums';
import { outsourceUnavailableReason } from '@/lib/order/outsource-eligibility';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { DisabledReason } from '@/components/ui-business';

export function CreateOrderOutsourceLink({ orderId, status, completedAt, canManage }: {
  orderId: string;
  status: OrderStatus;
  completedAt?: Date | string | null;
  canManage: boolean;
}) {
  if (!canManage) return null;
  const reason = outsourceUnavailableReason({ status, completedAt });
  if (reason) {
    return (
      <Disclosure>
        <DisclosureSummary className="px-3">外协操作</DisclosureSummary>
        <DisabledReason cause="status" reason={reason}>
          <Button type="button" disabled variant="outline" size="sm">创建外协单</Button>
        </DisabledReason>
      </Disclosure>
    );
  }
  return (
    <Link href={`/foreman/outsource/new?orderId=${orderId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      创建外协单
    </Link>
  );
}
