'use client';

import {
  useActionState,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionController, ConfirmActionDialog,
} from '@/components/ui-business';
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
  supplierName: string;
  orderNo: string | null;
  totalQty: number | null;
  expectedDateLabel: string;
};

export function OutsourceActions({
  id,
  canReceive,
  canCancel,
  supplierName,
  orderNo,
  totalQty,
  expectedDateLabel,
}: Props) {
  const receiveFormId = useId();
  const cancelFormId = useId();
  const confirmedReceiveRef = useRef(false);
  const [actualDate, setActualDate] = useState('');
  const [receiveConfirmationOpen, setReceiveConfirmationOpen] =
    useState(false);
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
  const contextLabel = [
    `外协厂：${supplierName}`,
    `关联工单：${orderNo ?? '未关联'}`,
    `总数量：${totalQty?.toLocaleString() ?? '未填写'}`,
  ].join(' · ');
  const visibleReceiveState = receivePending ? null : receiveState;
  const visibleCancelState = cancelPending ? null : cancelState;

  function handleReceiveSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmedReceiveRef.current) {
      confirmedReceiveRef.current = false;
      return;
    }
    // 日期输入中的 Enter 不得绕过回货终态确认。
    event.preventDefault();
    setReceiveConfirmationOpen(true);
  }

  return (
    <div className="space-y-3">
      {canReceive ? (
        <form
          id={receiveFormId}
          action={(fd) => startReceive(() => receiveAction(fd))}
          onSubmit={handleReceiveSubmit}
          className="space-y-2"
          aria-busy={receivePending}
          data-risk-level="L2"
        >
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <label className="grid min-w-0 gap-1 text-sm text-muted-foreground">
              回货日期（可留空，默认为今天）
              <input
                type="date"
                name="actualDate"
                value={actualDate}
                onChange={(event) => setActualDate(event.target.value)}
                disabled={receivePending}
                className="min-h-11 rounded-md border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-70"
              />
            </label>
            <ConfirmActionController level="L2"
              formId={receiveFormId}
              open={receiveConfirmationOpen}
              onOpenChange={setReceiveConfirmationOpen}
              disabled={receivePending}
              trigger={
                <Button
                  type="button"
                  disabled={receivePending}
                  aria-busy={receivePending}
                  className="min-h-11"
                >
                  {receivePending ? '正在标记回货…' : '标记已回货'}
                </Button>
              }
              onConfirm={() => {
                confirmedReceiveRef.current = true;
              }}>
              <ConfirmActionDialog action="确认该外协单已回货" changes={[{ label: `${contextLabel} · 回货日期（计划 → 实际）`, old: expectedDateLabel, new: actualDate || '今天' }]} consequences={[
                '外协单将进入已回货终态，不能直接回退。',
                '内部任务和外协工艺全部完成后，关联工单可能自动完工并发送通知。',
                '本操作不会自动确认外协应付金额，也不会记录付款。',
              ]} confirmText="确认已回货" />
            </ConfirmActionController>
          </div>
        </form>
      ) : null}

      {/* Server Function 的 revalidatePath 会立即把 canReceive 刷成 false。
          回执必须在表单外，否则最需要给主管看的覆盖缺口会随表单一起卸载。 */}
      <OutsourceReceiveFeedback state={visibleReceiveState} />

      {canCancel ? (
        <div className="space-y-2" data-risk-level="L2">
          <form
            id={cancelFormId}
            action={() => startCancel(() => cancelAction())}
            aria-busy={cancelPending}
          />
          <ConfirmActionController level="L2"
            formId={cancelFormId}
            cancelLabel="保留外协单"
            disabled={cancelPending}
            trigger={
              <Button
                type="button"
                variant="outline"
                disabled={cancelPending}
                aria-busy={cancelPending}
                className="min-h-11"
              >
                {cancelPending ? '正在取消…' : '取消外协单'}
              </Button>
            }>
            <ConfirmActionDialog action="取消该外协单" changes={[]} consequences={[
              '外协单将进入已取消终态，不能再标记回货或记录付款。',
              '系统会重新核对关联工单的生产完工条件。',
              '关联工单和这张外协单的历史记录不会被删除。',
            ]} confirmText="取消外协单" danger />
          </ConfirmActionController>
        </div>
      ) : null}

      {visibleCancelState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="外协单已取消"
          description="系统已重新核对关联工单的生产完工条件。"
        />
      ) : null}
      {visibleCancelState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="外协单未取消"
          description={visibleCancelState.message}
        />
      ) : null}
      {visibleCancelState?.status === 'invalid' ? (
        <ActionNotice
          tone="error"
          title="外协单未取消"
          description={Object.values(visibleCancelState.fieldErrors)
            .flat()
            .join('；')}
        />
      ) : null}
    </div>
  );
}
