export type ScheduleOrderResult =
  | { status: 'success'; orderId: string; tasksCreated: number }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type TaskMutationResult =
  | { status: 'success'; taskId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
