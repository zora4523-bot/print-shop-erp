'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  markOutsourceReceivedAction,
  cancelOutsourceAction,
} from '@/actions/outsource';
import type { OutsourceMutationResult } from '@/actions/outsource.types';
import { OutsourceReceiveFeedback } from './OutsourceReceiveFeedback';

type Props = {
  id: string;
  canReceive: boolean;
  canCancel: boolean;
};

export function OutsourceActions({ id, canReceive, canCancel }: Props) {
  const receiveBound = markOutsourceReceivedAction.bind(null, id);
  const [receiveState, receiveAction] = useActionState<
    OutsourceMutationResult | null,
    FormData
  >(receiveBound, null);
  const [receivePending, startReceive] = useTransition();

  const [cancelState, cancelAction] = useActionState<
    OutsourceMutationResult | null,
    void
  >(async () => cancelOutsourceAction(id), null);
  const [cancelPending, startCancel] = useTransition();

  return (
    <div className="space-y-3">
      {canReceive ? (
        <form
          action={(fd) => startReceive(() => receiveAction(fd))}
          className="space-y-2"
        >
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground">
              回货日期（可留空，默认为今天）
            </label>
            <input
              type="date"
              name="actualDate"
              className="rounded-md border bg-background px-3 py-1 text-sm"
            />
            <Button type="submit" disabled={receivePending}>
              {receivePending ? '处理中…' : '已回货'}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Server Function 的 revalidatePath 会立即把 canReceive 刷成 false。
          回执必须在表单外，否则最需要给主管看的覆盖缺口会随表单一起卸载。 */}
      <OutsourceReceiveFeedback state={receiveState} />

      {canCancel ? (
        <form action={() => startCancel(() => cancelAction())}>
          <Button type="submit" variant="outline" disabled={cancelPending}>
            {cancelPending ? '处理中…' : '取消外协单'}
          </Button>
          {cancelState?.status === 'error' ? (
            <span className="ml-3 text-xs text-destructive">
              {cancelState.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
