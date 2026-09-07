import type { ShipmentInput } from '@/lib/order/shipping-fields';

/** Only populated by the administrator's individual-order read. */
export type AdminOrderInlineOperationsData = {
  pricing: 'factory' | 'fulfillment' | null;
  shipping: {
    expectedRevision: number;
    expectedEditVersion: number;
    expectedWorkOrderVersion: number;
    expectedPriceRevision: number;
    shipments: ShipmentInput[];
    isExternalSales: boolean;
    isSfCollect: boolean;
  } | null;
  fulfillment: {
    currentValue: boolean;
    isPricingPending: boolean;
    shipments: Array<{
      id: string;
      sequence: number;
      destinationProvince: string | null;
      weightKg: string | null;
    }>;
  } | null;
};
