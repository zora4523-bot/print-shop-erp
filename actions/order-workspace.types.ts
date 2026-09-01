export type OrderStarMutationResult =
  | { status: 'success'; orderId: string; starred: boolean }
  | { status: 'invalid'; message: string }
  | { status: 'not-found'; message: string };
