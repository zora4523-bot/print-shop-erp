'use client';

import { foilColorLabel } from '@/lib/order/foil-colors';

import type * as React from 'react';

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
} from 'react';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import type { FormEvent } from 'react';
import {
  previewOrderChangeRequestPricingAction,
  reviewOrderChangeRequestAction,
} from '@/actions/order';
import type {
  PreviewOrderChangeRequestPricingResult,
  ReviewOrderChangeRequestMutationResult,
} from '@/actions/order.types';
import type {
  OrderChangePendingChargePreview,
  OrderChangePricingPreview,
} from '@/lib/order/change-request';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type Props = {
  requestId: string;
  currentItems?: CurrentOrderItem[];
  compact?: boolean;
};

type CurrentOrderItem = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
};

export type OrderChangePendingCharge = OrderChangePendingChargePreview;

type OrderChangePricingPreviewWithCharges = OrderChangePricingPreview;

export type OrderChangePendingChargeResolution = {
  businessKey: string;
  shipmentId: string;
  expectedSequence: number;
  expectedProjectedQuantity: number;
  expectedDestinationProvince: string | null;
  amount: string;
  reason: string;
};

export type OrderChangePendingChargeDrafts = Record<
  string,
  { amount: string; reason: string }
>;

const MONEY_INPUT_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/u;

function pendingChargeResolutionFingerprint(
  resolutions: readonly OrderChangePendingChargeResolution[],
): string {
  return JSON.stringify(resolutions);
}

export function buildOrderChangePendingChargeResolutions(
  charges: readonly OrderChangePendingCharge[],
  drafts: OrderChangePendingChargeDrafts,
): {
  resolutions: OrderChangePendingChargeResolution[];
  missing: string[];
} {
  const resolutions: OrderChangePendingChargeResolution[] = [];
  const missing: string[] = [];

  for (const charge of charges) {
    const draft = drafts[charge.businessKey];
    const amount = draft?.amount.trim() ?? '';
    const reason = draft?.reason.trim() ?? '';
    const label = `第 ${charge.shipmentSequence} 票运费`;
    if (!MONEY_INPUT_PATTERN.test(amount)) {
      missing.push(`${label}金额`);
    }
    if (!reason) {
      missing.push(`${label}依据`);
    }
    if (!MONEY_INPUT_PATTERN.test(amount) || !reason) continue;
    resolutions.push({
      businessKey: charge.businessKey,
      shipmentId: charge.shipmentId,
      expectedSequence: charge.shipmentSequence,
      expectedProjectedQuantity: charge.projectedQuantity,
      expectedDestinationProvince: charge.destinationProvince,
      amount,
      reason,
    });
  }

  return { resolutions, missing };
}


function hasSameTextSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left.map((value) => value.trim()).filter(Boolean));
  const rightSet = new Set(right.map((value) => value.trim()).filter(Boolean));
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function foilColorText(colors: readonly string[]): string {
  return colors.length > 0 ? colors.map(foilColorLabel).join('、') : '无';
}

function orderChangePreviewFactDescriptions(
  item: OrderChangePricingPreviewWithCharges['items'][number],
): string[] {
  if (item.operation === 'ADD') {
    return [
      `规格 ${item.specification ?? '未填写'}`,
      `正面烫金 ${foilColorText(item.frontFoilColors ?? [])}`,
      `反面烫金 ${foilColorText(item.backFoilColors ?? [])}`,
    ];
  }

  const facts: string[] = [];
  if (item.previousSpecification !== item.specification) {
    facts.push(
      `规格 ${item.previousSpecification ?? '未填写'} → ${item.specification ?? '未填写'}`,
    );
  }
  const previousFront = item.previousFrontFoilColors ?? [];
  const nextFront = item.frontFoilColors ?? [];
  if (!hasSameTextSet(previousFront, nextFront)) {
    facts.push(
      `正面烫金 ${foilColorText(previousFront)} → ${foilColorText(nextFront)}`,
    );
  }
  const previousBack = item.previousBackFoilColors ?? [];
  const nextBack = item.backFoilColors ?? [];
  if (!hasSameTextSet(previousBack, nextBack)) {
    facts.push(
      `反面烫金 ${foilColorText(previousBack)} → ${foilColorText(nextBack)}`,
    );
  }
  return facts;
}

