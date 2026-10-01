export type OrderPrintRecordResult =
  | { status: 'success'; marked: boolean }
  | { status: 'error'; message: string };
