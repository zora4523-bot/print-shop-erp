"use client";
import { packagingUnit, PACKAGING_MODE_LABELS } from '@/lib/order/packaging-mode';

import {
  type Dispatch,
  type SetStateAction,
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  finalizeOrderPricingAction,
  previewOrderPricingReviewAction,
} from "@/actions/order";
import type {
  FinalizeOrderPricingMutationResult,
  PreviewOrderPricingReviewResult,
} from "@/actions/order.types";
import type { OrderPricingReviewPreview } from "@/lib/order/pricing-review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { externalPriceBusinessText } from "@/lib/price/external-price-display";
import { useOrderEditorAuxiliary } from './use-order-editor-auxiliary';

type Props = { orderId: string; variant?: 'page' | 'drawer'; onSuccess?: () => void };

type ItemDraft = {
  unitPrice: string;
  fixedFee: string;
  reason: string;
};

type ShipmentDraft = {
  shippingFee: string;
  packingMaterialFee: string;
  reason: string;
};

type PackagingGroupDraft = {
  unitPrice: string;
  reason: string;
};

type OrderChargeDraft = {
  amount: string;
  reason: string;
};
function resultError(
  result:
    FinalizeOrderPricingMutationResult | PreviewOrderPricingReviewResult | null,
): string | null {
  if (result?.status === "error") return result.message;
  if (result?.status === "invalid") {
    return Object.values(result.fieldErrors).flat()[0] ?? "提交内容非法";
  }
  return null;
}

function priceBookLabel(
  book: OrderPricingReviewPreview["processingPriceBook"],
): string {
  return book
    ? `${book.name} · 第 ${book.version} 版`
    : "历史金额";
}

/**
 * 把预览数据与管理员草稿合并成 finalizeOrderPricingAction 的输入。
 * 纯函数：草稿缺省时回退到当前值或建议值，已完成的行原样带回。
 */
function buildFinalizePayload({
  orderId,
  preview,
  itemDrafts,
  packagingGroupDrafts,
  orderChargeDrafts,
  shipmentDrafts,
  remark,
}: {
  orderId: string;
  preview: OrderPricingReviewPreview;
  itemDrafts: Record<string, ItemDraft>;
  packagingGroupDrafts: Record<string, PackagingGroupDraft>;
  orderChargeDrafts: Record<string, OrderChargeDraft>;
  shipmentDrafts: Record<string, ShipmentDraft>;
  remark: string;
}) {
  return {
    orderId,
    expectedOrderRevision: preview.orderRevision,
    expectedPriceRevision: preview.priceRevision,
    items: preview.items
      .filter((item) => !item.complete)
      .map((item) => ({
        itemId: item.itemId,
        unitPrice:
          itemDrafts[item.itemId]?.unitPrice ?? item.currentUnitPrice,
        fixedFee: itemDrafts[item.itemId]?.fixedFee ?? item.currentFixedFee,
        reason: itemDrafts[item.itemId]?.reason ?? item.currentReason ?? "",
      })),
    packagingGroups: preview.packagingGroups.map((group) => ({
      packagingGroupId: group.packagingGroupId,
      expectedMode: group.mode,
      expectedActualBagCount: group.actualBagCount,
      unitPrice:
        group.complete
          ? group.currentUnitPrice
          : (packagingGroupDrafts[group.packagingGroupId]?.unitPrice ??
            group.currentUnitPrice),
      reason:
        packagingGroupDrafts[group.packagingGroupId]?.reason ??
        group.currentReason ??
        "",
    })),
    orderCharges: preview.orderCharges.map((charge) => ({
      chargeId: charge.chargeId,
      expectedBusinessKey: charge.businessKey,
      amount:
        orderChargeDrafts[charge.chargeId]?.amount ??
        charge.currentAmount ??
        charge.suggestedAmount ??
        "",
      reason:
        orderChargeDrafts[charge.chargeId]?.reason ??
        charge.currentReason ??
        "",
    })),
    shipments: preview.shipments.map((shipment) => ({
      shipmentId: shipment.shipmentId,
      expectedDestinationProvince: shipment.destinationProvince,
      expectedBillableWeightKg: shipment.billableWeightKg,
      shippingFee:
        shipmentDrafts[shipment.shipmentId]?.shippingFee ??
        shipment.shipping.currentAmount ??
        shipment.shipping.suggestedAmount ??
        "",
      packingMaterialFee:
        shipmentDrafts[shipment.shipmentId]?.packingMaterialFee ??
        shipment.packaging.currentAmount ??
        shipment.packaging.suggestedAmount ??
        "",
      reason:
        shipmentDrafts[shipment.shipmentId]?.reason ??
        shipment.currentReason ??
        "",
    })),
    remark,
  };
}