export function orderChangeApprovalConfirmation(
  preview: OrderChangePricingPreviewWithCharges,
): {
  changes: { label: string; old: string; new: string }[];
  consequences: string[];
} {
  const changes: { label: string; old: string; new: string }[] = [];
  for (const item of preview.items) {
    const label = externalPriceBusinessText(item.name);
    if (item.previousQuantity !== item.quantity) {
      changes.push({ label: `${label} · 数量`, old: item.previousQuantity === null ? '新增' : `${item.previousQuantity.toLocaleString('zh-CN')} 个`, new: `${item.quantity.toLocaleString('zh-CN')} 个` });
    }
    if (item.previousName && item.previousName !== item.name) {
      changes.push({ label: '款式名称', old: externalPriceBusinessText(item.previousName), new: label });
    }
    if (item.previousSpecification !== item.specification) {
      changes.push({ label: `${label} · 规格`, old: item.previousSpecification ?? '待录', new: item.specification ?? '待录' });
    }
    for (const [side, before, after] of [
      ['正面烫金', item.previousFrontFoilColors, item.frontFoilColors],
      ['反面烫金', item.previousBackFoilColors, item.backFoilColors],
    ] as const) {
      if (item.operation === 'ADD' || !hasSameTextSet(before ?? [], after ?? [])) {
        changes.push({ label: `${label} · ${side}`, old: item.operation === 'ADD' ? '新增' : foilColorText(before ?? []), new: foilColorText(after ?? []) });
      }
    }
    if (item.oldSubtotal !== item.newSubtotal) {
      changes.push({ label: `${label} · 加工费`, old: item.oldSubtotal === null ? '新增' : formatMoney(item.oldSubtotal), new: item.newSubtotal === null ? '待核价' : formatMoney(item.newSubtotal) });
    }
  }
  if (preview.promisedDateChange) {
    changes.push({ label: '承诺交期', old: preview.promisedDateChange.before ?? '待定', new: preview.promisedDateChange.after ?? '待定' });
  }
  const consequences: string[] = [];
  if (preview.totalExcludesPendingPlateFee) {
    consequences.push(`修改后已知费用 ${preview.newTotal === null ? '待核价' : formatMoney(preview.newTotal)}（不含版费）；版费核定后计入工单应收，整单差额待定。`);
  } else if (preview.items.length > 0) {
    changes.push({ label: `工单金额${preview.delta === null ? '' : `（差额 ${formatMoneyDelta(preview.delta)}）`}`, old: formatMoney(preview.oldTotal), new: preview.newTotal === null ? '待核价' : formatMoney(preview.newTotal) });
  }
  if (preview.items.length > 0) consequences.push('待开工任务将采用本次款式和数量。');
  return { changes, consequences };
}

export function orderChangeRejectionImpactItems(): string[] {
  return [
    '该修改申请会标记为已拒绝，并保存必填的拒绝原因。',
    '现有工单的款式、数量、计价与生产任务保持不变。',
    '已拒绝的申请不能再次审批；如仍需修改，需要重新发起申请。',
  ];
}

export function orderChangeReviewResultMessage(requestStatus: string): string {
  if (requestStatus === 'STALE') {
    return '申请未执行：工单版本已变化，该申请已标记为失效，请基于最新工单重新发起。';
  }
  if (requestStatus === 'DENIED' || requestStatus === 'REJECTED') {
    return '申请已拒绝，工单内容未发生变化。';
  }
  if (requestStatus === 'CANCELLED') {
    return '取消申请已批准，工单已取消。';
  }
  return '修改申请已批准。';
}

export async function reviewOrderChangeRequestWithRecovery(
  previousState: ReviewOrderChangeRequestMutationResult | null,
  raw: unknown,
): Promise<ReviewOrderChangeRequestMutationResult> {
  try {
    return await reviewOrderChangeRequestAction(previousState, raw);
  } catch {
    return {
      status: 'error',
      message: '审核请求未完成，请刷新工单后重试。',
    };
  }
}

export async function previewOrderChangeRequestPricingWithRecovery(
  previousState: PreviewOrderChangeRequestPricingResult | null,
  raw: unknown,
): Promise<PreviewOrderChangeRequestPricingResult> {
  try {
    return await previewOrderChangeRequestPricingAction(previousState, raw);
  } catch {
    return {
      status: 'error',
      message: '计价预览请求未完成，请重试。',
    };
  }
}

