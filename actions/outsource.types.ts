export type OutsourceMutationResult =
  | { status: 'success'; id: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
