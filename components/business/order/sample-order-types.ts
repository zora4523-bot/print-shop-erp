import type { CreateOrderInput } from '@/lib/auth/schemas';

export type SampleOrderFormState = {
  name: string;
  quantity: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  province: string;
  packing: string;
  collect: boolean;
  remark: string;
};
export type SampleOrderContext = Pick<CreateOrderInput, 'externalSalesUserId' | 'customerRef' | 'promisedDate' | 'isUrgent' | 'expressCode' | 'customName' | 'packageRequirement'>;

export type SavedSampleDraft = { orderId: string; itemIds: string[] };
