'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

/** Detail content is prepared by the authorized server page; no mutation in the sheet. */
export function BillDetailDisclosure({ label, triggerText, title, description, children }: {
  label: string; triggerText?: string; title: string; description: string; children: ReactNode;
}) {
  return <Sheet>
    <SheetTrigger render={<Button
      variant={triggerText ? 'link' : 'outline'}
      size="sm"
      aria-label={label}
      className={triggerText ? 'h-auto min-h-11 max-w-full justify-start whitespace-normal break-all px-0 text-left underline md:min-h-8' : undefined}
    />}>{triggerText ?? label}</SheetTrigger>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader className="pr-16">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="min-w-0 space-y-6 px-4 pb-6 break-words">{children}</div>
    </SheetContent>
  </Sheet>;
}
