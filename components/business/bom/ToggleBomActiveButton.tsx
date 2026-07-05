'use client';

import { useTransition } from 'react';
import { setBomActiveAction } from '@/actions/owner-boms';
import { Button } from '@/components/ui/button';

export function ToggleBomActiveButton({
  bomId,
  currentlyActive,
}: {
  bomId: string;
  currentlyActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={currentlyActive ? 'destructive' : 'outline'}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await setBomActiveAction(bomId, !currentlyActive);
        });
      }}
    >
      {pending ? '处理中…' : currentlyActive ? '停用 BOM' : '启用 BOM'}
    </Button>
  );
}