function hasValue(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function PricingReviewShipmentFields({ preview, shipmentDrafts, setShipmentDrafts, showReadOnly }: {
  preview: OrderPricingReviewPreview;
  shipmentDrafts: Record<string, ShipmentDraft>;
  setShipmentDrafts: Dispatch<SetStateAction<Record<string, ShipmentDraft>>>;
  showReadOnly: boolean;
}) {
  return (
    <>
      {preview.shipments.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">逐票物流与耗材收费</h3>
          <ol className="grid gap-3 lg:grid-cols-2">
            {preview.shipments.filter((shipment) => showReadOnly || !shipment.shipping.complete || shipment.shipping.advisory || !shipment.packaging.complete || shipment.packaging.advisory).map((shipment) => {
              const defaultDraft: ShipmentDraft = {
                shippingFee:
                  shipment.shipping.currentAmount ??
                  shipment.shipping.suggestedAmount ??
                  "",
                packingMaterialFee:
                  shipment.packaging.currentAmount ??
                  shipment.packaging.suggestedAmount ??
                  "",
                reason: shipment.currentReason ?? "",
              };
              const draft =
                shipmentDrafts[shipment.shipmentId] ?? defaultDraft;
              const shippingAutomatic =
                shipment.shipping.complete && !shipment.shipping.advisory;
              const packagingAutomatic =
                shipment.packaging.complete && !shipment.packaging.advisory;
              const needsReason = !shippingAutomatic || !packagingAutomatic;
              return (
                <li
                  id={`pricing-review-shipment-${shipment.shipmentId}`}
                  key={shipment.shipmentId}
                  className="scroll-mt-24 space-y-3 rounded-md border p-3 text-sm"
                >
                  <p className="font-medium">
                    地址 {shipment.sequence} ·{" "}
                    {shipment.itemQuantity.toLocaleString("zh-CN")} 个
                  </p>
                  {[
                    ...shipment.shipping.errors,
                    ...shipment.packaging.errors,
                  ].length > 0 ? (
                    <p className="text-xs text-destructive">
                      {[
                        ...shipment.shipping.errors,
                        ...shipment.packaging.errors,
                      ]
                        .filter((value, index, values) =>
                          values.indexOf(value) === index,
                        )
                        .join("；")}
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs">
                      <span>计费省份</span>
                      <Input
                        value={shipment.destinationProvince ?? ""}
                        readOnly
                        aria-readonly="true"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>计费重量（kg）</span>
                      <Input
                        inputMode="decimal"
                        value={shipment.billableWeightKg ?? ""}
                        readOnly
                        aria-readonly="true"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>
                        快递费（已报{" "}
                        {shipment.shipping.suggestedAmount ?? "无"}）
                      </span>
                      <Input
                        required={!shippingAutomatic}
                        inputMode="decimal"
                        value={draft.shippingFee}
                        readOnly={shippingAutomatic}
                        aria-readonly={shippingAutomatic}
                        onChange={(event) =>
                          setShipmentDrafts((current) => ({
                            ...current,
                            [shipment.shipmentId]: {
                              ...(current[shipment.shipmentId] ??
                                defaultDraft),
                              shippingFee: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span>
                        打包耗材费（已报{" "}
                        {shipment.packaging.suggestedAmount ?? "无"}）
                      </span>
                      <Input
                        required={!packagingAutomatic}
                        inputMode="decimal"
                        value={draft.packingMaterialFee}
                        readOnly={packagingAutomatic}
                        aria-readonly={packagingAutomatic}
                        onChange={(event) =>
                          setShipmentDrafts((current) => ({
                            ...current,
                            [shipment.shipmentId]: {
                              ...(current[shipment.shipmentId] ??
                                defaultDraft),
                              packingMaterialFee: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                  {needsReason ? (
                    <label className="block space-y-1 text-xs">
                      <span>收费确认说明（人工/参考价必填）</span>
                      <Textarea
                        required
                        maxLength={500}
                        value={draft.reason}
                        onChange={(event) =>
                          setShipmentDrafts((current) => ({
                            ...current,
                            [shipment.shipmentId]: {
                              ...(current[shipment.shipmentId] ??
                                defaultDraft),
                              reason: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </>
  );
}

export function OrderPricingReviewForm({ orderId, variant = 'page', onSuccess }: Props) {
  const router = useRouter();
  const [previewState, previewAction] = useActionState<
    PreviewOrderPricingReviewResult | null,
    unknown
  >(previewOrderPricingReviewAction, null);
  const [finalizeState, finalizeAction] = useActionState<
    FinalizeOrderPricingMutationResult | null,
    unknown
  >(finalizeOrderPricingAction, null);
  const [previewPending, startPreviewTransition] = useTransition();
  const [finalizePending, startFinalizeTransition] = useTransition();
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [shipmentDrafts, setShipmentDrafts] = useState<
    Record<string, ShipmentDraft>
  >({});
  const [packagingGroupDrafts, setPackagingGroupDrafts] = useState<
    Record<string, PackagingGroupDraft>
  >({});
  const [orderChargeDrafts, setOrderChargeDrafts] = useState<
    Record<string, OrderChargeDraft>
  >({});
  const [remark, setRemark] = useState("");
  const dirty = remark !== '' || [itemDrafts, shipmentDrafts, packagingGroupDrafts, orderChargeDrafts]
    .some((drafts) => Object.keys(drafts).length > 0);
  const auxiliary = useOrderEditorAuxiliary({ dirty, pending: previewPending || finalizePending });
  function resetDraft() {
    setItemDrafts({});
    setShipmentDrafts({});
    setPackagingGroupDrafts({});
    setOrderChargeDrafts({});
    setRemark('');
  }
  const [expandedReadOnly, setExpandedReadOnly] = useState(false);
  const showReadOnly = variant !== 'drawer' || expandedReadOnly;

  const loadPreview = useCallback(() => {
    startPreviewTransition(() => previewAction({ orderId }));
  }, [orderId, previewAction]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const preview =
    previewState?.status === "success" ? previewState.preview : null;

  useEffect(() => {
    if (finalizeState?.status !== "success") return;
    // 确认成功后工单已不再是“待管理员确认”。刷新服务端页面
    // 以移除表单，不再重复请求已被服务端禁止的核价预览。
    if (onSuccess) onSuccess();
    else router.refresh();
  }, [finalizeState, router, onSuccess]);

  function submit() {
    if (!preview || finalizeState?.status === "success" || auxiliary.blocked || finalizePending || previewPending) return;
    startFinalizeTransition(() =>
      finalizeAction(
        buildFinalizePayload({
          orderId,
          preview,
          itemDrafts,
          packagingGroupDrafts,
          orderChargeDrafts,
          shipmentDrafts,
          remark,
        }),
      ),
    );
  }

  const previewError = resultError(previewState);
  const finalizeError = resultError(finalizeState);
  const incompleteItemCount =
    preview?.items.filter((item) => !item.complete).length ?? 0;
  const incompletePackagingGroupCount =
    preview?.packagingGroups.filter((group) => !group.complete).length ?? 0;
  const pendingReviewTargets = preview
    ? [
        ...preview.items
          .filter((item) => !item.complete)
          .map((item) => ({
            href: `#pricing-review-item-${item.itemId}`,
            label: `款式 #${item.sequence} ${externalPriceBusinessText(item.name)}`,
          })),
        ...preview.packagingGroups
          .filter((group) => !group.complete)
          .map((group) => ({
            href: `#pricing-review-packaging-${group.packagingGroupId}`,
            label: `包装组 #${group.sequence} 包装费`,
          })),
        ...preview.orderCharges.map((charge) => ({
          href: `#pricing-review-charge-${charge.chargeId}`,
          label: charge.description,
        })),
        ...preview.shipments
          .filter(
            (shipment) =>
              !shipment.shipping.complete ||
              shipment.shipping.advisory ||
              !shipment.packaging.complete ||
              shipment.packaging.advisory,
          )
          .map((shipment) => ({
            href: `#pricing-review-shipment-${shipment.shipmentId}`,
            label: `地址 ${shipment.sequence} 快递/耗材费`,
          })),
      ]
    : [];
  const missingRequirements = preview
    ? [
        ...preview.items.flatMap((item) => {
          if (item.complete) return [];
          const draft = itemDrafts[item.itemId];
          const label = `款式 #${item.sequence}`;
          return [
            ...(!hasValue(draft?.unitPrice ?? item.currentUnitPrice)
              ? [`${label} 客户单价`]
              : []),
            ...(!hasValue(draft?.fixedFee ?? item.currentFixedFee)
              ? [`${label} 每款一次性费用`]
              : []),
            ...(!hasValue(draft?.reason ?? item.currentReason)
              ? [`${label} 定价依据`]
              : []),
          ];
        }),
        ...preview.packagingGroups.flatMap((group) => {
          if (group.complete) return [];
          const draft = packagingGroupDrafts[group.packagingGroupId];
          const label = `包装组 #${group.sequence}`;
          return [
            ...(!hasValue(draft?.unitPrice ?? group.currentUnitPrice)
              ? [`${label} 每${packagingUnit(group.mode)}包装费`]
              : []),
            ...(!hasValue(draft?.reason ?? group.currentReason)
              ? [`${label} 定价依据`]
              : []),
          ];
        }),
        ...preview.orderCharges.flatMap((charge) => {
          const draft = orderChargeDrafts[charge.chargeId];
          return [
            ...(!hasValue(
              draft?.amount ?? charge.currentAmount ?? charge.suggestedAmount,
            )
              ? [`${charge.description} 确认金额`]
              : []),
            ...(!hasValue(draft?.reason ?? charge.currentReason)
              ? [`${charge.description} 定价依据`]
              : []),
          ];
        }),
        ...preview.shipments.flatMap((shipment) => {
          const draft = shipmentDrafts[shipment.shipmentId];
          const needsReason =
            !shipment.shipping.complete ||
            shipment.shipping.advisory ||
            !shipment.packaging.complete ||
            shipment.packaging.advisory;
          const label = `地址 ${shipment.sequence}`;
          return [
            ...(!hasValue(
              draft?.shippingFee ??
                shipment.shipping.currentAmount ??
                shipment.shipping.suggestedAmount,
            )
              ? [`${label} 快递费`]
              : []),
            ...(!hasValue(
              draft?.packingMaterialFee ??
                shipment.packaging.currentAmount ??
                shipment.packaging.suggestedAmount,
            )
              ? [`${label} 打包耗材费`]
              : []),
            ...(needsReason && !hasValue(draft?.reason ?? shipment.currentReason)
              ? [`${label} 收费确认说明`]
              : []),
          ];
        }),
      ]
    : [];
  const draftsReady = preview !== null && missingRequirements.length === 0;
  const pricingFinalized = finalizeState?.status === "success";
  const submissionDisabled =
    !draftsReady || finalizePending || previewPending || pricingFinalized || auxiliary.blocked;

  return (
    <section
      className="space-y-4"
      data-slot="order-pricing-review"
      data-variant={variant}
      aria-busy={previewPending || finalizePending}
    >
      {auxiliary.blocked ? <p className="text-xs text-muted-foreground">请先保存或还原正在编辑的工单资料或费用。</p> : null}
      <fieldset disabled={auxiliary.blocked || finalizePending || previewPending} className="min-w-0 space-y-4">
      {variant !== 'drawer' ? <div>
        <h2 className="text-base font-semibold">工厂核价确认</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          请补录待核价项。
        </p>
      </div> : null}

      {previewPending && !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在加载费用…
        </p>
      ) : null}
      {previewError ? (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3">
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={loadPreview}
            disabled={previewPending || auxiliary.blocked}
          >
            重新加载
          </Button>
        </div>
      ) : null}

      {preview ? (
        <>
          {variant === 'drawer' ? <Button type="button" variant="outline" aria-expanded={expandedReadOnly} onClick={() => setExpandedReadOnly(!expandedReadOnly)}>
            {expandedReadOnly ? '收起已确定费用' : '查看已确定费用'}
          </Button> : null}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">待管理员补录</h3>
              <Badge
                variant="secondary"
              >
                {pendingReviewTargets.length} 项
              </Badge>
            </div>
            {pendingReviewTargets.length > 0 ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  点击项目可直接定位到待填字段。
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {pendingReviewTargets.map((target) => (
                    <li key={target.href}>
                      <a
                        href={target.href}
                        onClick={(event) => {
                          if (variant !== 'drawer') return;
                          event.preventDefault();
                          document.getElementById(target.href.slice(1))?.scrollIntoView({ block: 'nearest' });
                        }}
                        className="inline-flex rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium underline-offset-4 hover:underline"
                      >
                        {target.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                无待补录金额。
              </p>
            )}
          </div>

          {showReadOnly ? <dl
            className={`grid gap-2 text-sm ${
              preview.logisticsPriceBook || preview.shipments.length > 0
                ? "sm:grid-cols-2"
                : "sm:grid-cols-1"
            }`}
          >
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">加工费报价</dt>
              <dd className="mt-1 font-medium">
                {priceBookLabel(preview.processingPriceBook)}
              </dd>
            </div>
            {preview.logisticsPriceBook || preview.shipments.length > 0 ? (
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">物流报价</dt>
                <dd className="mt-1 font-medium">
                  {priceBookLabel(preview.logisticsPriceBook)}
                </dd>
              </div>
            ) : null}
          </dl> : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">款式加工费</h3>
              <Badge
                variant="secondary"
              >
                {incompleteItemCount > 0
                  ? `${incompleteItemCount} 款需人工核价`
                  : "已报价"}
              </Badge>
            </div>
            <ol className="space-y-2">
              {preview.items.filter((item) => showReadOnly || !item.complete).map((item) => (
                <li
                  id={`pricing-review-item-${item.itemId}`}
                  key={item.itemId}
                  className="scroll-mt-24 rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      #{item.sequence} · {externalPriceBusinessText(item.name)} ·{" "}
                      {item.quantity.toLocaleString("zh-CN")} 个
                    </p>
                    <Badge
                      variant="secondary"
                    >
                      {item.complete ? "已报价" : "待人工核价"}
                    </Badge>
                  </div>
                  {item.complete ? (
                    <p className="mt-2 font-sans text-xs tabular-nums text-muted-foreground">
                      保持已有金额不变：单价 {item.currentUnitPrice} · 一次性费用{" "}
                      {item.currentFixedFee} · 小计 {item.currentSubtotal}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {item.manualQuoteReason ? (
                        <p className="text-xs text-muted-foreground">
                          建单转人工原因：{item.manualQuoteReason}
                        </p>
                      ) : null}
                      {item.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {item.errors.join("；")}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs">
                          <span>客户单价（最多 4 位小数）</span>
                          <Input
                            required
                            inputMode="decimal"
                            value={
                              itemDrafts[item.itemId]?.unitPrice ??
                              item.currentUnitPrice
                            }
                            onChange={(event) =>
                              setItemDrafts((current) => {
                                const previous = current[item.itemId] ?? {
                                  unitPrice: item.currentUnitPrice,
                                  fixedFee: item.currentFixedFee,
                                  reason: item.currentReason ?? "",
                                };
                                return {
                                  ...current,
                                  [item.itemId]: {
                                    ...previous,
                                    unitPrice: event.target.value,
                                  },
                                };
                              })
                            }
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>每款一次性费用</span>
                          <Input
                            required
                            inputMode="decimal"
                            value={
                              itemDrafts[item.itemId]?.fixedFee ??
                              item.currentFixedFee
                            }
                            onChange={(event) =>
                              setItemDrafts((current) => {
                                const previous = current[item.itemId] ?? {
                                  unitPrice: item.currentUnitPrice,
                                  fixedFee: item.currentFixedFee,
                                  reason: item.currentReason ?? "",
                                };
                                return {
                                  ...current,
                                  [item.itemId]: {
                                    ...previous,
                                    fixedFee: event.target.value,
                                  },
                                };
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="block space-y-1 text-xs">
                        <span>定价依据</span>
                        <Textarea
                          required
                          maxLength={500}
                          value={
                            itemDrafts[item.itemId]?.reason ??
                            item.currentReason ??
                            ""
                          }
                          onChange={(event) =>
                            setItemDrafts((current) => {
                              const previous = current[item.itemId] ?? {
                                unitPrice: item.currentUnitPrice,
                                fixedFee: item.currentFixedFee,
                                reason: item.currentReason ?? "",
                              };
                              return {
                                ...current,
                                [item.itemId]: {
                                  ...previous,
                                  reason: event.target.value,
                                },
                              };
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {preview.packagingGroups.some((group) => showReadOnly || !group.complete) ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">包装组费用</h3>
                <Badge
                  variant="secondary"
                >
                  {incompletePackagingGroupCount > 0
                    ? `${incompletePackagingGroupCount} 组需人工核价`
                    : "已报价"}
                </Badge>
              </div>
              <ol className="space-y-2">
                {preview.packagingGroups.filter((group) => showReadOnly || !group.complete).map((group) => {
                  const defaultDraft: PackagingGroupDraft = {
                    unitPrice: group.currentUnitPrice,
                    reason: group.currentReason ?? "",
                  };
                  const draft =
                    packagingGroupDrafts[group.packagingGroupId] ?? defaultDraft;
                  return (
                    <li
                      id={`pricing-review-packaging-${group.packagingGroupId}`}
                      key={group.packagingGroupId}
                      className="scroll-mt-24 space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">
                          包装组 #{group.sequence} · {group.name ?? "未命名"} ·{" "}
                          {PACKAGING_MODE_LABELS[group.mode]}
                          {group.mode !== "UNPACKED"
                            ? ` · ${group.actualBagCount.toLocaleString("zh-CN")} ${packagingUnit(group.mode)}`
                            : null}
                        </p>
                        <Badge
                          variant="secondary"
                        >
                          {group.complete ? "已报价" : "待人工核价"}
                        </Badge>
                      </div>
                      {group.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {group.errors.join("；")}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs">
                          <span>{group.mode === "UNPACKED" ? "包装费（元）" : `每${packagingUnit(group.mode)}包装费（元）`}</span>
                          <Input
                            required={!group.complete}
                            inputMode="decimal"
                            readOnly={group.complete}
                            aria-readonly={group.complete}
                            value={
                              group.complete
                                ? group.currentUnitPrice
                                : draft.unitPrice
                            }
                            onChange={(event) =>
                              setPackagingGroupDrafts((current) => ({
                                ...current,
                                [group.packagingGroupId]: {
                                  ...(current[group.packagingGroupId] ??
                                    defaultDraft),
                                  unitPrice: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <div className="space-y-1 text-xs">
                          <span>包装费小计</span>
                          <p className="min-h-10 rounded-md border bg-muted/40 px-3 py-2 font-sans tabular-nums">
                            {group.currentSubtotal}
                          </p>
                        </div>
                      </div>
                      {!group.complete ? (
                        <label className="block space-y-1 text-xs">
                          <span>定价依据</span>
                          <Textarea
                            required
                            maxLength={500}
                            value={draft.reason}
                            onChange={(event) =>
                              setPackagingGroupDrafts((current) => ({
                                ...current,
                                [group.packagingGroupId]: {
                                  ...(current[group.packagingGroupId] ??
                                    defaultDraft),
                                  reason: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {preview.orderCharges.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">订单级待核价费用</h3>
                <Badge variant="secondary">
                  {preview.orderCharges.length} 项待人工核价
                </Badge>
              </div>
              <ol className="space-y-2">
                {preview.orderCharges.map((charge) => {
                  const defaultDraft: OrderChargeDraft = {
                    amount:
                      charge.currentAmount ?? charge.suggestedAmount ?? "",
                    reason: charge.currentReason ?? "",
                  };
                  const draft =
                    orderChargeDrafts[charge.chargeId] ?? defaultDraft;
                  return (
                    <li
                      id={`pricing-review-charge-${charge.chargeId}`}
                      key={charge.chargeId}
                      className="scroll-mt-24 space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">{charge.description}</p>
                        <Badge variant="secondary">待人工核价</Badge>
                      </div>
                      {charge.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {charge.errors.join("；")}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs">
                          <span>确认金额（元）</span>
                          <Input
                            required
                            inputMode="decimal"
                            value={draft.amount}
                            onChange={(event) =>
                              setOrderChargeDrafts((current) => ({
                                ...current,
                                [charge.chargeId]: {
                                  ...(current[charge.chargeId] ?? defaultDraft),
                                  amount: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>定价依据</span>
                          <Textarea
                            required
                            maxLength={500}
                            value={draft.reason}
                            onChange={(event) =>
                              setOrderChargeDrafts((current) => ({
                                ...current,
                                [charge.chargeId]: {
                                  ...(current[charge.chargeId] ?? defaultDraft),
                                  reason: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          <PricingReviewShipmentFields
            showReadOnly={showReadOnly}
            preview={preview}
            shipmentDrafts={shipmentDrafts}
            setShipmentDrafts={setShipmentDrafts}
          />

          <label className="block space-y-1 text-sm">
            <span>整单费用备注（可选）</span>
            <Textarea
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={500}
            />
          </label>

          {finalizeError ? (
            <p role="alert" className="text-sm text-destructive">
              {finalizeError}
            </p>
          ) : null}
          {finalizeState?.status === "success" ? (
            <p role="status" className="text-sm text-success-foreground">
              费用已确认：包装费 {finalizeState.packagingAmount}，加工费合计{" "}
              {finalizeState.processingAmount}，工单总额{" "}
              {finalizeState.totalAmount}。
            </p>
          ) : null}

          <div
            aria-live="polite"
            className={`rounded-md border p-3 text-sm ${
              missingRequirements.length > 0
                ? "border-destructive/40 bg-destructive/5"
                : "bg-muted/30"
            }`}
          >
            {missingRequirements.length > 0 ? (
              <>
                <p className="font-medium">
                  还需完成 {missingRequirements.length} 个必填项后才能确认：
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {missingRequirements.map((requirement, index) => (
                    <li key={`${index}-${requirement}`}>{requirement}</li>
                  ))}
                </ul>
              </>
            ) : pricingFinalized ? (
              <p className="font-medium">费用已确认，正在刷新工单状态…</p>
            ) : (
              <p className="font-medium">待核价必填项已完成，可以确认费用。</p>
            )}
          </div>

            <Button type="button" data-slot="pricing-submit" disabled={submissionDisabled} onClick={submit}>
              {pricingFinalized ? '费用已确认' : finalizePending ? '正在保存核价…' : '确认工厂核价'}
            </Button>
        </>
      ) : null}
      </fieldset>
      {auxiliary.managed && dirty ? <Button type="button" variant="outline" disabled={previewPending || finalizePending || auxiliary.pending} onClick={resetDraft}>还原核价输入</Button> : null}
    </section>
  );
}
