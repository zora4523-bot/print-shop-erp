'use client';

import { Download, MoreHorizontal, Printer } from 'lucide-react';
import { OrderStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type OrderRowSecondaryAction = {
  id: 'print' | 'pdf';
  label: string;
  href: string;
  newTab?: boolean;
};

/**
 * Read-only destinations are safe for a row already inside the actor's
 * server-scoped result set.
 */
export function orderRowSecondaryActions(input: {
  orderId: string;
  status: OrderStatus;
  canSchedule: boolean;
}): OrderRowSecondaryAction[] {
  return [
    {
      id: 'print',
      label: '打印工单',
      href: `/api/orders/${input.orderId}/pdf?view=inline`,
      newTab: true,
    },
    {
      id: 'pdf',
      label: '下载 PDF',
      href: `/api/orders/${input.orderId}/pdf`,
    },
  ];
}

export function OrderRowMoreActions({
  orderId,
  orderNo,
  status,
  canSchedule,
}: {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  canSchedule: boolean;
}) {
  const actions = orderRowSecondaryActions({ orderId, status, canSchedule });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="min-h-11 min-w-11 lg:min-h-7 lg:min-w-7"
            aria-label={`更多操作：${orderNo}`}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            render={
              <a
                href={action.href}
                target={action.newTab ? '_blank' : undefined}
                rel={action.newTab ? 'noopener noreferrer' : undefined}
              />
            }
          >
            {action.id === 'print' ? (
              <Printer aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
