import { TaskStatus } from '../../generated/prisma/enums';

// Thrown by `transitionProductionTask` when the requested change isn't
// in the allowed table. Callers (Server Actions) map to a generic
// "invalid operation" message — the UI shouldn't spell out the states
// to end users.
export class InvalidTaskTransitionError extends Error {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`生产任务状态不能从 ${from} 直接切到 ${to}`);
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
  }
}

// Canonical transitions (SPEC §4.3 / §3.3):
//   PENDING → IN_PROGRESS → COMPLETED
//   PENDING / IN_PROGRESS → CANCELLED (any non-terminal state can be cancelled)
//   COMPLETED and CANCELLED are terminal.
//
// Note: the SPEC text lists only PENDING → IN_PROGRESS → COMPLETED for
// the happy path. We also allow CANCELLED from non-terminals so a
// foreman can void a task (e.g. when the order gets cancelled and any
// in-flight work needs to wind down).
export const TASK_TRANSITIONS = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.CANCELLED]: [],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

// Pure guard. Same contract as `transitionOrder`.
//
// 单条路径的 TaskStatus 写入必须走这里。**批量路径是显式例外**
// （业主 2026-08-19 拍板，见 DECISIONS.md）：lib/production.ts 的
// beginTasks / reportTasks 用 `where: { status: <前置状态> }` 在 SQL 层
// 表达同一个守卫，换取单条语句的原子批量更新；逐行调用本函数会迫使先
// 查后写，丢掉原子性。改动那两处时要自己维持 where 子句与下方转换表
// 的一致性——没有编译期保障。
export function transitionProductionTask(
  from: TaskStatus,
  to: TaskStatus,
): TaskStatus {
  if (!canTransitionProductionTask(from, to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
  return to;
}

export function canTransitionProductionTask(
  from: TaskStatus,
  to: TaskStatus,
): boolean {
  const allowed = TASK_TRANSITIONS[from] as readonly TaskStatus[];
  return allowed.includes(to);
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status].length === 0;
}
