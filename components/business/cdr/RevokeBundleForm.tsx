'use client';

import { useActionState, useEffect, useId } from 'react';
import { useRouter } from 'next/navigation';
import { revokeBundleAction } from '@/actions/foreman-cdr';
import type { RevokeBundleResult } from '@/actions/foreman-cdr.types';
import {
  ConfirmActionController,
  ConfirmActionDialog,
  PendingButton,
} from '@/components/ui-business';

export function RevokeBundleForm({ bundleId }: { bundleId: string }) {
  const router = useRouter();
  const formId = useId();
  const [state, formAction, pending] = useActionState<RevokeBundleResult | null, FormData>(
    revokeBundleAction,
    null,
  );

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  return (
    <div className="mt-2 space-y-1">
      <form id={formId} action={formAction} aria-busy={pending}>
        <input type="hidden" name="bundleId" value={bundleId} />
        <ConfirmActionController
          level="L2"
          formId={formId}
          disabled={pending}
          trigger={
            <PendingButton
              pending={pending}
              pendingLabel="撤销中…"
              variant="outline"
              size="sm"
              className="min-h-9"
            >
              撤销下载链接
            </PendingButton>
          }
        >
          <ConfirmActionDialog
            action="确认撤销这个 CDR 下载链接？"
            changes={[]}
            consequences={[
              '撤销后，已发送给外协方的链接立即失效。',
              '下载包历史记录和文件不会删除；需要时可按原条件重新生成。',
            ]}
            confirmText="确认撤销链接"
            danger
          />
        </ConfirmActionController>
      </form>
      {state?.status === 'error' ? (
        <p role="alert" className="max-w-xs text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
