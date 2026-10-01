'use client';

import type * as React from 'react';

import { useCallback, useRef, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
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
import type { CancellationSettlementPreview } from '@/lib/order/change-request';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import {
  ActionNotice,
  ConfirmActionController,
  ConfirmActionDialog,
  DisabledReason,
} from '@/components/ui-business';
import { OrderChangeReviewForm } from './OrderChangeReviewForm';
import { cancellationReviewIssue } from './admin-order-cancellation-review';
import { AdminOrderInlineOperations } from './AdminOrderInlineOperations';

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
type DecisionReceipt = { text: string; tone: 'success' | 'warning' };

function DecisionConfirmation({
  label, title, impactItems, changes = [], confirmLabel, disabled,
  onConfirm, describedBy, variant = 'default', cancelLabel,
}: {
  label: string;
  title: string;
  impactItems: string[];
  changes?: {label: string; old: string; new: string}[];
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  describedBy?: string;
  variant?: 'default' | 'destructive' | 'outline';
  /** 确认层关闭按钮的具体文案；「取消X」类裁决不得叫「取消」（§8.2）。 */
  cancelLabel?: string;
}) {
  // 危险裁决的红色必须同时落在确认层（danger 决定确认按钮配色），不只触发按钮。
  return <ConfirmActionController level="L2"
    disabled={disabled}
    cancelLabel={cancelLabel}
    trigger={<Button type="button" size="sm" variant={variant} aria-describedby={describedBy}>{label}</Button>}
    onConfirm={onConfirm}>
    <ConfirmActionDialog action={title} changes={changes} consequences={impactItems} confirmText={confirmLabel} danger={variant === 'destructive'} />
  </ConfirmActionController>;
}

/** 裁决确认层的关闭按钮文案：写清「不做」后工单怎样，避免与「取消工单」混淆。 */
const DECISION_CANCEL_LABELS: Partial<Record<NonNullable<FormMode>, string>> = {
  reject: '暂不驳回',
  'change-approve': '保留工单',
  'change-deny': '暂不拒绝',
};

function ConfirmationPreflightNotice({ order }: { order: AdminOrderWorkspaceRow }) {
  if (order.status !== 'PENDING_FACTORY' && order.status !== 'SUBMITTED') {
    return null;
  }
  const issues = order.confirmationPreflight.issues;
  const ok = issues.length === 0 && order.capabilities.release;
  return (
    <div
      id="admin-order-confirmation-preflight"
      className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${
        ok
          ? 'border-success/40 bg-success/10 text-success-foreground'
          : 'border-warning/40 bg-warning/10 text-warning-foreground'
      }`}
    >
      {ok ? (
        <p className="font-medium">可下发生产</p>
      ) : (
        <>
          <p className="font-medium">待处理事项</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MissingConfirmedFeeNotice({
  orderId,
  visible,
}: {
  orderId: string;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <p className="font-medium">暂不能结算：工单缺少确认金额。</p>
      <Link
        href={`/orders/${orderId}#pricing-review`}
        prefetch={false}
        className="mt-2 inline-flex font-medium underline underline-offset-2"
      >
        前往工单核对物流费用与确认依据
      </Link>
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
  runOneBatch: (command: 'CREATE_PRINT') => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {order.capabilities.reject ? (
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => openMode('reject')}>
          驳回
        </Button>
      ) : null}
      {order.capabilities.hold ? (
        <Button type="button" size="sm" variant="ghost" className="order-last" disabled={pending} onClick={() => openMode('hold')}>
          暂停
        </Button>
      ) : null}
      {order.capabilities.resume ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => openMode('resume')}>
          恢复生产
        </Button>
      ) : null}
      {order.capabilities.release ? (
        <DecisionConfirmation
          label="下发生产"
          title="下发生产"
          changes={[{label: order.customName ?? "未命名工单", old: "待下发", new: `${order.totalQuantity.toLocaleString("zh-CN")} 个待生产`}]}
          impactItems={[
            '下发后车间可开始生产。',
          ]}
          confirmLabel="确认下发生产"
          disabled={pending}
          onConfirm={() =>
            run(() =>
              releaseFactoryOrderAction({
                orderId: order.id,
                expectedRevision: order.revision,
                expectedWorkOrderVersion: order.workOrderVersion,
                printIdempotencyKey: operationKey('drawer-release'),
                createPrint: false,
              }),
            )
          }
        />
      ) : null}
      {order.capabilities.createPrint ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => runOneBatch('CREATE_PRINT')}>
          加入待打印
        </Button>
      ) : null}
      {order.capabilities.markPrinted ? (
        // 业主 2026-10-02：点「打印」即记已打印——打印页关闭打印对话框后自动记录，不再单独确认。
        <a
          href={`/print/orders/${encodeURIComponent(order.id)}?autoprint=1`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: 'sm', variant: order.capabilities.release ? 'outline' : 'default' })}
        >
          打印
        </a>
      ) : null}
      {order.capabilities.settle ? (
        <DecisionConfirmation
          label="结算"
          title="结算工单"
          changes={[{label: order.customName ?? "未命名工单", old: "未结算", new: order.feeStages.confirmed === null ? "待核价" : formatMoney(order.feeStages.confirmed)}]}
          impactItems={[
            '结算后不可编辑，账单将采用本次结算金额。',
          ]}
          confirmLabel="结算"
          disabled={pending}
          onConfirm={() =>
            run(() =>
              settleFactoryOrderAction({
                orderId: order.id,
                expectedRevision: order.revision,
                expectedWorkOrderVersion: order.workOrderVersion,
              }),
            )
          }
        />
      ) : null}
      {order.capabilities.reviewChange &&
      order.pendingChangeRequest?.type === 'CANCEL' ? (
        <>
          {order.pendingChangeRequest.approvalBlockedReason ? null : (
            <Button type="button" size="sm" disabled={pending} onClick={() => openMode('change-approve')}>
              批准取消
            </Button>
          )}
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => openMode('change-deny')}>
            拒绝申请
          </Button>
        </>
      ) : null}
    </div>
  );
}

