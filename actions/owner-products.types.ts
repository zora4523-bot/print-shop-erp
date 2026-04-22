export type ProductMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
