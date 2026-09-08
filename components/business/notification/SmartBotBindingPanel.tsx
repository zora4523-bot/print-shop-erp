'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createSmartBotBindingCodeAction } from '@/actions/owner-notifications';
import { Button } from '@/components/ui/button';
import { ActionNotice, PendingButton } from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';

type BindingCodeReceipt = {
  bindingCode: string;
  expiresAt: string;
};

type Props = {
  channelId: string;
  isBound: boolean;
  targetMasked: string | null;
  boundAt: string | null;
};

export function SmartBotBindingPanel({
  channelId,
  isBound,
  targetMasked,
  boundAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<BindingCodeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  function generateBindingCode() {
    setError(null);
    setCopyStatus(null);
    startTransition(async () => {
      const result = await createSmartBotBindingCodeAction(channelId);
      if (result.status === 'success') {
        setReceipt({
          bindingCode: result.bindingCode,
          expiresAt: result.expiresAt,
        });
        return;
      }
      setReceipt(null);
      setError(result.message);
    });
  }

  async function copyBindingCode() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.bindingCode);
      setCopyStatus('绑定码已复制');
    } catch {
      setCopyStatus('复制失败，请手动选中完整绑定码');
    }
  }

  function refreshBindingStatus() {
    // A refresh can preserve this Client Component's local state. Drop the
    // one-time plaintext before asking the server for the newly bound state.
    setReceipt(null);
    setCopyStatus(null);
    router.refresh();
  }

  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4 shadow-sm"
      aria-labelledby="smart-bot-binding-title"
    >
      <div className="space-y-1">
        <h2 id="smart-bot-binding-title" className="font-semibold">
          绑定企业微信群
        </h2>
        <p className="text-sm text-muted-foreground">
          {isBound
            ? '通知发往以下群聊。'
            : '生成绑定码，在目标企业微信群 @机器人并发送完整绑定码。'}
        </p>
      </div>

      {isBound ? (
        <div className="space-y-2">
          <ActionNotice
            tone="success"
            title="已绑定企业微信群"
            description={
              <>
                <span className="font-mono">
                  {targetMasked ?? '目的地已隐藏'}
                </span>
                {boundAt ? (
                  <span className="ml-2">
                    · {formatDateTimeShanghai(new Date(boundAt))} 绑定
                  </span>
                ) : null}
              </>
            }
          />
          <p className="text-xs text-muted-foreground">
            如需换群，请新建通知目标。
          </p>
        </div>
      ) : (
        <ActionNotice
          tone="warning"
          title="尚未绑定"
        />
      )}

      {receipt && !isBound ? (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">一次性绑定码</p>
            <code className="block break-all rounded-md border bg-background px-3 py-2 text-sm select-all">
              {receipt.bindingCode}
            </code>
            <p className="text-xs text-muted-foreground">
              请在 {formatDateTimeShanghai(new Date(receipt.expiresAt))}{' '}
              前在目标群 @机器人并发送。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={copyBindingCode}>
              复制绑定码
            </Button>
            <Button type="button" variant="ghost" onClick={refreshBindingStatus}>
              我已发送，刷新绑定状态
            </Button>
          </div>
          {copyStatus ? (
            <p role="status" className="text-xs text-muted-foreground">
              {copyStatus}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ActionNotice tone="error" title="绑定码生成失败" description={error} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!isBound ? (
          <PendingButton
            type="button"
            pending={pending}
            pendingLabel="生成中…"
            onClick={generateBindingCode}
          >
            生成一次性绑定码
          </PendingButton>
        ) : null}
        {!receipt ? (
          <Button type="button" variant="ghost" onClick={() => router.refresh()}>
            刷新绑定状态
          </Button>
        ) : null}
      </div>

      {receipt && !isBound ? <p className="text-xs text-muted-foreground">重新生成绑定码后，旧码失效。</p> : null}
    </section>
  );
}
