import type { SampleOrderFormState, SampleOrderContext, SavedSampleDraft } from './sample-order-types';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { PendingDesignImage } from './pending-design-image';

export type SampleOrderEditorSnapshot = {
  purpose: 'SAMPLE_SHIPMENT' | 'PROOF';
  item: CreateOrderInput['items'][number];
  form: SampleOrderFormState;
  context?: SampleOrderContext;
  draft: SavedSampleDraft | null;
};

export type OrderEditorSnapshot = {
  sample?: SampleOrderEditorSnapshot;
  values: CreateOrderInput;
  files: PendingDesignImage[][];
};
export type OrderCreatedEntry = {
  orderId: string;
  orderNo: string;
  intent: 'draft' | 'submit' | 'fees';
};
export type OrderCreationEditor = {
  save: () => OrderEditorSnapshot;
  canLeave: boolean;
};

export type OrderCreationLifecycle = {
  retainResult?: boolean;
  submissionId?: string;
  onCreated: (entry: OrderCreatedEntry) => void;
  onCompleted: (entry: OrderCreatedEntry) => void;
  onBusyChange?: (busy: boolean) => void;
};
