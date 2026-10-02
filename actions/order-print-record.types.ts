import type { RenderedPrintOutcome } from '@/lib/order/print-jobs';

export type OrderPrintRecordResult =
  | { status: 'success'; outcome: RenderedPrintOutcome }
  | { status: 'error'; message: string };

export type BatchPrintRecordResult =
  | { status: 'success'; marked: number }
  | { status: 'error'; message: string };
