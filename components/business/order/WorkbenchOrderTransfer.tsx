'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readWorkbenchTransfer } from '@/lib/workbench/order-transfer';
import type { WorkbenchItemQuoteInput } from '@/lib/workbench/item-quote';
import { Button } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';

/** Separate local-draft namespace keeps an existing unfinished order intact. */
export function WorkbenchOrderTransfer({
  id,
  scope,
  existingDraftKey,
  transferDraftKey,
  onApply,
  onContinue,
}: {
  id: string;
  scope: string;
  existingDraftKey: string;
  transferDraftKey: string;
  onApply: (input: WorkbenchItemQuoteInput) => string | null;
  onContinue: () => void;
}) {
  const router = useRouter();
  const handlers = useRef({ onApply, onContinue });
  useEffect(() => {
    handlers.current = { onApply, onContinue };
  }, [onApply, onContinue]);
  const [choice, setChoice] = useState<WorkbenchItemQuoteInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  function apply(input: WorkbenchItemQuoteInput) {
    const message = handlers.current.onApply(input);
    if (message) setError(message);
    else {
      setChoice(null);
      setDone(true);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(transferDraftKey)) {
          handlers.current.onContinue();
          setDone(true);
          return;
        }
        const input = readWorkbenchTransfer(window.sessionStorage, scope, id);
        if (!input) {
          setError('报价条件已过期或无法读取，请返回工作台重新选择');
          return;
        }
        if (window.localStorage.getItem(existingDraftKey)) setChoice(input);
        else {
          const message = handlers.current.onApply(input);
          if (message) setError(message);
          else setDone(true);
        }
      } catch {
        setError('浏览器暂时无法读取报价条件，请返回工作台重试');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, scope, existingDraftKey, transferDraftKey]);
  if (done) return null;
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="带入报价条件"
    >
      {error ? (
        <ActionNotice tone="error" title={error} />
      ) : choice ? (
        <p>本机还有未完成工单。使用本次报价会另存一份草稿，原草稿保留。</p>
      ) : (
        <p role="status">正在带入款式条件…</p>
      )}
      {choice && !error ? (
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            type="button"
            onClick={() => apply(choice)}
          >
            使用本次报价创建工单
          </Button>
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            onClick={() => router.replace('/orders/new')}
          >
            继续原工单
          </Button>
        </div>
      ) : null}
      {error ? (
        <Button
          className="min-h-11"
          type="button"
          variant="outline"
          onClick={() => router.replace('/workbench')}
        >
          返回工作台
        </Button>
      ) : null}
    </section>
  );
}
