'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

/** Detail content is prepared by the authorized server page; no mutation in the sheet. */
export function BillDetailDisclosure({ label, title, description, children }: {
  label: string; title: string; description: string; children: ReactNode;
}) {
  return <Sheet>
    <SheetTrigger render={<Button variant="outline" size="sm" />}>{label}</SheetTrigger>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader className="pr-16">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="min-w-0 space-y-6 px-4 pb-6 break-words">{children}</div>
    </SheetContent>
  </Sheet>;
}
