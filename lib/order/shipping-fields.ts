export type ShipmentInput = {
  id: string;
  sequence: number;
  receiverName: string | null;
  receiverAddress: string | null;
  trackingNo: string | null;
  weightKg: string | null;
  destinationProvince: string | null;
  shippingFee: string | null;
  packingMaterialFee: string | null;
  customerChargeOverrideReason: string | null;
};
