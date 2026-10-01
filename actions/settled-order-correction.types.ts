export type SettledOrderCorrectionMutationResult =
  | { status: 'success'; message: string; settledFee: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
