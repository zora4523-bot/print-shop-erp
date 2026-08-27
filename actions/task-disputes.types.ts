export type TaskDisputeMutationResult =
  | {
      status: 'success';
      disputeId: string;
      taskId: string;
      orderId: string;
      message: string;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
