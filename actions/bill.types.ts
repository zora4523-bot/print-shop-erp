import type { BillStatus } from '../generated/prisma/enums';

export type BillMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type GenerateBillsResult =
  | {
      status: 'success';
      period: string;
      generatedCount: number;
      supplementalCount: number;
      errorCount: number;
      errors: Array<{ salesUserId: string; message: string }>;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type RecordBillPaymentResult =
  | {
      status: 'success';
      newPaidAmount: string;
      totalAmount: string;
      billStatus: BillStatus;
      csAccumulated: boolean;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type OrderCostMutationResult =
  | { status: 'success'; costEntryId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
