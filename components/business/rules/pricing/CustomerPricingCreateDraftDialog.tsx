'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type CustomerPricingCreateDraftDialogProps = {
  dialogId: string;
  open: boolean;
  purposeLabel: string;
  returnHref: string;
  children: ReactNode;
};

export function CustomerPricingCreateDraftDialog({
  dialogId,
  open,
  purposeLabel,
  returnHref,
  children,
}: CustomerPricingCreateDraftDialogProps) {
  const router = useRouter();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) router.replace(returnHref, { scroll: false });
      }}
    >
      <DialogContent id={dialogId} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>发起{purposeLabel}调价</DialogTitle>
          <DialogDescription>
            新草稿发布前不影响当前报价；填写原因后即可进入价格编辑。
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
