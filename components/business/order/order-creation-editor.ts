import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { PendingDesignImage } from './pending-design-image';

export type OrderEditorSnapshot = {
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
