"use client";

import {
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
  return book ? `${book.name} · 第 ${book.version} 版` : "暂无生效价格";
}

export function OrderPricingReviewForm({ orderId }: Props) {
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
    router.refresh();
    loadPreview();
  }, [finalizeState, loadPreview, router]);

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
              ? group.suggestedUnitPrice
              : (packagingGroupDrafts[group.packagingGroupId]?.unitPrice ??
                group.currentUnitPrice),
          reason:
            packagingGroupDrafts[group.packagingGroupId]?.reason ??
            group.currentReason ??
            "",
        })),
        shipments: preview.shipments.map((shipment) => ({
          shipmentId: shipment.shipmentId,
          expectedDestinationProvince: shipment.destinationProvince,
          expectedBillableWeightKg: shipment.billableWeightKg,
          shippingFee:
            shipmentDrafts[shipment.shipmentId]?.shippingFee ??
            shipment.shipping.suggestedAmount ??
            shipment.shipping.currentAmount ??
            "0.00",
          packingMaterialFee:
            shipmentDrafts[shipment.shipmentId]?.packingMaterialFee ??
            shipment.packaging.suggestedAmount ??
            shipment.packaging.currentAmount ??
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
          shipment.shipping.suggestedAmount ??
          shipment.shipping.currentAmount ??
          ""
        ).trim() &&
        (
          draft?.packingMaterialFee ??
          shipment.packaging.suggestedAmount ??
          shipment.packaging.currentAmount ??
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
        <h2 className="text-base font-semibold">管理员整单重算与终价</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          确认时会按最新价格规则重新计算。
        </p>
      </div>

      {previewPending && !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在加载最新价格…
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
              <dt className="text-xs text-muted-foreground">加工费价格版本</dt>
              <dd className="mt-1 font-medium">
                {priceBookLabel(preview.processingPriceBook)}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">物流价格版本</dt>
              <dd className="mt-1 font-medium">
                {preview.logisticsPriceBook.name} · 第{" "}
                {preview.logisticsPriceBook.version} 版
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
                  : "全部可自动计价"}
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
                      {item.complete ? "最新规则自动价" : "管理员终价"}
                    </Badge>
                  </div>
                  {item.complete ? (
                    <p className="mt-2 font-sans text-xs tabular-nums text-muted-foreground">
                      提交时强制使用最新建议：单价 {item.suggestedUnitPrice} ·
                      一次性费用 {item.suggestedFixedFee} · 小计{" "}
                      {item.suggestedSubtotal}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
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
                    : "全部按袋自动计价"}
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
                          {group.complete ? "最新规则自动价" : "管理员终价"}
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
                                ? (group.suggestedUnitPrice ?? "")
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
                            {group.complete
                              ? group.suggestedSubtotal
                              : group.currentSubtotal}
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

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">逐票物流与耗材收费</h3>
            <ol className="grid gap-3 lg:grid-cols-2">
              {preview.shipments.map((shipment) => {
                const defaultDraft: ShipmentDraft = {
                  shippingFee:
                    shipment.shipping.suggestedAmount ??
                    shipment.shipping.currentAmount ??
                    "0.00",
                  packingMaterialFee:
                    shipment.packaging.suggestedAmount ??
                    shipment.packaging.currentAmount ??
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
                          快递费（建议{" "}
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
                          打包耗材费（参考{" "}
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
                  ? "正在整单重算…"
                  : "按最新价格重算并确认终价"}
              </Button>
            }
            title="确认整单重算并锁定本次终价？"
            description="确认时按最新规则重算，页面旧金额不会被沿用。"
            impactItems={[
              '若工单或价格已变化，本次操作会停止并提示刷新。',
              `自动价 ${preview.items.length - incompleteItemCount} 款将强制使用最新建议，${incompleteItemCount} 款使用管理员终价。`,
              `将按实际袋数重算 ${preview.packagingGroups.length} 个包装组，${incompletePackagingGroupCount} 组需管理员终价。`,
              `将重算 ${preview.shipments.length} 票快递/耗材费，更新整单金额并保留本次价格记录。`,
            ]}
            confirmLabel="确认重算与终价"
            onConfirm={submit}
          />
        </>
      ) : null}
    </section>
  );
}
