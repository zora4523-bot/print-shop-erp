export type ScheduleOrderResult =
  | { status: 'success'; orderId: string; tasksCreated: number }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type BatchScheduleOrdersActionResult =
  | {
      status: 'success' | 'partial';
      assigned: Array<{
        orderId: string;
        orderNo: string;
        tasksCreated: number;
        remainingTaskCount: number;
        fullyScheduled: boolean;
      }>;
      failed: Array<{
        orderId: string;
        orderNo: string | null;
        message: string;
      }>;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export type TaskMutationResult =
  | { status: 'success'; taskId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type BatchTaskMutationResult =
  | { status: 'success'; taskIds: string[] }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
