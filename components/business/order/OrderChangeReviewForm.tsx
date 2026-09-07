'use client';

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
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
import { ConfirmActionDialog } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type Props = {
  requestId: string;
  currentItems?: CurrentOrderItem[];
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

function money(value: string): string {
  return `¥${value}`;
}

function deltaMoney(value: string): string {
  if (value.startsWith('-')) return `-¥${value.slice(1)}`;
  if (value === '0.00') return '¥0.00';
  return `+¥${value}`;
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
  return colors.length > 0 ? colors.join('、') : '无';
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

export function orderChangeApprovalImpactItems(
  preview: OrderChangePricingPreviewWithCharges,
): string[] {
  const addedCount = preview.items.filter(
    (item) => item.operation === 'ADD',
  ).length;
  const updatedCount = preview.items.length - addedCount;
  const changeSummary = [
    updatedCount > 0 ? `修改 ${updatedCount} 项` : null,
    addedCount > 0 ? `新增 ${addedCount} 项` : null,
  ]
    .filter((item): item is string => item !== null)
    .join('、');
  const pricingSummary = preview.totalExcludesPendingPlateFee
    ? preview.newTotal === null
      ? `已知费用预览不完整：当前工单总额 ${money(preview.oldTotal)}；修改后已知费用与整单差额暂无法计算。`
      : `已知费用预览：修改后当前可确定费用为 ${money(preview.newTotal)}（暂不含制烫金版费）。当前工单总额与该已知费用口径不同，不展示整单差额。`
    : preview.newTotal === null || preview.delta === null
      ? `计价预览不完整：当前总额 ${money(preview.oldTotal)}，新总额和差额暂无法计算。`
      : `计价预览：${money(preview.oldTotal)} → ${money(preview.newTotal)}（差额 ${deltaMoney(preview.delta)}）。`;
  const itemChanges = preview.items.map((item) => {
    const itemLabel =
      item.operation === 'ADD'
        ? `新增款式“${externalPriceBusinessText(item.name)}”`
        : `修改款式“${externalPriceBusinessText(item.previousName ?? item.name)}”${item.previousName && item.previousName !== item.name ? ` → “${externalPriceBusinessText(item.name)}”` : ''}`;
    const subtotal = `${item.oldSubtotal === null ? '新增' : money(item.oldSubtotal)} → ${item.newSubtotal === null ? '待补全规则' : money(item.newSubtotal)}`;
    const pricingImpact =
      item.priceImpact === 'UNCHANGED'
        ? '不影响计价'
        : item.priceImpact === 'QUOTED'
          ? '已按当前规则计价'
          : '当前无法计价';
    const errors =
      item.errors.length > 0
        ? `；计价提示：${item.errors.join('；')}`
        : '';
    const factDescriptions = orderChangePreviewFactDescriptions(item);
    const factSummary =
      factDescriptions.length > 0
        ? `；变更事实：${factDescriptions.join('；')}`
        : '';
    return `${itemLabel}：${item.quantity.toLocaleString('zh-CN')} 个${factSummary}；款式小计 ${subtotal}，${pricingImpact}${errors}。`;
  });

  const pendingChargeSummary = preview.pendingCharges?.length
    ? `逐票运费共 ${preview.pendingCharges.length} 项，将使用本次预览中已核对的人工运费金额与依据。`
    : null;
  const deferredPlateFeeSummary = preview.totalExcludesPendingPlateFee
    ? '制烫金版费不在本次已知费用合计中；批准修改后会进入后续管理员核价，不会被当作 0 元。核定版费后才能比较整单差额。'
    : null;
  const approvalWriteSummary = preview.totalExcludesPendingPlateFee
    ? '批准后会更新相关款式、数量、待开工任务与当前可确定费用；制烫金版费保持待核价，核定后再补入工单应收。'
    : '批准后会更新相关款式、数量、待开工任务和工单应收。';

  return [
    `申请基于工单第 ${preview.baseRevision} 版，共 ${preview.items.length} 项款式变更${changeSummary ? `（${changeSummary}）` : ''}。`,
    ...itemChanges,
    `${pricingSummary}批准时会按最新规则重算，并校验结果与本次预览一致；若规则或工单已变化，本次批准不会执行，需刷新后重试。`,
    ...(pendingChargeSummary ? [pendingChargeSummary] : []),
    ...(deferredPlateFeeSummary ? [deferredPlateFeeSummary] : []),
    approvalWriteSummary,
  ];
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
    return '取消申请已批准，工单已按服务端结算结果取消。';
  }
  return '修改申请已批准，工单已按最新规则更新。';
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
      className="space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">修改审批计价预览（只读）</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          管理员确认的是是否接受变更；款式加工费由系统按最新规则自动重算，当前预览仅供核对。
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">当前工单总额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {money(preview.oldTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">
            {preview.totalExcludesPendingPlateFee
              ? '新总额（暂不含版费）'
              : '新总额'}
          </dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.newTotal === null ? '待补全价格规则' : money(preview.newTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">整单差额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.totalExcludesPendingPlateFee
              ? '版费核定后可计算'
              : preview.delta === null
                ? '暂无法计算'
                : deltaMoney(preview.delta)}
          </dd>
        </div>
      </dl>

      {preview.requiresReviewRemark ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          自动计价规则尚未得出完整结果，请先补齐下方待处理费用或修正价格规则，再批准变更。
        </p>
      ) : null}

      {preview.totalExcludesPendingPlateFee ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
          制烫金版费不自动计算，当前新总额只是暂不含版费的已知费用。它与当前工单总额口径不同，因此在版费核定前不展示整单差额。批准修改后会保持“待管理员核价”，不会自动记为 0 元。
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
            ? `款式加工费已自动计算；以下 ${unresolvedPendingChargeCount} 票物流费因配送条件无法由规则唯一确定，需逐票补录后重新预览。`
            : `款式加工费已自动计算；${pendingCharges.length} 票物流费已按录入金额纳入本次预览。`}
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
                  {item.operation === 'ADD' ? '新增款式' : '修改款式'}
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
                {item.oldSubtotal === null ? '新增' : money(item.oldSubtotal)} →{' '}
                {item.newSubtotal === null ? '待补全规则' : money(item.newSubtotal)}
              </p>
              {item.priceImpact === 'QUOTED' ? (
                <p className="mt-1 text-muted-foreground">
                  自动单价 {money(item.suggestedUnitPrice as string)} ·
                  每款一次性费用{' '}
                  {money(item.suggestedFixedFee as string)}
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
        自动加工费已完成。这里只补录无法由配送规则唯一确定的运费，不会替代款式自动计价。
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
            <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.65fr)_minmax(12rem,1.35fr)]">
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

export function OrderChangeReviewForm({
  requestId,
  currentItems = [],
}: Props) {
  const router = useRouter();
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
  const refreshedResultRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (state?.status !== 'success') return;
    const resultKey = `${requestId}:${state.requestStatus}`;
    if (refreshedResultRef.current === resultKey) return;
    refreshedResultRef.current = resultKey;
    router.refresh();
  }, [requestId, router, state]);

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
  const approvalImpactItems = preview
    ? orderChangeApprovalImpactItems(preview)
    : [];
  const rejectionImpactItems = orderChangeRejectionImpactItems();
  const approveDisabled =
    pending ||
    reviewCompleted ||
    previewPending ||
    preview === null ||
    previewError !== null ||
    !Number.isSafeInteger(preview.priceRevision) ||
    !preview.complete ||
    !pendingChargesVerified;
  const rejectDisabled =
    pending || reviewCompleted || reviewRemark.trim() === '';

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending || previewPending}
      className="space-y-2"
    >
      {preview ? (
        <div className="space-y-2">
          <OrderChangePricingPreviewPanel
            preview={preview}
            currentItems={currentItems}
          />
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
      ) : null}
      {previewPending && !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在按当前价格规则生成审批预览…
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
              该组逐票运费已通过服务端重新预览，批准时将提交同一组数据。
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              运费录入发生变化，须重新预览成功后才能批准。
            </p>
          )}
        </div>
      ) : null}
      <label className="block space-y-1 text-sm">
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
      <div className="flex flex-wrap gap-2">
        <ConfirmActionDialog
          level="L2"
          disabled={approveDisabled}
          trigger={
            <Button type="button" className="min-h-11">
              {pending
                ? '处理中…'
                : pendingCharges.length > 0 && !pendingChargesVerified
                  ? '请先补齐运费并重新预览'
                  : !preview?.complete
                    ? '自动计价未完成'
                    : preview?.totalExcludesPendingPlateFee
                      ? '批准自动计价结果（版费后补）'
                      : '批准并按最新规则同步工单'}
            </Button>
          }
          title="批准这项工单修改申请？"
          description="请核对拟变更款式、自动计价预览和逐票运费。批准时会校验价格版本并重算。"
          impactItems={approvalImpactItems}
          confirmLabel="确认批准并同步工单"
          onConfirm={() => submit('APPROVE')}
        />
        <ConfirmActionDialog
          level="L2"
          disabled={rejectDisabled}
          trigger={
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
            >
              拒绝申请
            </Button>
          }
          title="拒绝这项工单修改申请？"
          description="拒绝后不会改动工单内容。请先在上方填写拒绝原因，该原因会保存到审核记录。"
          impactItems={rejectionImpactItems}
          confirmLabel="确认拒绝申请"
          onConfirm={() => submit('DENY')}
        />
      </div>
    </form>
  );
}
