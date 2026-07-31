export type OrderMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateOrderMutationResult =
  | { status: 'success'; orderId: string; itemIds: string[] }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateReworkOrderMutationResult =
  | { status: 'success'; orderId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type CreateOrderChangeRequestMutationResult =
  | { status: 'success'; requestId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type ReviewOrderChangeRequestMutationResult =
  | { status: 'success'; requestStatus: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