function AdminDecisionForm({
  mode,
  order,
  pending,
  reasonCode,
  figs,
  producedQty,
  settlementPreview,
  settlementPreviewQuantity,
  settleFee,
  settleFeeAdjustmentReason,
  note,
  setReasonCode,
  setFigs,
  setProducedQty,
  clearSettlementPreview,
  setSettleFee,
  setSettleFeeAdjustmentReason,
  setNote,
  previewCancellation,
  submitDecision,
  close,
}: {
  mode: Exclude<FormMode, null>;
  order: AdminOrderWorkspaceRow;
  pending: boolean;
  reasonCode: ReasonCode;
  figs: string;
  producedQty: string;
  settlementPreview: CancellationSettlementPreview | null;
  settlementPreviewQuantity: number | null;
  settleFee: string;
  settleFeeAdjustmentReason: string;
  note: string;
  setReasonCode: (value: ReasonCode) => void;
  setFigs: (value: string) => void;
  setProducedQty: (value: string) => void;
  clearSettlementPreview: () => void;
  setSettleFee: (value: string) => void;
  setSettleFeeAdjustmentReason: (value: string) => void;
  setNote: (value: string) => void;
  previewCancellation: () => void;
  submitDecision: () => void;
  close: () => void;
}) {
  const requiresNote =
    mode === 'change-deny' ||
    mode === 'reject' ||
    mode === 'hold' ||
    mode === 'resume';
  const cancellationIssue = mode === 'change-approve' ? cancellationReviewIssue({
    producedQuantity: parseStrictNonNegativeInteger(producedQty),
    totalQuantity: order.totalQuantity,
    preview: settlementPreview,
    previewQuantity: settlementPreviewQuantity,
    finalFee: settleFee,
    adjustmentReason: settleFeeAdjustmentReason,
  }) : null;
  const formIssue = cancellationIssue ||
    ((mode === 'reject' || mode === 'hold') && !parseStrictPositiveIntegerList(figs).ok
      ? '涉及款号只能填写正整数，并用逗号或空格分隔'
      : requiresNote && !note.trim()
        ? mode === 'resume' ? '请填写已排除问题的证据。' : '请填写本次处理的理由。'
        : null);
  const labels = {
    reject: '驳回工单', hold: '暂停工单', resume: '恢复生产',
    'change-approve': '取消并结算工单', 'change-deny': '拒绝取消申请',
  } as const;
  const actionLabel = labels[mode];
  const impactItems = [
    `工单 ${order.orderNo}，版本 v${order.workOrderVersion}。`,
    ...(mode === 'change-approve' ? [
      `核实已产数量 ${producedQty.trim()} 个，最终结算金额 ${formatSettleFeeInput(settleFee)}。`,
      ...(settleFeeAdjustmentReason.trim() ? [`金额调整原因：${settleFeeAdjustmentReason.trim()}。`] : []),
      '批准后工单转为已取消，未完成的生产任务停止，并保存本次结算金额；已产部分照常结算。',
    ] : mode === 'change-deny' ? [
      '拒绝当前取消申请，工单状态和已完成的生产记录保持不变。',
    ] : mode === 'reject' ? [
      `驳回原因：${REJECT_REASONS.find(([code]) => code === reasonCode)?.[1] ?? reasonCode}。`,
      '工单退回提交人处理，本次驳回理由和涉及款号会保留。',
    ] : mode === 'hold' ? [
      `暂停原因：${HOLD_REASONS.find(([code]) => code === reasonCode)?.[1] ?? reasonCode}。`,
      '工单进入已暂停状态，恢复生产前需核对问题排除证据。',
    ] : [
      '核对已排除问题的证据后，恢复这张工单的生产流程。',
    ]),
    ...((mode === 'reject' || mode === 'hold') && figs.trim() ? [`涉及款号：${figs.trim()}。`] : []),
    ...(note.trim() ? [`${mode === 'resume' ? '问题排除证据' : '处理说明'}：${note.trim()}。`] : []),
  ];

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      {mode === 'reject' || mode === 'hold' ? (
        <>
          <label className="block text-xs font-medium" htmlFor="decision-reason">
            原因
          </label>
          <NativeSelect
            id="decision-reason"
            value={reasonCode}
            disabled={pending}
            onChange={(event) => setReasonCode(event.target.value as ReasonCode)}
            className="w-full"
          >
            {(mode === 'reject' ? REJECT_REASONS : HOLD_REASONS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </NativeSelect>
          <Input
            value={figs}
            disabled={pending}
            onChange={(event) => setFigs(event.target.value)}
            placeholder="涉及款号，如 1,3（可选）"
          />
        </>
      ) : null}
      {mode === 'change-approve' &&
      order.pendingChangeRequest?.type === 'CANCEL' ? (
        <div className="space-y-2 rounded-lg border bg-background p-2.5">
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              max={order.totalQuantity}
              step={1}
              value={producedQty}
              disabled={pending}
              onChange={(event) => {
                setProducedQty(event.target.value);
                clearSettlementPreview();
              }}
              placeholder={`已产数量（0–${order.totalQuantity}）`}
              aria-label="已产数量"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={previewCancellation}
            >
              计算参考价
            </Button>
          </div>
          {settlementPreview ? (
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              <p className="font-semibold">
                引擎参考价 {formatMoney(settlementPreview.referenceSettleFee)}
              </p>
              <p className="mt-1 text-muted-foreground">
                款级 {formatMoney(settlementPreview.components.itemProcessing)} ·
                入袋 {formatMoney(settlementPreview.components.bagging)} ·
                纸箱 {formatMoney(settlementPreview.components.carton)} ·
                运费 {formatMoney(0)}
              </p>
            </div>
          ) : null}
          <label className="block space-y-1 text-xs font-medium">
            <span>最终结算金额（元）</span>
            <Input
              value={settleFee}
              disabled={pending || !settlementPreview}
              onChange={(event) => setSettleFee(event.target.value)}
              placeholder="核对并填写最终结算金额"
              inputMode="decimal"
              aria-label="最终结算金额"
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            <span>结算调整原因</span>
            <Input
              value={settleFeeAdjustmentReason}
              disabled={pending || !settlementPreview}
              onChange={(event) =>
                setSettleFeeAdjustmentReason(event.target.value)
              }
              placeholder="最终金额与参考价不同时必填调整原因"
              aria-label="结算调整原因"
              maxLength={500}
            />
          </label>
        </div>
      ) : null}
      <Textarea
        value={note}
        disabled={pending}
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
        required={requiresNote}
        className="w-full"
      />
      {formIssue ? <p id="admin-decision-form-help" role="status" className="text-xs text-muted-foreground">{formIssue}</p> : null}
      <div className="flex flex-wrap gap-2">
        <DecisionConfirmation
          label={pending ? '正在提交…' : `确认${actionLabel}`}
          title={`${actionLabel}？`}
          impactItems={impactItems}
          confirmLabel={`确认${actionLabel}`}
          disabled={pending || Boolean(formIssue)}
          describedBy={formIssue ? 'admin-decision-form-help' : undefined}
          variant={mode === 'reject' || mode === 'change-approve' || mode === 'change-deny' ? 'destructive' : 'default'}
          cancelLabel={DECISION_CANCEL_LABELS[mode]}
          onConfirm={submitDecision}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={close}
        >
          取消
        </Button>
      </div>
    </div>
  );
}

function submitAdminOrderDecision({
  mode, order, reasonCode, note, figs, producedQty,
  settleFee, settleFeeAdjustmentReason, settlementPreview, settlementPreviewQuantity, run, setMessage,
}: {
  mode: FormMode;
  order: AdminOrderWorkspaceRow;
  reasonCode: ReasonCode;
  note: string;
  figs: string;
  producedQty: string;
  settleFee: string;
  settleFeeAdjustmentReason: string;
  settlementPreview: CancellationSettlementPreview | null;
  settlementPreviewQuantity: number | null;
  run: (task: DecisionTask) => void;
  setMessage: (value: string) => void;
}) {
  if (mode === 'reject' || mode === 'hold') {
    const parsedFigs = parseStrictPositiveIntegerList(figs);
    if (!parsedFigs.ok) {
      setMessage('涉及款号只能填写正整数，并用逗号或空格分隔');
      return;
    }
    if (!note.trim()) {
      setMessage(mode === 'reject' ? '请填写驳回理由' : '请填写暂停理由');
      return;
    }
    const payload = {
      orderId: order.id,
      reasonCode,
      reasonNote: note.trim(),
      affectedFigs: parsedFigs.values,
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
    if (!note.trim()) {
      setMessage('请填写已排除问题的证据');
      return;
    }
    run(() =>
      resumeFactoryOrderAction({
        orderId: order.id,
        recoveryEvidence: { resolution: note.trim() },
        note: note.trim(),
        idempotencyKey: operationKey('drawer-resume'),
      }),
    );
    return;
  }
  const change = order.pendingChangeRequest;
  if (
    !change ||
    change.type !== 'CANCEL' ||
    (mode !== 'change-approve' && mode !== 'change-deny')
  ) {
    return;
  }
  if (mode === 'change-deny' && !note.trim()) {
    setMessage('请填写拒绝申请的原因');
    return;
  }
  if (mode === 'change-approve') {
    const parsedProduced = parseStrictNonNegativeInteger(producedQty);
    const issue = cancellationReviewIssue({
      producedQuantity: parsedProduced,
      totalQuantity: order.totalQuantity,
      preview: settlementPreview,
      previewQuantity: settlementPreviewQuantity,
      finalFee: settleFee,
      adjustmentReason: settleFeeAdjustmentReason,
    });
    if (issue || parsedProduced === null || !settlementPreview) {
      setMessage(issue ?? '请核对已产数量。');
      return;
    }
    run(() =>
      reviewOrderChangeRequestAction(null, {
        requestId: change.id,
        decision: 'APPROVE',
        reviewRemark: note.trim() || null,
        producedQty: parsedProduced,
        expectedPriceRevision: settlementPreview.priceRevision,
        expectedQuoteToken: settlementPreview.quoteToken,
        expectedProductionFactsToken: settlementPreview.productionFactsToken,
        settleFee: settleFee.trim(),
        ...(settleFeeAdjustmentReason.trim()
          ? {
            settleFeeAdjustmentReason:
              settleFeeAdjustmentReason.trim(),
          }
          : {}),
      }),
    );
    return;
  }
  run(() =>
    reviewOrderChangeRequestAction(null, {
      requestId: change.id,
      decision: 'DENY',
      reviewRemark: note.trim() || null,
    }),
  );
}

export function AdminOrderDecisionPanel({
  order,
  compact = false,
  hideHeading = false,
}: {
  order: AdminOrderWorkspaceRow;
  compact?: boolean;
  hideHeading?: boolean;
}) {
  return <AdminOrderDecisionSession key={order.id} order={order} compact={compact} hideHeading={hideHeading} />;
}

function AdminOrderDecisionSession({ order, compact, hideHeading }: {
  order: AdminOrderWorkspaceRow;
  compact: boolean;
  hideHeading: boolean;
}) {
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);
  const onCompleted = useCallback((text: string, tone: DecisionReceipt['tone'] = 'success') => {
    setReceipt({ text, tone });
  }, []);
  return <>
    <AdminOrderDecisionPanelContent
      key={`${order.revision}:${order.workOrderVersion}:${order.pendingChangeRequest?.id ?? ''}`}
      order={order}
      compact={compact}
      hideHeading={hideHeading}
      onCompleted={onCompleted}
      clearReceipt={() => setReceipt(null)}
    />
    {receipt ? <ActionNotice tone={receipt.tone} title={receipt.text} className="mb-6 text-sm" /> : null}
  </>;
}

function AdminOrderDecisionPanelContent({ order, compact, hideHeading, onCompleted, clearReceipt }: {
  order: AdminOrderWorkspaceRow;
  compact: boolean;
  hideHeading: boolean;
  onCompleted: (text: string, tone?: DecisionReceipt['tone']) => void;
  clearReceipt: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const [mode, setMode] = useState<FormMode>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode>('PAPER_OUT');
  const [note, setNote] = useState('');
  const [figs, setFigs] = useState('');
  const [producedQty, setProducedQty] = useState('');
  const producedQtyRef = useRef('');
  const [settleFee, setSettleFee] = useState('');
  const [settleFeeAdjustmentReason, setSettleFeeAdjustmentReason] =
    useState('');
  const [settlementPreview, setSettlementPreview] =
    useState<CancellationSettlementPreview | null>(null);
  const [settlementPreviewQuantity, setSettlementPreviewQuantity] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'error' | 'success' | 'warning' }>({ text: '', tone: 'error' });
  const message = feedback.text;
  function setMessage(text: string, tone: 'error' | 'success' | 'warning' = 'error') {
    setFeedback({ text, tone });
  }

  const awaitingConfirmation =
    order.status === 'PENDING_FACTORY' || order.status === 'SUBMITTED';
  const settlementBlockedByMissingFee =
    order.status === 'SHIPPED' && order.feeStages.confirmed === null;
  const hasAnyAction =
    Object.values(order.capabilities).some(Boolean) ||
    awaitingConfirmation ||
    settlementBlockedByMissingFee || Boolean(order.shipDisabledReason);
  if (!hasAnyAction) return null;

  function clearDecisionFields() {
    setReasonCode('PAPER_OUT');
    setNote('');
    setFigs('');
    setProducedQty('');
    producedQtyRef.current = '';
    setSettlementPreview(null);
    setSettlementPreviewQuantity(null);
    setSettleFee('');
    setSettleFeeAdjustmentReason('');
  }

  function closeMode() {
    clearDecisionFields();
    setMessage('');
    setMode(null);
  }

  function finish(result: AdminOrderWorkflowActionResult | ReviewResult) {
    if (result.status === 'success') {
      if ('requestStatus' in result && result.requestStatus === 'STALE') {
        clearDecisionFields();
        setMessage('');
        onCompleted(
          '申请未执行：工单版本已变化，该申请已标记为失效，请基于最新工单重新发起。',
          'warning',
        );
        setMode(null);
        return;
      }
      clearDecisionFields();
      setMessage('');
      onCompleted('操作已完成，工单已更新。');
      setMode(null);
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
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    clearReceipt();
    setMessage('');
    startTransition(async () => {
      try {
        finish(await task());
      } catch {
        setMessage('操作未完成，请刷新工单后重试。');
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  function openMode(nextMode: Exclude<FormMode, null>) {
    clearDecisionFields();
    clearReceipt();
    setMessage('');
    setMode(nextMode);
  }

  function runOneBatch(command: 'CREATE_PRINT') {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    clearReceipt();
    setMessage('');
    startTransition(async () => {
      try {
        const result = await runAdminOrderBatchAction({
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
        });
        if (result.status === 'partial_failure') {
          onCompleted(
            `${result.message}；成功 ${result.result.successCount} 张，结果未知 ${result.result.failedCount} 张`,
            'warning',
          );
          router.refresh();
          return;
        }
        if (result.status !== 'success') {
          finish(result);
          return;
        }
        const item = result.result.items[0];
        if (!item || item.status === 'skipped') {
          setMessage(item?.message ?? '该工单未执行');
          return;
        }
        onCompleted('已创建当前版本的打印任务。');
      } catch {
        setMessage('打印操作未完成，请刷新工单后重试。');
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  function previewCancellation() {
    if (inFlightRef.current) return;
    const change = order.pendingChangeRequest;
    const parsedProduced = parseStrictNonNegativeInteger(producedQty);
    if (
      !change ||
      change.type !== 'CANCEL' ||
      parsedProduced === null ||
      parsedProduced > order.totalQuantity
    ) {
      setMessage(`已产数量必须是 0–${order.totalQuantity} 之间的整数`);
      return;
    }
    inFlightRef.current = true;
    clearReceipt();
    setMessage('');
    setSettlementPreview(null);
    setSettlementPreviewQuantity(null);
    setSettleFee('');
    setSettleFeeAdjustmentReason('');
    startTransition(async () => {
      try {
        const result = await previewOrderCancellationSettlementAction(null, {
          requestId: change.id,
          producedQty: parsedProduced,
        });
        if (result.status === 'success') {
          if (parseStrictNonNegativeInteger(producedQtyRef.current) !== parsedProduced) return;
          setSettlementPreview(result.preview);
          setSettlementPreviewQuantity(parsedProduced);
          setSettleFee(result.preview.referenceSettleFee);
          setSettleFeeAdjustmentReason('');
          setMessage('参考价已更新，请核对最终结算金额。', 'success');
          return;
        }
        if (result.status === 'invalid') {
          setMessage(Object.values(result.fieldErrors).flat().join('；'));
          return;
        }
        setMessage(result.message);
      } catch {
        setMessage('参考结算价计算失败，请稍后重试。');
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  function submitDecision() {
    submitAdminOrderDecision({ mode, order, reasonCode, note, figs, producedQty,
      settleFee, settleFeeAdjustmentReason, settlementPreview, settlementPreviewQuantity, run, setMessage });
  }

  return (
    <DecisionPanelSection {...{
      compact, hideHeading, order, awaitingConfirmation, settlementBlockedByMissingFee,
      pending, onCompleted, openMode, run,
      runOneBatch, mode, reasonCode, figs,
      producedQty, settlementPreview, settlementPreviewQuantity, settleFee,
      settleFeeAdjustmentReason, note, setReasonCode, setFigs,
      producedQtyRef, setProducedQty, setSettlementPreview, setSettlementPreviewQuantity,
      setSettleFee, setSettleFeeAdjustmentReason, setNote, previewCancellation,
      submitDecision, closeMode, message, feedback,
    }} />
  );
}

type RenderDecisionPanelOptions = {
  compact: boolean;
  hideHeading: boolean;
  order: AdminOrderWorkspaceRow;
  awaitingConfirmation: boolean;
  settlementBlockedByMissingFee: boolean;
  pending: boolean;
  onCompleted: (text: string, tone?: DecisionReceipt['tone']) => void;
  openMode: (nextMode: Exclude<FormMode, null>) => void;
  run: (task: DecisionTask) => void;
  runOneBatch: (command: 'CREATE_PRINT') => void;
  mode: FormMode;
  reasonCode: ReasonCode;
  figs: string;
  producedQty: string;
  settlementPreview: CancellationSettlementPreview | null;
  settlementPreviewQuantity: number | null;
  settleFee: string;
  settleFeeAdjustmentReason: string;
  note: string;
  setReasonCode: React.Dispatch<React.SetStateAction<ReasonCode>>;
  setFigs: React.Dispatch<React.SetStateAction<string>>;
  producedQtyRef: React.RefObject<string>;
  setProducedQty: React.Dispatch<React.SetStateAction<string>>;
  setSettlementPreview: React.Dispatch<
    React.SetStateAction<CancellationSettlementPreview | null>
  >;
  setSettlementPreviewQuantity: React.Dispatch<React.SetStateAction<number | null>>;
  setSettleFee: React.Dispatch<React.SetStateAction<string>>;
  setSettleFeeAdjustmentReason: React.Dispatch<React.SetStateAction<string>>;
  setNote: React.Dispatch<React.SetStateAction<string>>;
  previewCancellation: () => void;
  submitDecision: () => void;
  closeMode: () => void;
  message: string;
  feedback: { text: string; tone: 'error' | 'success' | 'warning' };
};

function DecisionPanelSection({
  compact,
  hideHeading,
  order,
  awaitingConfirmation,
  settlementBlockedByMissingFee,
  pending,
  onCompleted,
  openMode,
  run,
  runOneBatch,
  mode,
  reasonCode,
  figs,
  producedQty,
  settlementPreview,
  settlementPreviewQuantity,
  settleFee,
  settleFeeAdjustmentReason,
  note,
  setReasonCode,
  setFigs,
  producedQtyRef,
  setProducedQty,
  setSettlementPreview,
  setSettlementPreviewQuantity,
  setSettleFee,
  setSettleFeeAdjustmentReason,
  setNote,
  previewCancellation,
  submitDecision,
  closeMode,
  message,
  feedback,
}: RenderDecisionPanelOptions) {
  return (
    <section
      data-slot="admin-order-decision-panel"
      data-compact={compact || undefined}
      aria-labelledby="admin-order-decision-title"
      className="mb-6 rounded-xl border border-foreground/15 bg-muted/20 p-3"
    >
      <h3 id="admin-order-decision-title" className={hideHeading ? 'sr-only' : 'text-sm font-semibold'}>
        {compact ? '待你处理' : '工厂裁决'}
      </h3>
      <div data-slot={compact ? 'admin-order-decision-card' : undefined}>
        {compact ? (
          <>
            <h4 data-slot="admin-order-decision-heading" className="text-sm font-semibold">
              {order.pendingChangeRequest
                ? order.pendingChangeRequest.type === 'MODIFY'
                  ? '变更申请'
                  : '取消申请'
                : awaitingConfirmation
                  ? '下发前检查'
                  : order.status === 'ON_HOLD'
                    ? '暂停处理'
                    : order.capabilities.release
                      ? '下发生产'
                      : order.capabilities.ship
                        ? '录运单发货'
                        : order.capabilities.settle || settlementBlockedByMissingFee
                          ? '结算'
                          : '工单处理'}
            </h4>
            {order.pendingChangeRequest ? (
              <p className="mt-2 text-sm font-semibold">{order.pendingChangeRequest.reason}</p>
            ) : null}
          </>
        ) : null}
        {!compact ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {order.pendingChangeRequest?.type === 'MODIFY'
              ? '核对本次变更'
              : '取消结算可调整参考金额，差额必须填写原因。'}
          </p>
        ) : null}
        {!order.pendingChangeRequest && <ConfirmationPreflightNotice order={order} />}
        <MissingConfirmedFeeNotice orderId={order.id} visible={settlementBlockedByMissingFee} />
        {!order.pendingChangeRequest && (
          <AdminOrderInlineOperations order={order} disabled={pending} onCompleted={onCompleted} />
        )}
        {!order.capabilities.ship && order.shipDisabledReason ? (
          <DisabledReason
            cause="prerequisite"
            reason={`暂不能发货：${order.shipDisabledReason}`}
            fixHref={`/orders/${order.id}#ship-order`}
            fixLabel="查看发货前置条件"
            className="mt-3"
          />
        ) : null}
        {order.capabilities.reviewChange && order.pendingChangeRequest?.approvalBlockedReason ? (
          <p data-slot="change-approval-blocked" role="note" className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            {order.pendingChangeRequest.approvalBlockedReason}
          </p>
        ) : null}
        {order.capabilities.reviewChange && order.pendingChangeRequest?.type === 'MODIFY' ? (
          <div className="mt-3">
            <OrderChangeReviewForm
              key={order.pendingChangeRequest.id}
              requestId={order.pendingChangeRequest.id}
              compact={compact}
              currentItems={order.items.map((item) => ({
                id: item.id,
                sequence: item.sequence,
                name: item.name,
                quantity: item.quantity,
              }))}
            />
          </div>
        ) : null}
        {!(compact && order.pendingChangeRequest?.type === 'MODIFY') && (
          <AdminDecisionActions
            openMode={openMode}
            order={order}
            pending={pending}
            run={run}
            runOneBatch={runOneBatch}
          />
        )}
        {compact &&
        order.pendingChangeRequest?.type === 'MODIFY' &&
        (order.capabilities.hold || order.capabilities.resume) ? (
          <Button
            className="mt-3"
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => openMode(order.capabilities.hold ? 'hold' : 'resume')}
          >
            {order.capabilities.hold ? '暂停生产' : '恢复生产'}
          </Button>
        ) : null}

        {mode ? (
          <AdminDecisionForm
            mode={mode}
            order={order}
            pending={pending}
            reasonCode={reasonCode}
            figs={figs}
            producedQty={producedQty}
            settlementPreview={settlementPreview}
            settlementPreviewQuantity={settlementPreviewQuantity}
            settleFee={settleFee}
            settleFeeAdjustmentReason={settleFeeAdjustmentReason}
            note={note}
            setReasonCode={setReasonCode}
            setFigs={setFigs}
            setProducedQty={(value) => {
              producedQtyRef.current = value;
              setProducedQty(value);
            }}
            clearSettlementPreview={() => {
              setSettlementPreview(null);
              setSettlementPreviewQuantity(null);
              setSettleFee('');
              setSettleFeeAdjustmentReason('');
            }}
            setSettleFee={setSettleFee}
            setSettleFeeAdjustmentReason={setSettleFeeAdjustmentReason}
            setNote={setNote}
            previewCancellation={previewCancellation}
            submitDecision={submitDecision}
            close={closeMode}
          />
        ) : null}

        {pending || message ? (
          <p
            role={!pending && message && feedback.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={
              pending || message
                ? `mt-3 text-xs font-medium ${pending ? 'text-muted-foreground' : feedback.tone === 'success' ? 'text-success-foreground' : feedback.tone === 'warning' ? 'text-warning-foreground' : 'text-destructive'}`
                : 'sr-only'
            }
          >
            {pending ? '正在处理，请稍候…' : message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function operationKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

export function parseStrictNonNegativeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseStrictPositiveIntegerList(
  value: string,
): { ok: true; values: number[] } | { ok: false } {
  const normalized = value.trim();
  if (!normalized) return { ok: true, values: [] };
  const values: number[] = [];
  for (const token of normalized.split(/[,\s，]+/u)) {
    const parsed = parseStrictNonNegativeInteger(token);
    if (parsed === null || parsed <= 0) return { ok: false };
    values.push(parsed);
  }
  return { ok: true, values: [...new Set(values)] };
}

// 确认层回显用户手填的结算金额：能解析就走统一 formatter，
// 解析不了原样回显（服务端校验会再拦）。
function formatSettleFeeInput(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new Decimal(trimmed);
    return parsed.isFinite() ? formatMoney(parsed) : trimmed;
  } catch {
    return trimmed;
  }
}
