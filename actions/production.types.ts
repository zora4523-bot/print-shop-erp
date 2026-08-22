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

// 报工表单的原样回填值。零 JS 下一次提交就是一次整页 POST + 服务端重渲染，
// 浏览器不保留输入框里的内容；不回填的话「超报被拦下 → 数字被重置回计划数
// → 勾确认再提交」会静默按计划数入库，正好把守卫要防的事情做实。
export type ReportTaskFormValues = {
  completedQty: string;
  defectQty: string;
  reworkQty: string;
  overReportConfirmed: boolean;
};

// 报工单独一个结果类型，不去加宽 TaskMutationResult：begin / reassign 共用
// 那个类型，它们不需要 values，也不该被报工的需求污染。
// 仍然只有 success | invalid | error 三个状态（CLAUDE.md §15.3）——「需要
// 确认」不是第四种状态，而是 invalid 的一个子情形：错误挂在
// fieldErrors.overReportConfirmed 上，复用既有逐字段错误的 aria 连线。
export type ReportTaskMutationResult =
  | { status: 'success'; taskId: string }
  | {
      status: 'invalid';
      fieldErrors: Record<string, string[]>;
      values: ReportTaskFormValues;
      // 只在「超过计划数、需要勾选确认」时出现。表单据此渲染确认框，
      // 判据来自服务端而不是输入框的 onChange —— 这是它在零 JS 下也能
      // 出现的原因。
      overReport?: { plannedQty: number; totalReported: number };
    }
  | {
      status: 'error';
      message: string;
      values: ReportTaskFormValues;
    };

export type BatchTaskMutationResult =
  | { status: 'success'; taskIds: string[] }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
