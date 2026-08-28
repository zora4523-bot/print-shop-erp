"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
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
import { ConfirmActionDialog } from "@/components/ui-business";
import { OrderPackagingMode } from "@/generated/prisma/enums";
import { externalPriceBusinessText } from "@/lib/price/external-price-display";

type Props = { orderId: string };

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

const PACKAGING_MODE_LABELS: Record<OrderPackagingMode, string> = {
  [OrderPackagingMode.SINGLE_STYLE]: "单款装",
  [OrderPackagingMode.MIXED_STYLE]: "混装",
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
    : "历史金额（无版本快照）";
}

export function OrderPricingReviewForm({ orderId }: Props) {
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
    loadPreview();
  }, [finalizeState, loadPreview]);

  function submit() {
    if (!preview) return;
    startFinalizeTransition(() =>
      finalizeAction({
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
            "0.00",
          packingMaterialFee:
            shipmentDrafts[shipment.shipmentId]?.packingMaterialFee ??
            shipment.packaging.currentAmount ??
            shipment.packaging.suggestedAmount ??
            "0.00",
          reason:
            shipmentDrafts[shipment.shipmentId]?.reason ??
            shipment.currentReason ??
            "",
        })),
        remark,
      }),
    );
  }

  const previewError = resultError(previewState);
  const finalizeError = resultError(finalizeState);
  const draftsReady =
    preview !== null &&
    preview.items
      .filter((item) => !item.complete)
      .every((item) => {
        const draft = itemDrafts[item.itemId];
        return Boolean(
          (draft?.unitPrice ?? item.currentUnitPrice).trim() &&
          (draft?.fixedFee ?? item.currentFixedFee).trim() &&
          (draft?.reason ?? item.currentReason ?? "").trim(),
        );
      }) &&
    preview.packagingGroups.every((group) => {
      const draft = packagingGroupDrafts[group.packagingGroupId];
      return Boolean(
        (
          group.complete
            ? group.suggestedUnitPrice
            : (draft?.unitPrice ?? group.currentUnitPrice)
        )?.trim() &&
          (group.complete ||
            (draft?.reason ?? group.currentReason ?? "").trim()),
      );
    }) &&
    preview.orderCharges.every((charge) => {
      const draft = orderChargeDrafts[charge.chargeId];
      return Boolean(
        (
          draft?.amount ??
          charge.currentAmount ??
          charge.suggestedAmount ??
          ""
        ).trim() &&
          (draft?.reason ?? charge.currentReason ?? "").trim(),
      );
    }) &&
    preview.shipments.every((shipment) => {
      const draft = shipmentDrafts[shipment.shipmentId];
      const needsReason =
        !shipment.shipping.complete ||
        shipment.shipping.advisory ||
        !shipment.packaging.complete ||
        shipment.packaging.advisory;
      return Boolean(
        (
          draft?.shippingFee ??
          shipment.shipping.currentAmount ??
          shipment.shipping.suggestedAmount ??
          ""
        ).trim() &&
        (
          draft?.packingMaterialFee ??
          shipment.packaging.currentAmount ??
          shipment.packaging.suggestedAmount ??
          ""
        ).trim() &&
        (!needsReason ||
          (draft?.reason ?? shipment.currentReason ?? "").trim()),
      );
    });
  const incompleteItemCount =
    preview?.items.filter((item) => !item.complete).length ?? 0;
  const incompletePackagingGroupCount =
    preview?.packagingGroups.filter((group) => !group.complete).length ?? 0;

  return (
    <section
      className="space-y-4"
      aria-busy={previewPending || finalizePending}
    >
      <div>
        <h2 className="text-base font-semibold">工厂核价确认</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          仅核对工单已保存的报价快照；已锁定金额不会重新计算。
        </p>
      </div>

      {previewPending && !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取工单报价快照…
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
            disabled={previewPending}
          >
            重新加载
          </Button>
        </div>
      ) : null}

      {preview ? (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">加工费报价快照</dt>
              <dd className="mt-1 font-medium">
                {priceBookLabel(preview.processingPriceBook)}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">物流报价快照</dt>
              <dd className="mt-1 font-medium">
                {priceBookLabel(preview.logisticsPriceBook)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">款式加工费</h3>
              <Badge
                variant={incompleteItemCount > 0 ? "destructive" : "secondary"}
              >
                {incompleteItemCount > 0
                  ? `${incompleteItemCount} 款需人工终价`
                  : "全部已有锁定金额"}
              </Badge>
            </div>
            <ol className="space-y-2">
              {preview.items.map((item) => (
                <li key={item.itemId} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      #{item.sequence} · {externalPriceBusinessText(item.name)} ·{" "}
                      {item.quantity.toLocaleString("zh-CN")} 个
                    </p>
                    <Badge
                      variant={item.complete ? "secondary" : "destructive"}
                    >
                      {item.complete ? "已锁定快照价" : "待人工核价"}
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

          {preview.packagingGroups.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">包装组入袋费</h3>
                <Badge
                  variant={
                    incompletePackagingGroupCount > 0
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {incompletePackagingGroupCount > 0
                    ? `${incompletePackagingGroupCount} 组需人工终价`
                    : "全部已有锁定金额"}
                </Badge>
              </div>
              <ol className="space-y-2">
                {preview.packagingGroups.map((group) => {
                  const defaultDraft: PackagingGroupDraft = {
                    unitPrice: group.currentUnitPrice,
                    reason: group.currentReason ?? "",
                  };
                  const draft =
                    packagingGroupDrafts[group.packagingGroupId] ?? defaultDraft;
                  return (
                    <li
                      key={group.packagingGroupId}
                      className="space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">
                          包装组 #{group.sequence} · {group.name ?? "未命名"} ·{" "}
                          {PACKAGING_MODE_LABELS[group.mode]} ·{" "}
                          {group.actualBagCount.toLocaleString("zh-CN")} 袋
                        </p>
                        <Badge
                          variant={group.complete ? "secondary" : "destructive"}
                        >
                          {group.complete ? "已锁定快照价" : "待人工核价"}
                        </Badge>
                      </div>
                      {group.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {group.errors.join("；")}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs">
                          <span>每袋入袋费（元）</span>
                          <Input
                            required
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
                          <span>入袋费小计</span>
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
                <Badge variant="destructive">
                  {preview.orderCharges.length} 项待人工终价
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
                      key={charge.chargeId}
                      className="space-y-3 rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">{charge.description}</p>
                        <Badge variant="destructive">待人工核价</Badge>
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

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">逐票物流与耗材收费</h3>
            <ol className="grid gap-3 lg:grid-cols-2">
              {preview.shipments.map((shipment) => {
                const defaultDraft: ShipmentDraft = {
                  shippingFee:
                    shipment.shipping.currentAmount ??
                    shipment.shipping.suggestedAmount ??
                    "0.00",
                  packingMaterialFee:
                    shipment.packaging.currentAmount ??
                    shipment.packaging.suggestedAmount ??
                    "0.00",
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
                    key={shipment.shipmentId}
                    className="space-y-3 rounded-md border p-3 text-sm"
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
                          快递费（快照建议{" "}
                          {shipment.shipping.suggestedAmount ?? "无"}）
                        </span>
                        <Input
                          required
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
                          打包耗材费（快照参考{" "}
                          {shipment.packaging.suggestedAmount ?? "无"}）
                        </span>
                        <Input
                          required
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
                    <label className="block space-y-1 text-xs">
                      <span>
                        收费确认说明
                        {needsReason ? "（人工/参考价必填）" : "（可选）"}
                      </span>
                      <Textarea
                        required={needsReason}
                        maxLength={500}
                        value={draft.reason}
                        onChange={(event) =>
                          setShipmentDrafts((current) => ({
                            ...current,
                            [shipment.shipmentId]: {
                              ...(current[shipment.shipmentId] ?? defaultDraft),
                              reason: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </li>
                );
              })}
            </ol>
          </div>

          <label className="block space-y-1 text-sm">
            <span>整单终价备注（可选）</span>
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
              终价已确认：入袋费 {finalizeState.packagingAmount}，加工费合计{" "}
              {finalizeState.processingAmount}，工单总额{" "}
              {finalizeState.totalAmount}。
            </p>
          ) : null}

          <ConfirmActionDialog
            level="L2"
            disabled={!draftsReady || finalizePending || previewPending}
            trigger={
              <Button
                type="button"
                disabled={!draftsReady || finalizePending || previewPending}
              >
                {finalizePending
                  ? "正在确认报价快照…"
                  : "确认工厂核价"}
              </Button>
            }
            title="确认工厂核价并锁定终价？"
            description="确认仅使用工单已有报价快照；只会补录待人工核价金额。"
            impactItems={[
              '若工单或价格已变化，本次操作会停止并提示刷新。',
              `已有快照价 ${preview.items.length - incompleteItemCount} 款保持不变，${incompleteItemCount} 款需录入人工核价。`,
              `${preview.packagingGroups.length - incompletePackagingGroupCount} 个包装组保持已有金额，${incompletePackagingGroupCount} 组需录入人工核价。`,
              `${preview.shipments.length} 票快递/耗材费仅确认已有快照或补录待核价金额。`,
            ]}
            confirmLabel="确认工厂核价"
            onConfirm={submit}
          />
        </>
      ) : null}
    </section>
  );
}
