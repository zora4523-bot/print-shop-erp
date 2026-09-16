import Decimal from 'decimal.js';
import type { FinalizeOrderPricingCommand, OrderPricingReviewPreview } from '@/lib/order/pricing-review';
import { packagingUnit } from '@/lib/order/packaging-mode';

export type FeeField = { key: string; label: string; value: string; reference: string | null; scale: number };
export type FeeRow = { key: string; label: string; quantity: number; fields: FeeField[]; amount: string; pending: boolean };
export function adminFeeRows(preview: OrderPricingReviewPreview): FeeRow[] {
  const standard = !['PROOF', 'SAMPLE_SHIPMENT'].includes(preview.purpose ?? 'STANDARD');
  return [
    ...(standard ? preview.items.map((item) => ({
      key: item.itemId, label: `第 ${item.sequence} 款 · ${item.name}`, quantity: item.quantity, amount: item.currentSubtotal, pending: !item.complete,
      fields: [
        { key: `${item.itemId}:unit`, label: '加工单价', value: item.currentUnitPrice, reference: item.suggestedUnitPrice, scale: 4 },
        { key: `${item.itemId}:fixed`, label: '一次性费用', value: item.currentFixedFee, reference: item.suggestedFixedFee, scale: 2 },
      ],
    })) : []),
    ...(standard ? preview.packagingGroups.filter((group) => group.mode !== 'UNPACKED').map((group) => ({
      key: group.packagingGroupId, label: `包装组 ${group.sequence} · ${group.actualBagCount} ${packagingUnit(group.mode)}`, quantity: group.actualBagCount, amount: group.currentSubtotal, pending: !group.complete,
      fields: [{ key: `${group.packagingGroupId}:unit`, label: '包装加工单价', value: group.currentUnitPrice, reference: group.suggestedUnitPrice, scale: 4 }],
    })) : []),
    ...preview.orderCharges.map((charge) => ({
      key: charge.chargeId, label: charge.description, quantity: 1, amount: charge.currentAmount ?? '0', pending: charge.currentAmount === null || charge.errors.length > 0,
      fields: [{ key: charge.chargeId, label: '收费金额', value: charge.currentAmount ?? '', reference: charge.suggestedAmount, scale: 2 }],
    })),
    ...preview.shipments.flatMap((shipment) => (['shipping', 'packaging'] as const).map((kind) => ({
      key: `${shipment.shipmentId}:${kind}`, label: `地址 ${shipment.sequence} · ${kind === 'shipping' ? '快递费' : '包装耗材费'}`, quantity: 1,
      amount: shipment[kind].currentAmount ?? '0', pending: !shipment[kind].complete,
      fields: [{ key: `${shipment.shipmentId}:${kind}`, label: '收费金额', value: shipment[kind].currentAmount ?? '', reference: shipment[kind].suggestedAmount, scale: 2 }],
    }))),
  ];
}
export function feeRowAmount(row: FeeRow, values: Record<string, string>): Decimal {
  return new Decimal(values[row.fields[0].key] ?? row.fields[0].value).times(row.quantity)
    .plus(row.fields[1] ? values[row.fields[1].key] ?? row.fields[1].value : 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function feeEditorTotal(preview: OrderPricingReviewPreview, rows: FeeRow[], values: Record<string, string>): string | null {
  try {
    const total = rows.reduce((sum, row) => sum.minus(row.amount || '0').plus(feeRowAmount(row, values)), new Decimal(preview.currentTotalAmount));
    return total.isFinite() ? total.toFixed(2) : null;
  } catch { return null; }
}
export function feeEditorCommand(preview: OrderPricingReviewPreview, values: Record<string, string>, reason: string): FinalizeOrderPricingCommand {
  const changed = (key: string, current: string) => {
    if (values[key] === undefined) return false;
    try { return !new Decimal(values[key]).eq(current); } catch { return true; }
  };
  return {
    orderId: preview.orderId, editAll: true, expectedOrderRevision: preview.orderRevision, expectedPriceRevision: preview.priceRevision, remark: reason,
    items: ['PROOF', 'SAMPLE_SHIPMENT'].includes(preview.purpose ?? '') ? [] : preview.items.filter((item) => !item.complete || changed(`${item.itemId}:unit`, item.currentUnitPrice) || changed(`${item.itemId}:fixed`, item.currentFixedFee)).map((item) => ({
      itemId: item.itemId, unitPrice: values[`${item.itemId}:unit`] ?? item.currentUnitPrice, fixedFee: values[`${item.itemId}:fixed`] ?? item.currentFixedFee, reason,
    })),
    packagingGroups: preview.packagingGroups.map((group) => ({ packagingGroupId: group.packagingGroupId, expectedMode: group.mode, expectedActualBagCount: group.actualBagCount, unitPrice: values[`${group.packagingGroupId}:unit`] ?? group.currentUnitPrice, reason })),
    orderCharges: preview.orderCharges.map((charge) => ({ chargeId: charge.chargeId, expectedBusinessKey: charge.businessKey, amount: values[charge.chargeId] ?? charge.currentAmount ?? '', reason })),
    shipments: preview.shipments.map((shipment) => ({ shipmentId: shipment.shipmentId, expectedDestinationProvince: shipment.destinationProvince, expectedBillableWeightKg: shipment.billableWeightKg, shippingFee: values[`${shipment.shipmentId}:shipping`] ?? shipment.shipping.currentAmount ?? '', packingMaterialFee: values[`${shipment.shipmentId}:packaging`] ?? shipment.packaging.currentAmount ?? '', reason })),
  };
}
