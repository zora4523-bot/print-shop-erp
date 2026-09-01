'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  confirmFactoryOrderAction,
  holdFactoryOrderAction,
  rejectFactoryOrderAction,
  releaseFactoryOrderAction,
  resumeFactoryOrderAction,
  runAdminOrderBatchAction,
  settleFactoryOrderAction,
  type AdminOrderWorkflowActionResult,
} from '@/actions/admin-order-workflow';
import {
  previewOrderCancellationSettlementAction,
  reviewOrderChangeRequestAction,
} from '@/actions/order';
import type { CancellationSettlementReference } from '@/lib/order/change-request';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type FormMode =
  | 'reject'
  | 'hold'
  | 'resume'
  | 'change-approve'
  | 'change-deny'
  | null;

const REJECT_REASONS = [
  ['PAPER_OUT', '纸张库存不足'],
  ['DESIGN_ERROR', '设计图有误'],
] as const;
const HOLD_REASONS = [
  ...REJECT_REASONS,
  ['PRICE_PENDING', '待工厂核价'],
] as const;
type ReasonCode = (typeof HOLD_REASONS)[number][0];
type ReviewResult = Awaited<ReturnType<typeof reviewOrderChangeRequestAction>>;
type DecisionTask = () => Promise<AdminOrderWorkflowActionResult | ReviewResult>;

