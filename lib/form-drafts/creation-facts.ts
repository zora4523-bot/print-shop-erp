import Decimal from 'decimal.js';
import type { CreateBomInput, CreatePurchaseOrderInput } from '@/lib/auth/schemas';

/** Immutable business inputs only; never names read from mutable catalogs. */
export function purchaseCreationFacts(input: CreatePurchaseOrderInput) {
  return {
    supplierPartyId: input.supplierPartyId, materialId: input.materialId,
    quantity: new Decimal(input.quantity).toFixed(2),
    unitCost: input.unitCost === null ? null : new Decimal(input.unitCost).toFixed(4),
    expectedDate: input.expectedDate, remark: input.remark,
  };
}

export function bomCreationFacts(input: CreateBomInput) {
  return {
    targetType: input.targetType,
    productId: input.targetType === 'PRODUCT' ? input.productId : null,
    categoryNodeId: input.targetType === 'CATEGORY' ? input.categoryNodeId : null,
    blankPaperMaterialId: input.targetType === 'BLANK' ? input.blankPaperMaterialId ?? null : null,
    blankSpecificationKey: input.targetType === 'BLANK' ? input.blankSpecificationKey ?? null : null,
    name: input.name, version: input.version, baseQuantity: input.baseQuantity,
    items: input.items.map((item) => ({ materialId: item.materialId, quantity: new Decimal(item.quantity).toFixed(4), remark: item.remark })),
  };
}