export function OrderChangePricingPreviewPanel({
  preview,
  currentItems = [],
}: {
  preview: OrderChangePricingPreviewWithCharges;
  currentItems?: CurrentOrderItem[];
}) {
  const pendingCharges = preview.pendingCharges ?? [];
  const unresolvedPendingChargeCount = pendingCharges.filter(
    (charge) => charge.amount === null,
  ).length;

  return (
    <section
      aria-label="审批计价预览"
      data-slot="order-change-pricing-preview"
      className="space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">变更费用</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          核对数量与金额
        </p>
      </div>

      {preview.promisedDateChange ? (
        <p className="text-sm">承诺交期：{preview.promisedDateChange.before ?? '未设置'} → {preview.promisedDateChange.after ?? '未设置'}</p>
      ) : null}
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">当前工单总额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {formatMoney(preview.oldTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">
            {preview.totalExcludesPendingPlateFee
              ? '新总额（暂不含版费）'
              : '新总额'}
          </dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.newTotal === null ? '待补全价格规则' : formatMoney(preview.newTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">整单差额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.totalExcludesPendingPlateFee
              ? '版费核定后可计算'
              : preview.delta === null
                ? '暂无法计算'
                : formatMoneyDelta(preview.delta)}
          </dd>
        </div>
      </dl>

      {preview.requiresReviewRemark ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          费用尚未核齐，请补录待核价项或修正计价规则。
        </p>
      ) : null}

      {preview.totalExcludesPendingPlateFee ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
          版费待核价
        </p>
      ) : null}

      {pendingCharges.length > 0 ? (
        <p
          className={`rounded-md border p-2 text-xs ${
            unresolvedPendingChargeCount > 0
              ? 'border-warning/40 bg-warning/10 text-warning-foreground'
              : 'border-success/40 bg-success/10 text-success-foreground'
          }`}
        >
          {unresolvedPendingChargeCount > 0
            ? `${unresolvedPendingChargeCount} 票运费待核价，请补录金额后刷新预览。`
            : `${pendingCharges.length} 票运费已核价。`}
        </p>
      ) : null}

      <h4 className="text-xs font-semibold">拟变更款式与计价差异</h4>

      <ul className="space-y-2">
        {preview.items.map((item) => {
          const currentItem =
            item.operation === 'UPDATE'
              ? currentItems.find((candidate) => candidate.id === item.sourceItemId)
              : undefined;
          const nameChanged = Boolean(
            item.previousName && item.previousName !== item.name,
          );
          const quantityChanged = Boolean(
            item.previousQuantity !== null &&
              item.previousQuantity !== item.quantity,
          );
          const specificationChanged = Boolean(
            item.operation === 'UPDATE' &&
              item.previousSpecification !== item.specification,
          );
          const frontFoilChanged = Boolean(
            item.operation === 'UPDATE' &&
              !hasSameTextSet(
                item.previousFrontFoilColors ?? [],
                item.frontFoilColors ?? [],
              ),
          );
          const backFoilChanged = Boolean(
            item.operation === 'UPDATE' &&
              !hasSameTextSet(
                item.previousBackFoilColors ?? [],
                item.backFoilColors ?? [],
              ),
          );
          const addedItemFacts =
            item.operation === 'ADD'
              ? orderChangePreviewFactDescriptions(item)
              : [];
          const hasDetailedFacts =
            nameChanged ||
            quantityChanged ||
            specificationChanged ||
            frontFoilChanged ||
            backFoilChanged ||
            addedItemFacts.length > 0;
          return (
            <li
              key={`${item.changeIndex}-${item.sourceItemId}`}
              className="min-w-0 rounded-md border bg-background p-2 text-xs"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="admin-wrap-anywhere min-w-0 font-medium">
                  {item.operation === 'ADD' ? '添加款式' : '修改款式'}
                  {currentItem ? ` #${currentItem.sequence}` : ''} ·{' '}
                  {externalPriceBusinessText(item.name)}
                </p>
                <span
                  className={
                    item.priceImpact === 'INCOMPLETE'
                      ? 'font-medium text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {item.priceImpact === 'UNCHANGED'
                    ? '不影响计价'
                    : item.priceImpact === 'QUOTED'
                      ? '已自动计价'
                      : '自动计价未完成'}
                </span>
              </div>
              {hasDetailedFacts ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {nameChanged ? (
                    <li>
                      名称{' '}
                      {externalPriceBusinessText(item.previousName as string)} →{' '}
                      {externalPriceBusinessText(item.name)}
                    </li>
                  ) : null}
                  {quantityChanged ? (
                    <li>
                      数量 {item.previousQuantity?.toLocaleString('zh-CN')} →{' '}
                      {item.quantity.toLocaleString('zh-CN')}
                    </li>
                  ) : null}
                  {specificationChanged ? (
                    <li>
                      规格 {item.previousSpecification ?? '未填写'} →{' '}
                      {item.specification ?? '未填写'}
                    </li>
                  ) : null}
                  {frontFoilChanged ? (
                    <li>
                      正面烫金{' '}
                      {foilColorText(item.previousFrontFoilColors ?? [])} →{' '}
                      {foilColorText(item.frontFoilColors ?? [])}
                    </li>
                  ) : null}
                  {backFoilChanged ? (
                    <li>
                      反面烫金{' '}
                      {foilColorText(item.previousBackFoilColors ?? [])} →{' '}
                      {foilColorText(item.backFoilColors ?? [])}
                    </li>
                  ) : null}
                  {item.operation === 'ADD' ? (
                    <>
                      <li>数量 {item.quantity.toLocaleString('zh-CN')}</li>
                      {addedItemFacts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  本项没有数量、目录规格或正反面烫金颜色变化。
                </p>
              )}
              <p className="mt-1 text-muted-foreground">
                款式小计：
                {item.oldSubtotal === null ? '新增' : formatMoney(item.oldSubtotal)} →{' '}
                {item.newSubtotal === null ? '待补全规则' : formatMoney(item.newSubtotal)}
              </p>
              {item.priceImpact === 'QUOTED' ? (
                <p className="mt-1 text-muted-foreground">
                  自动单价 {formatUnitPrice(item.suggestedUnitPrice as string)} ·
                  每款一次性费用{' '}
                  {formatMoney(item.suggestedFixedFee as string)}
                </p>
              ) : null}
              {item.errors.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OrderChangeCompactPreview({ preview, currentItems }: {
  preview: OrderChangePricingPreviewWithCharges;
  currentItems: CurrentOrderItem[];
}) {
  return (
    <section aria-label="审批计价预览" className="space-y-3">
      <ul data-slot="order-change-summary" className="space-y-2 text-sm">
        {preview.items.map((item) => (
          <li key={`${item.changeIndex}-${item.sourceItemId}`} className="rounded-lg border p-3">
            <p className="admin-wrap-anywhere font-medium">{item.operation === 'ADD' ? '添加款式' : '修改款式'} · {externalPriceBusinessText(item.name)}</p>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              <li>数量 {item.operation === 'ADD' ? '' : `${(item.previousQuantity ?? currentItems.find((current) => current.id === item.sourceItemId)?.quantity ?? 0).toLocaleString('zh-CN')} → `}{item.quantity.toLocaleString('zh-CN')} 个</li>
              {item.previousName && item.previousName !== item.name && <li>名称 {externalPriceBusinessText(item.previousName)} → {externalPriceBusinessText(item.name)}</li>}
              {orderChangePreviewFactDescriptions(item).map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
            {item.errors.length > 0 && <p className="mt-2 text-xs text-warning-foreground">{item.errors.join('；')}</p>}
          </li>
        ))}
      </ul>
      <dl data-slot="order-change-amounts" className="space-y-2 text-sm">
        {preview.promisedDateChange ? <div className="flex justify-between gap-3"><dt>承诺交期</dt><dd>{preview.promisedDateChange.before ?? '未设置'} → {preview.promisedDateChange.after ?? '未设置'}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt>原金额</dt><dd className="font-semibold">{formatMoney(preview.oldTotal)}</dd></div>
        <div className="flex justify-between gap-3"><dt>{preview.totalExcludesPendingPlateFee ? '修改后已知费用（不含版费）' : '修改后金额'}</dt><dd className="font-semibold">{preview.newTotal === null ? '待核定' : formatMoney(preview.newTotal)}</dd></div>
        {!preview.totalExcludesPendingPlateFee && preview.delta !== null && <div className="flex justify-between gap-3"><dt>差额</dt><dd>{formatMoneyDelta(preview.delta)}</dd></div>}
      </dl>
      {preview.totalExcludesPendingPlateFee && <p className="text-xs text-warning-foreground">版费待核定，暂不计算整单差额；批准后仍需补核版费。</p>}
      {!preview.complete && <p role="status" className="text-xs text-warning-foreground">费用未完整确定，请补齐下方运费或处理计价问题后重新预览。</p>}
      <Disclosure className="rounded-lg border p-3">
        <DisclosureSummary>费用明细</DisclosureSummary>
        <div className="mt-3"><OrderChangePricingPreviewPanel preview={preview} currentItems={currentItems} /></div>
      </Disclosure>
    </section>
  );
}

export function OrderChangePendingChargeEditor({
  charges,
  drafts,
  disabled,
  onChange,
}: {
  charges: readonly OrderChangePendingCharge[];
  drafts: OrderChangePendingChargeDrafts;
  disabled: boolean;
  onChange: (
    businessKey: string,
    field: 'amount' | 'reason',
    value: string,
  ) => void;
}) {
  if (charges.length === 0) return null;

  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <legend className="px-1 text-sm font-semibold">逐票运费核对</legend>
      <p className="text-xs text-muted-foreground">
        金额不小于 0，必填核价依据。
      </p>
      {charges.map((charge) => {
        const draft = drafts[charge.businessKey] ?? {
          amount: charge.amount ?? '',
          reason: charge.reason ?? '',
        };
        const destination = charge.destinationProvince ?? '未填省份';
        return (
          <div
            key={charge.businessKey}
            className="space-y-2 rounded-md border bg-background p-3"
          >
            <div>
              <p className="text-sm font-medium">
                第 {charge.shipmentSequence} 票 · {destination} ·{' '}
                {charge.projectedQuantity.toLocaleString('zh-CN')} 个
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {charge.description}
              </p>
            </div>
            {charge.errors.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
                {charge.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            <div data-slot="order-change-charge-fields" className="grid gap-2 sm:grid-cols-[minmax(8rem,0.65fr)_minmax(12rem,1.35fr)]">
              <label className="space-y-1 text-xs">
                <span>运费金额（元）</span>
                <Input
                  aria-label={`第 ${charge.shipmentSequence} 票运费金额`}
                  inputMode="decimal"
                  maxLength={13}
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(event) =>
                    onChange(charge.businessKey, 'amount', event.target.value)
                  }
                />
              </label>
              <label className="space-y-1 text-xs">
                <span>运费核对依据</span>
                <Textarea
                  aria-label={`第 ${charge.shipmentSequence} 票运费依据`}
                  rows={2}
                  maxLength={500}
                  placeholder="例如：物流商报价单号或沟通记录"
                  value={draft.reason}
                  onChange={(event) =>
                    onChange(charge.businessKey, 'reason', event.target.value)
                  }
                />
              </label>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function OrderChangeReviewDecisionFields({
  requestId, compact, reviewRemark, setReviewRemark, error, state, approveDisabled,
  rejectDisabled, approvalDisabledReason, preview, submit,
}: {
  requestId: string;
  compact: boolean;
  reviewRemark: string;
  setReviewRemark: (value: string) => void;
  error: string | null | undefined;
  state: ReviewOrderChangeRequestMutationResult | null;
  approveDisabled: boolean;
  rejectDisabled: boolean;
  approvalDisabledReason: string | null;
  preview: OrderChangePricingPreviewWithCharges | null;
  submit: (decision: "APPROVE" | "DENY") => void;
}) {
  const approval = preview
    ? orderChangeApprovalConfirmation(preview)
    : { changes: [], consequences: [] };
  const rejectionImpactItems = orderChangeRejectionImpactItems();
  return (
    <>
      <Disclosure open={compact ? undefined : true} className="rounded-lg border p-3">
        <DisclosureSummary>填写拒绝原因 / 审核备注</DisclosureSummary>
      <label className="mt-2 block space-y-1 text-sm">
        <span>审核备注 / 拒绝原因</span>
        <Textarea
          aria-describedby={`change-review-remark-help-${requestId}`}
          value={reviewRemark}
          onChange={(event) => setReviewRemark(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
        <span
          id={`change-review-remark-help-${requestId}`}
          className="block text-xs text-muted-foreground"
        >
          拒绝时必填；批准备注可选。人工运费的金额与依据请在上方逐票填写。
        </span>
      </label>
      </Disclosure>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {state?.status === 'success' ? (
        <p
          role={state.requestStatus === 'STALE' ? 'alert' : 'status'}
          className={
            state.requestStatus === 'STALE'
              ? 'rounded-md border border-warning/40 bg-warning/10 p-2 text-sm font-medium'
              : 'rounded-md border border-success/40 bg-success/10 p-2 text-sm font-medium'
          }
        >
          {orderChangeReviewResultMessage(state.requestStatus)}
        </p>
      ) : null}
      {approvalDisabledReason ? (
        <p id={`change-approval-help-${requestId}`} role="status" className="text-xs text-muted-foreground">
          {approvalDisabledReason}
        </p>
      ) : null}
      <div data-slot={compact ? 'order-change-decision-actions' : undefined} className="flex flex-wrap gap-2">
        <ConfirmActionController level="L2"
          disabled={approveDisabled}
          trigger={
            <Button type="button" className="min-h-11" aria-describedby={approvalDisabledReason ? `change-approval-help-${requestId}` : undefined}>
              批准变更
            </Button>
          }
          onConfirm={() => submit('APPROVE')}>
          <ConfirmActionDialog action="批准变更" changes={approval.changes} consequences={approval.consequences} confirmText="批准" />
        </ConfirmActionController>
        <ConfirmActionController level="L2"
          disabled={rejectDisabled}
          cancelLabel="暂不拒绝"
          trigger={
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
            >
              拒绝申请
            </Button>
          }
          onConfirm={() => submit('DENY')}>
          <ConfirmActionDialog action="拒绝这项工单修改申请" changes={[]} consequences={rejectionImpactItems} confirmText="确认拒绝申请" danger />
        </ConfirmActionController>
      </div>
    </>
  );
}

function OrderChangePreviewFeedback({ previewPending, hasPreview, previewError, loadPreview }: {
  previewPending: boolean;
  hasPreview: boolean;
  previewError: string | null | undefined;
  loadPreview: () => void;
}) {
  return (
    <>
      {previewPending && !hasPreview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在核对修改后费用…
        </p>
      ) : null}
      {previewError ? (
        <div className="space-y-2 rounded-md border border-destructive/40 p-2">
          <p role="alert" className="text-sm text-destructive">
            计价预览失败：{previewError}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={previewPending}
            onClick={loadPreview}
          >
            重新加载最新计价预览
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function OrderChangeReviewForm({
  requestId,
  compact = false,
  currentItems = [],
}: Props) {
  const [state, action] = useActionState<
    ReviewOrderChangeRequestMutationResult | null,
    unknown
  >(reviewOrderChangeRequestWithRecovery, null);
  const [previewState, setPreviewState] =
    useState<PreviewOrderChangeRequestPricingResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewTransitionPending, startPreviewTransition] = useTransition();
  const [initialPreviewPending, setInitialPreviewPending] = useState(true);
  const [reviewRemark, setReviewRemark] = useState('');
  const [lastPreview, setLastPreview] =
    useState<OrderChangePricingPreviewWithCharges | null>(null);
  const [pendingChargeDrafts, setPendingChargeDrafts] =
    useState<OrderChangePendingChargeDrafts>({});
  const [verifiedResolutionFingerprint, setVerifiedResolutionFingerprint] =
    useState<string | null>(null);
  const [dismissedReviewErrorState, setDismissedReviewErrorState] =
    useState<ReviewOrderChangeRequestMutationResult | null>(null);
  const previewPending = initialPreviewPending || previewTransitionPending;

  function applyPreviewResult(
    result: PreviewOrderChangeRequestPricingResult,
    requestedFingerprint: string | null,
    dismissReviewErrorOnSuccess = false,
  ) {
    setPreviewState(result);
    if (result.status !== 'success') return;
    if (dismissReviewErrorOnSuccess) setDismissedReviewErrorState(state);
    const nextPreview = result.preview as OrderChangePricingPreviewWithCharges;
    setLastPreview(nextPreview);
    setPendingChargeDrafts((current) => {
      const next = { ...current };
      for (const charge of nextPreview.pendingCharges ?? []) {
        next[charge.businessKey] = current[charge.businessKey] ?? {
          amount: charge.amount ?? '',
          reason: charge.reason ?? '',
        };
      }
      return next;
    });
    setVerifiedResolutionFingerprint(requestedFingerprint);
  }

  function loadPreview() {
    setVerifiedResolutionFingerprint(null);
    startPreviewTransition(async () => {
      const result = await previewOrderChangeRequestPricingWithRecovery(null, {
        requestId,
      });
      applyPreviewResult(result, null, true);
    });
  }

  useEffect(() => {
    let cancelled = false;
    void previewOrderChangeRequestPricingWithRecovery(null, { requestId }).then(
      (result) => {
        if (cancelled) return;
        setPreviewState(result);
        if (result.status === 'success') {
          const nextPreview =
            result.preview as OrderChangePricingPreviewWithCharges;
          setLastPreview(nextPreview);
          setPendingChargeDrafts(() =>
            Object.fromEntries(
              (nextPreview.pendingCharges ?? []).map((charge) => [
                charge.businessKey,
                {
                  amount: charge.amount ?? '',
                  reason: charge.reason ?? '',
                },
              ]),
            ),
          );
          setVerifiedResolutionFingerprint(null);
        }
        setInitialPreviewPending(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  // Every success status (APPROVED / DENIED / CANCELLED and the STALE no-op)
  // returns after reviewOrderChangeRequestAction's revalidatePath, so the
  // action response already carries the fresh page (DECISIONS 2026-08-27).

  const pendingCharges = lastPreview?.pendingCharges ?? [];
  const pendingChargeBuild = buildOrderChangePendingChargeResolutions(
    pendingCharges,
    pendingChargeDrafts,
  );
  const resolutionFingerprint = pendingChargeResolutionFingerprint(
    pendingChargeBuild.resolutions,
  );
  const pendingChargesVerified =
    pendingCharges.length === 0 ||
    (pendingChargeBuild.missing.length === 0 &&
      verifiedResolutionFingerprint === resolutionFingerprint);

  function updatePendingChargeDraft(
    businessKey: string,
    field: 'amount' | 'reason',
    value: string,
  ) {
    setPendingChargeDrafts((current) => ({
      ...current,
      [businessKey]: {
        amount: current[businessKey]?.amount ?? '',
        reason: current[businessKey]?.reason ?? '',
        [field]: value,
      },
    }));
    setVerifiedResolutionFingerprint(null);
  }

  function repreviewWithPendingCharges() {
    if (
      !lastPreview ||
      !Number.isSafeInteger(lastPreview.priceRevision) ||
      pendingChargeBuild.missing.length > 0
    ) {
      return;
    }
    startPreviewTransition(async () => {
      const requestedFingerprint = resolutionFingerprint;
      const result = await previewOrderChangeRequestPricingWithRecovery(null, {
        requestId,
        expectedPriceRevision: lastPreview.priceRevision,
        pendingChargeResolutions: pendingChargeBuild.resolutions,
      });
      applyPreviewResult(result, requestedFingerprint, true);
    });
  }

  function submit(decision: 'APPROVE' | 'DENY') {
    if (decision === 'DENY') {
      startTransition(() =>
        action({
          requestId,
          decision,
          reviewRemark: reviewRemark.trim(),
        }),
      );
      return;
    }
    if (
      !lastPreview ||
      !Number.isSafeInteger(lastPreview.priceRevision) ||
      !lastPreview.complete ||
      !pendingChargesVerified
    ) {
      return;
    }
    startTransition(() =>
      action({
        requestId,
        decision,
        expectedPriceRevision: lastPreview.priceRevision,
        expectedQuoteToken: lastPreview.quoteToken ?? undefined,
        expectedProductionFactsToken: lastPreview.productionFactsToken,
        pendingChargeResolutions: pendingChargeBuild.resolutions,
        reviewRemark: reviewRemark.trim() || null,
      }),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const error = state === dismissedReviewErrorState
    ? null
    : state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : null;
  const previewError =
    previewState?.status === 'error'
      ? previewState.message
      : previewState?.status === 'invalid'
        ? Object.values(previewState.fieldErrors).flat()[0]
        : null;
  const preview = lastPreview;
  const reviewCompleted = state?.status === 'success';
  const approveDisabled =
    pending ||
    reviewCompleted ||
    previewPending ||
    preview === null ||
    previewError !== null ||
    !Number.isSafeInteger(preview.priceRevision) ||
    !preview.complete ||
    !pendingChargesVerified;
  const approvalDisabledReason = !approveDisabled ? null
    : pending ? '正在提交审批，请稍候。'
    : reviewCompleted ? '该申请已处理，不能重复审批。'
    : previewPending ? '正在生成计价预览，请稍候。'
    : previewError || !preview || !Number.isSafeInteger(preview.priceRevision)
      ? '计价预览不可用，请重新加载后再批准。'
    : !pendingChargesVerified ? '请补齐运费金额和依据，并按录入运费重新预览。'
    : '计价尚未完成，请处理费用缺项后重新预览。';
  const rejectDisabled =
    pending || reviewCompleted || reviewRemark.trim() === '';

  const pendingChargeFields = (
    <>
      <OrderChangePendingChargeEditor
        charges={pendingCharges}
        drafts={pendingChargeDrafts}
        disabled={pending || previewPending || reviewCompleted}
        onChange={updatePendingChargeDraft}
      />
      {pendingCharges.length > 0 ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled={
              pending ||
              previewPending ||
              reviewCompleted ||
              pendingChargeBuild.missing.length > 0
            }
            onClick={repreviewWithPendingCharges}
          >
            {previewPending ? '正在重新预览…' : '按录入运费重新预览'}
          </Button>
          {pendingChargeBuild.missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              请补齐：{pendingChargeBuild.missing.join('、')}。金额最多两位小数。
            </p>
          ) : pendingChargesVerified ? (
            <p role="status" className="text-xs text-success-foreground">
              运费已核对。
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              运费录入发生变化，须重新预览成功后才能批准。
            </p>
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending || previewPending}
      className="space-y-2"
    >
      {preview ? (
        <ModificationPreviewSection {...{
          compact, preview, currentItems, previewError,
          pending, previewPending, reviewCompleted, loadPreview,
        }} />
      ) : null}
      <OrderChangePreviewFeedback
        previewPending={previewPending}
        hasPreview={preview !== null}
        previewError={previewError}
        loadPreview={loadPreview}
      />
      {compact && pendingCharges.length > 0 ? (
        <PendingFreightDisclosureSection {...{
          pendingChargesVerified: pendingChargesVerified, pendingCharges: pendingCharges, pendingChargeFields: pendingChargeFields,
        }} />
      ) : pendingChargeFields}
      <OrderChangeReviewDecisionFields
        requestId={requestId}
        compact={compact}
        reviewRemark={reviewRemark}
        setReviewRemark={setReviewRemark}
        error={error}
        state={state}
        approveDisabled={approveDisabled}
        rejectDisabled={rejectDisabled}
        approvalDisabledReason={approvalDisabledReason}
        preview={preview}
        submit={submit}
      />
    </form>
  );
}

type RenderModificationPreviewOptions = {
  compact: boolean;
  preview: OrderChangePricingPreview;
  currentItems: CurrentOrderItem[];
  previewError: string | null;
  pending: boolean;
  previewPending: boolean;
  reviewCompleted: boolean;
  loadPreview: () => void;
};

function ModificationPreviewSection({
  compact,
  preview,
  currentItems,
  previewError,
  pending,
  previewPending,
  reviewCompleted,
  loadPreview,
}: RenderModificationPreviewOptions): React.ReactNode {
  return (
    <div className="space-y-2">
      {compact ? (
        <OrderChangeCompactPreview preview={preview} currentItems={currentItems} />
      ) : (
        <OrderChangePricingPreviewPanel preview={preview} currentItems={currentItems} />
      )}
      {!previewError ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending || previewPending || reviewCompleted}
          onClick={loadPreview}
        >
          {previewPending ? '正在刷新…' : '刷新最新计价预览'}
        </Button>
      ) : null}
    </div>
  );
}

function PendingFreightDisclosureSection({ pendingChargesVerified, pendingCharges, pendingChargeFields }: { pendingChargesVerified: boolean; pendingCharges: OrderChangePendingChargePreview[]; pendingChargeFields: React.ReactNode; }
) {
  return (
    <Disclosure open={!pendingChargesVerified} className="rounded-lg border p-3">
      <DisclosureSummary>补录运费 · {pendingCharges.length} 票</DisclosureSummary>
      <div className="mt-3 space-y-2">{pendingChargeFields}</div>
    </Disclosure>
  );
}