function ConfirmationPreflightNotice({ order }: { order: AdminOrderWorkspaceRow }) {
  if (order.status !== 'PENDING_FACTORY' && order.status !== 'SUBMITTED') {
    return null;
  }
  return (
    <div
      className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${
        order.confirmationPreflight.ok
          ? 'border-success/40 bg-success/10 text-success-foreground'
          : 'border-warning/40 bg-warning/10 text-warning-foreground'
      }`}
    >
      {order.confirmationPreflight.ok ? (
        <p className="font-medium">确认预检通过</p>
      ) : (
        <>
          <p className="font-medium">确认预检未通过</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {order.confirmationPreflight.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AdminDecisionActions({
  openMode,
  order,
  pending,
  run,
  runOneBatch,
}: {
  openMode: (mode: Exclude<FormMode, null>) => void;
  order: AdminOrderWorkspaceRow;
  pending: boolean;
  run: (task: DecisionTask) => void;
  runOneBatch: (command: 'CREATE_PRINT' | 'MARK_PRINTED') => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {order.fee.source === 'PENDING' ? (
        <Link
          href={`/orders/${order.id}#pricing-review`}
          prefetch={false}
          className={buttonVariants({ size: 'sm' })}
        >
          录入人工核价
        </Link>
      ) : null}
      {order.capabilities.confirm ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              confirmFactoryOrderAction({
                orderId: order.id,
                expectedRevision: order.revision,
                expectedWorkOrderVersion: order.workOrderVersion,
              }),
            )
          }
        >
          确认工单
        </Button>
      ) : null}
      {order.capabilities.reject ? (
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => openMode('reject')}>
          驳回
        </Button>
      ) : null}
      {order.capabilities.hold ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => openMode('hold')}>
          暂停
        </Button>
      ) : null}
      {order.capabilities.resume ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => openMode('resume')}>
          恢复生产
        </Button>
      ) : null}
      {order.capabilities.release ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              releaseFactoryOrderAction({
                orderId: order.id,
                expectedRevision: order.revision,
                expectedWorkOrderVersion: order.workOrderVersion,
                printIdempotencyKey: operationKey('drawer-release-print'),
              }),
            )
          }
        >
          下发 + 打印
        </Button>
      ) : null}
      {order.capabilities.ship ? (
        <Link
          href={`/orders/${order.id}#ship-order`}
          prefetch={false}
          className={buttonVariants({ size: 'sm' })}
        >
          录运单发货
        </Link>
      ) : null}
      {order.capabilities.createPrint ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => runOneBatch('CREATE_PRINT')}>
          创建打印
        </Button>
      ) : null}
      {order.capabilities.markPrinted ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => runOneBatch('MARK_PRINTED')}>
          标记已打印
        </Button>
      ) : null}
      {order.capabilities.settle ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              settleFactoryOrderAction({
                orderId: order.id,
                expectedRevision: order.revision,
                expectedWorkOrderVersion: order.workOrderVersion,
              }),
            )
          }
        >
          结算
        </Button>
      ) : null}
      {order.capabilities.reviewChange && order.pendingChangeRequest ? (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => openMode('change-approve')}>
            批准{order.pendingChangeRequest.type === 'CANCEL' ? '取消' : '修改'}
          </Button>
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => openMode('change-deny')}>
            拒绝申请
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function AdminOrderDecisionPanel({
  order,
}: {
  order: AdminOrderWorkspaceRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<FormMode>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode>('PAPER_OUT');
  const [note, setNote] = useState('');
  const [figs, setFigs] = useState('');
  const [producedQty, setProducedQty] = useState('');
  const [settleFee, setSettleFee] = useState('');
  const [settleFeeAdjustmentReason, setSettleFeeAdjustmentReason] =
    useState('');
  const [settlementPreview, setSettlementPreview] =
    useState<CancellationSettlementReference | null>(null);
  const [message, setMessage] = useState('');

  const hasAnyAction = Object.values(order.capabilities).some(Boolean);
  if (!hasAnyAction) return null;

  function finish(result: AdminOrderWorkflowActionResult | ReviewResult) {
    if (result.status === 'success') {
      setMessage('操作成功；服务端已记录裁决与最新版本。');
      setMode(null);
      router.refresh();
      return;
    }
    if (result.status === 'invalid') {
      setMessage(
        Object.values(result.fieldErrors).flat().join('；') ||
          '请检查裁决字段',
      );
      return;
    }
    setMessage(result.message);
  }

  function run(task: DecisionTask) {
    setMessage('');
    startTransition(() => {
      void task().then(finish);
    });
  }

  function openMode(nextMode: Exclude<FormMode, null>) {
    if (nextMode === 'reject' || nextMode === 'hold') {
      setReasonCode('PAPER_OUT');
    }
    setMode(nextMode);
  }

  function runOneBatch(command: 'CREATE_PRINT' | 'MARK_PRINTED') {
    setMessage('');
    startTransition(() => {
      void runAdminOrderBatchAction({
        requestId: operationKey('drawer-batch'),
        command,
        items: [
          {
            orderId: order.id,
            expectedRevision: order.revision,
            expectedWorkOrderVersion: order.workOrderVersion,
            ...(order.pendingPrintJobId
              ? { requestJobId: order.pendingPrintJobId }
              : {}),
          },
        ],
      }).then((result) => {
        if (result.status !== 'success') {
          finish(result);
          return;
        }
        const item = result.result.items[0];
        if (!item || item.status === 'skipped') {
          setMessage(item?.message ?? '该工单未执行');
          return;
        }
        setMessage('操作成功；打印事实已追加记录。');
        router.refresh();
      });
    });
  }

  function previewCancellation() {
    const change = order.pendingChangeRequest;
    const parsedProduced = Number.parseInt(producedQty.trim(), 10);
    if (
      !change ||
      change.type !== 'CANCEL' ||
      !Number.isSafeInteger(parsedProduced) ||
      parsedProduced < 0
    ) {
      setMessage('请先填写有效的已产数量');
      return;
    }
    setMessage('');
    startTransition(() => {
      void previewOrderCancellationSettlementAction(null, {
        requestId: change.id,
        producedQty: parsedProduced,
      }).then((result) => {
        if (result.status === 'success') {
          setSettlementPreview(result.preview);
          setSettleFee(result.preview.referenceSettleFee);
          setMessage('已按服务端当前发布价计算参考结算价');
          return;
        }
        if (result.status === 'invalid') {
          setMessage(Object.values(result.fieldErrors).flat().join('；'));
          return;
        }
        setMessage(result.message);
      });
    });
  }

  function submitDecision() {
    if (mode === 'reject' || mode === 'hold') {
      const payload = {
        orderId: order.id,
        reasonCode,
        reasonNote: note,
        affectedFigs: parseFigs(figs),
        idempotencyKey: operationKey(`drawer-${mode}`),
      };
      run(() =>
        mode === 'reject'
          ? rejectFactoryOrderAction(payload)
          : holdFactoryOrderAction(payload),
      );
      return;
    }
    if (mode === 'resume') {
      run(() =>
        resumeFactoryOrderAction({
          orderId: order.id,
          recoveryEvidence: { resolution: note },
          note,
          idempotencyKey: operationKey('drawer-resume'),
        }),
      );
      return;
    }
    const change = order.pendingChangeRequest;
    if (!change || (mode !== 'change-approve' && mode !== 'change-deny')) return;
    const parsedProduced = producedQty.trim()
      ? Number.parseInt(producedQty.trim(), 10)
      : undefined;
    run(() =>
      reviewOrderChangeRequestAction(null, {
        requestId: change.id,
        decision: mode === 'change-approve' ? 'APPROVE' : 'DENY',
        reviewRemark: note.trim() || null,
        ...(change.type === 'CANCEL' && parsedProduced !== undefined
          ? {
              producedQty: parsedProduced,
              ...(settleFee.trim() ? { settleFee: settleFee.trim() } : {}),
              ...(settleFeeAdjustmentReason.trim()
                ? {
                    settleFeeAdjustmentReason:
                      settleFeeAdjustmentReason.trim(),
                  }
                : {}),
            }
          : {}),
      }),
    );
  }

  return (
    <section
      aria-labelledby="admin-order-decision-title"
      className="mb-6 rounded-xl border border-foreground/15 bg-muted/20 p-3"
    >
      <h3 id="admin-order-decision-title" className="text-sm font-semibold">
        工厂裁决
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        价表版本与结算时间由服务端在锁内重读；取消结算可由管理员在引擎参考价上调整，差额必须留原因。
      </p>

      <ConfirmationPreflightNotice order={order} />
      <AdminDecisionActions
        openMode={openMode}
        order={order}
        pending={pending}
        run={run}
        runOneBatch={runOneBatch}
      />

      {mode ? (
        <div className="mt-3 space-y-2 border-t pt-3">
          {mode === 'reject' || mode === 'hold' ? (
            <>
              <label className="block text-xs font-medium" htmlFor="decision-reason">
                原因
              </label>
              <select
                id="decision-reason"
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(mode === 'reject' ? REJECT_REASONS : HOLD_REASONS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
              <Input value={figs} onChange={(event) => setFigs(event.target.value)} placeholder="涉及款号，如 1,3（可选）" />
            </>
          ) : null}
          {mode === 'change-approve' && order.pendingChangeRequest?.type === 'CANCEL' ? (
            <div className="space-y-2 rounded-lg border bg-background p-2.5">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={order.totalQuantity}
                  step={1}
                  value={producedQty}
                  onChange={(event) => {
                    setProducedQty(event.target.value);
                    setSettlementPreview(null);
                    setSettleFee('');
                  }}
                  placeholder={`已产数量（0–${order.totalQuantity}）`}
                  aria-label="已产数量"
                />
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={previewCancellation}>
                  计算参考价
                </Button>
              </div>
              {settlementPreview ? (
                <div className="rounded-md bg-muted/50 p-2 text-xs">
                  <p className="font-semibold">
                    引擎参考价 ¥{formatMoney(settlementPreview.referenceSettleFee)}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    款级 ¥{formatMoney(settlementPreview.components.itemProcessing)} ·
                    入袋 ¥{formatMoney(settlementPreview.components.bagging)} ·
                    纸箱 ¥{formatMoney(settlementPreview.components.carton)} ·
                    运费 ¥0.00
                  </p>
                </div>
              ) : null}
              <Input
                value={settleFee}
                onChange={(event) => setSettleFee(event.target.value)}
                placeholder="最终结算金额（默认参考价）"
                inputMode="decimal"
                aria-label="最终结算金额"
              />
              <Input
                value={settleFeeAdjustmentReason}
                onChange={(event) => setSettleFeeAdjustmentReason(event.target.value)}
                placeholder="最终金额与参考价不同时必填调整原因"
                aria-label="结算调整原因"
              />
            </div>
          ) : null}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder={
              mode === 'change-deny' || mode === 'reject' || mode === 'hold'
                ? '必填理由'
                : mode === 'resume'
                  ? '必填已排除问题的证据'
                  : '审核备注（可选）'
            }
            aria-label="裁决说明"
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={submitDecision}>
              {pending ? '提交中…' : '确认提交'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(null)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className={message ? 'mt-3 text-xs font-medium' : 'sr-only'}>
        {pending ? '正在按服务端最新事实处理…' : message}
      </p>
    </section>
  );
}

function operationKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function parseFigs(value: string): number[] {
  return [...new Set(value.split(/[,\s，]+/u).map((item) => Number.parseInt(item, 10)).filter((item) => Number.isSafeInteger(item) && item > 0))];
}

function formatMoney(value: string): string {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
