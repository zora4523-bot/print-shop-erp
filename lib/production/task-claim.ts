import {
  MachineType,
  OrderStatus,
  Role,
  TaskStatus,
  WorkerType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { databaseNow } from '../background-jobs/clock';
import { orderCascadeLockKey } from '../order/locks';
import { resolveSetting } from '../settings/definitions';
import { acquireWorkerSelfClaimSettingReadLock } from '../settings/locks';

export class TaskClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskClaimError';
  }
}

type TaskClaimTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  setting: {
    findUnique: (args: unknown) => Promise<{ value: unknown } | null>;
  };
  productionTask: {
    findUnique: (args: unknown) => Promise<ClaimTaskRecord | null>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  user: {
    findUnique: (args: unknown) => Promise<ClaimWorkerRecord | null>;
  };
  orderLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

type ClaimTaskRecord = {
  id: string;
  status: TaskStatus;
  workerId: string | null;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  isSelfClaimable: boolean;
  selfClaimOpenedAt: Date | null;
  selfClaimedAt: Date | null;
  claimMachineTypes: MachineType[];
  orderItem: {
    name: string;
    sequence: number;
    orderId: string;
    order: { id: string; orderNo: string; status: OrderStatus };
  };
  craft: {
    id: string;
    name: string;
    isActive: boolean;
    isOutsource: boolean;
    defaultWorkerType: WorkerType | null;
    defaultMachineType: MachineType | null;
    inHouseMachineTypes: MachineType[];
  };
  worker: { displayName: string } | null;
};

type ClaimWorkerRecord = {
  id: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  machineCapabilities: MachineType[];
  craftCapabilities: Array<{ craftId: string }>;
};

type ClaimTaskActor = { id: string; role: Role };

export type ReleaseTaskToClaimPoolResult = {
  taskId: string;
  orderId: string;
  previousWorkerId: string | null;
};

export type ClaimTaskResult = {
  taskId: string;
  orderId: string;
  workerId: string;
  machineType: MachineType | null;
};

export type ClaimableTaskListRow = {
  id: string;
  workerType: WorkerType;
  plannedQty: number;
  claimMachineTypes: MachineType[];
  item: {
    name: string;
    sequence: number;
  };
  craft: { name: string };
  order: {
    orderNo: string;
    customName: string | null;
    isUrgent: boolean;
    promisedDate: Date | null;
    submitterName: string;
  };
};

function openClaimMachineTypes(task: ClaimTaskRecord): MachineType[] {
  if (task.craft.defaultWorkerType !== WorkerType.MACHINE) return [];
  const allowed =
    task.craft.inHouseMachineTypes.length > 0
      ? task.craft.inHouseMachineTypes
      : task.craft.defaultMachineType
        ? [task.craft.defaultMachineType]
        : [];
  return [...new Set(allowed)];
}

function workerMachines(worker: ClaimWorkerRecord): MachineType[] {
  return [
    ...new Set([
      ...(worker.machineType ? [worker.machineType] : []),
      ...worker.machineCapabilities,
    ]),
  ];
}

function resolveClaimMachineType(
  worker: ClaimWorkerRecord,
  allowed: MachineType[],
): MachineType | null {
  if (worker.workerType !== WorkerType.MACHINE) return null;
  const capabilities = workerMachines(worker);
  if (worker.machineType && allowed.includes(worker.machineType)) {
    return worker.machineType;
  }
  return allowed.find((machine) => capabilities.includes(machine)) ?? null;
}

async function readSelfClaimEnabled(tx: TaskClaimTxClient): Promise<boolean> {
  const row = await tx.setting.findUnique({
    where: { key: 'worker_self_claim_enabled' },
    select: { value: true },
  });
  return resolveSetting('worker_self_claim_enabled', row?.value).enabled;
}

async function readTaskForMutation(
  tx: TaskClaimTxClient,
  taskId: string,
): Promise<ClaimTaskRecord | null> {
  return tx.productionTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      workerId: true,
      workerType: true,
      machineType: true,
      isSelfClaimable: true,
      selfClaimOpenedAt: true,
      selfClaimedAt: true,
      claimMachineTypes: true,
      orderItem: {
        select: {
          name: true,
          sequence: true,
          orderId: true,
          order: { select: { id: true, orderNo: true, status: true } },
        },
      },
      craft: {
        select: {
          id: true,
          name: true,
          isActive: true,
          isOutsource: true,
          defaultWorkerType: true,
          defaultMachineType: true,
          inHouseMachineTypes: true,
        },
      },
      worker: { select: { displayName: true } },
    },
  });
}

async function acquireClaimMutationLocks(
  tx: TaskClaimTxClient,
  orderId: string,
): Promise<boolean> {
  // 全局顺序必须固定为 Setting -> Order：关闭开关要等所有在途
  // 抢单提交，而抢单又必须和取消/改派/开工共用工单锁。
  await acquireWorkerSelfClaimSettingReadLock(tx);
  const enabled = await readSelfClaimEnabled(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    orderId,
  )}))`;
  return enabled;
}

function assertClaimableOrderStatus(status: OrderStatus): void {
  if (
    status !== OrderStatus.SCHEDULING &&
    status !== OrderStatus.IN_PRODUCTION
  ) {
    throw new TaskClaimError('工单尚未完成排产或已结束，不能抢单');
  }
}

export async function releaseTaskToClaimPool(
  taskId: string,
  actor: ClaimTaskActor,
): Promise<ReleaseTaskToClaimPoolResult> {
  if (actor.role !== Role.ADMIN) {
    throw new TaskClaimError('只有管理员可以将任务释放到抢单池');
  }

  return db.$transaction(async (prismaTx) => {
    const tx = prismaTx as unknown as TaskClaimTxClient;
    // 无锁预读只用于得到 orderId；所有业务判定都在两把锁之后重读。
    const pre = await tx.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (!pre) throw new TaskClaimError('任务不存在');
    const preOrderId = (pre as unknown as { orderItem: { orderId: string } })
      .orderItem.orderId;

    const enabled = await acquireClaimMutationLocks(tx, preOrderId);
    const task = await readTaskForMutation(tx, taskId);
    if (!task) throw new TaskClaimError('任务不存在');
    if (!enabled) throw new TaskClaimError('师傅自由抢单已关闭');
    if (task.status !== TaskStatus.PENDING) {
      throw new TaskClaimError('只有未开工任务可以释放到抢单池');
    }
    assertClaimableOrderStatus(task.orderItem.order.status);
    if (task.isSelfClaimable && task.workerId === null) {
      return {
        taskId: task.id,
        orderId: task.orderItem.orderId,
        previousWorkerId: null,
      };
    }
    if (
      !task.craft.isActive ||
      (task.craft.isOutsource && task.craft.inHouseMachineTypes.length === 0) ||
      !task.craft.defaultWorkerType ||
      task.craft.defaultWorkerType === WorkerType.COOK
    ) {
      throw new TaskClaimError('该工艺未配置可抢单的内部生产岗位');
    }
    const allowedMachines = openClaimMachineTypes(task);
    if (
      task.craft.defaultWorkerType === WorkerType.MACHINE &&
      allowedMachines.length === 0
    ) {
      throw new TaskClaimError('该开机工艺未配置可用机型');
    }

    const openedAt = await databaseNow(prismaTx);
    const previousWorkerId = task.workerId;
    await tx.productionTask.update({
      where: { id: task.id },
      data: {
        workerId: null,
        workerType: task.craft.defaultWorkerType,
        machineType: null,
        isSelfClaimable: true,
        selfClaimOpenedAt: openedAt,
        selfClaimedAt: null,
        claimMachineTypes: allowedMachines,
      },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: task.orderItem.orderId,
        operatorId: actor.id,
        action: 'TASK_RELEASE_TO_POOL',
        changedFields: {
          taskId: { before: task.id, after: task.id },
          workerId: { before: previousWorkerId, after: null },
          isSelfClaimable: { before: false, after: true },
          workerType: {
            before: task.workerType,
            after: task.craft.defaultWorkerType,
          },
          claimMachineTypes: {
            before: task.claimMachineTypes,
            after: allowedMachines,
          },
        },
        remark: `释放到抢单池：${task.orderItem.name} (#${task.orderItem.sequence})${
          task.worker?.displayName ? `；原师傅：${task.worker.displayName}` : ''
        }`,
      },
    });
    return { taskId: task.id, orderId: task.orderItem.orderId, previousWorkerId };
  });
}

export async function claimTask(
  taskId: string,
  actor: ClaimTaskActor,
): Promise<ClaimTaskResult> {
  if (actor.role !== Role.WORKER) {
    throw new TaskClaimError('只有师傅可以抢单');
  }

  return db.$transaction(async (prismaTx) => {
    const tx = prismaTx as unknown as TaskClaimTxClient;
    const pre = await tx.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (!pre) throw new TaskClaimError('任务不存在');
    const preOrderId = (pre as unknown as { orderItem: { orderId: string } })
      .orderItem.orderId;

    const enabled = await acquireClaimMutationLocks(tx, preOrderId);
    const task = await readTaskForMutation(tx, taskId);
    if (!task) throw new TaskClaimError('任务不存在');

    // 取消会保留已抢任务的 selfClaimedAt 作为历史证据，
    // 因此必须在幂等分支前明确拒绝，避免陈旧表单假返回“抢单成功”。
    if (
      task.status === TaskStatus.CANCELLED ||
      task.orderItem.order.status === OrderStatus.CANCELLED
    ) {
      throw new TaskClaimError('该任务已随工单取消，不能抢单');
    }

    // 弱网重提/响应丢失要能原样恢复成功结果。它不是一次新抢单，
    // 因此即使管理员刚关闭开关也允许幂等返回。
    if (task.workerId === actor.id && task.selfClaimedAt) {
      return {
        taskId: task.id,
        orderId: task.orderItem.orderId,
        workerId: actor.id,
        machineType: task.machineType,
      };
    }
    if (!enabled) throw new TaskClaimError('师傅自由抢单已关闭');
    if (
      task.status !== TaskStatus.PENDING ||
      !task.isSelfClaimable ||
      task.workerId !== null ||
      !task.selfClaimOpenedAt
    ) {
      throw new TaskClaimError('该任务已被抢走或不在抢单池');
    }
    assertClaimableOrderStatus(task.orderItem.order.status);

    const worker = await tx.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        displayName: true,
        role: true,
        isActive: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
        craftCapabilities: { select: { craftId: true } },
      },
    });
    if (!worker || worker.role !== Role.WORKER || !worker.isActive) {
      throw new TaskClaimError('当前师傅账号不可用');
    }
    if (
      !task.workerType ||
      task.workerType === WorkerType.COOK ||
      worker.workerType !== task.workerType
    ) {
      throw new TaskClaimError('当前师傅的岗位与该任务不匹配');
    }
    if (
      !worker.craftCapabilities.some(
        (capability) => capability.craftId === task.craft.id,
      )
    ) {
      throw new TaskClaimError('当前师傅未登记该工艺能力，不能自行抢单');
    }
    const resolvedMachineType =
      task.workerType === WorkerType.MACHINE
        ? resolveClaimMachineType(worker, task.claimMachineTypes)
        : null;
    if (
      task.workerType === WorkerType.MACHINE &&
      resolvedMachineType === null
    ) {
      throw new TaskClaimError('当前师傅的机型能力与该任务不匹配');
    }

    const claimedAt = await databaseNow(prismaTx);
    const claimed = await tx.productionTask.updateMany({
      where: {
        id: task.id,
        status: TaskStatus.PENDING,
        workerId: null,
        isSelfClaimable: true,
      },
      data: {
        workerId: worker.id,
        machineType: resolvedMachineType,
        isSelfClaimable: false,
        selfClaimedAt: claimedAt,
      },
    });
    if (claimed.count !== 1) {
      throw new TaskClaimError('该任务已被其他师傅抢走');
    }
    await tx.orderLog.create({
      data: {
        orderId: task.orderItem.orderId,
        operatorId: actor.id,
        action: 'TASK_SELF_CLAIM',
        changedFields: {
          taskId: { before: task.id, after: task.id },
          workerId: { before: null, after: worker.id },
          isSelfClaimable: { before: true, after: false },
          machineType: { before: null, after: resolvedMachineType },
        },
        remark: `师傅抢单：${task.orderItem.name} (#${task.orderItem.sequence}) → ${worker.displayName}`,
      },
    });
    return {
      taskId: task.id,
      orderId: task.orderItem.orderId,
      workerId: worker.id,
      machineType: resolvedMachineType,
    };
  });
}

export async function listClaimableTasks(
  actor: ClaimTaskActor,
): Promise<ClaimableTaskListRow[]> {
  if (actor.role !== Role.WORKER) return [];
  const { enabled } = resolveSetting(
    'worker_self_claim_enabled',
    (
      await db.setting.findUnique({
        where: { key: 'worker_self_claim_enabled' },
        select: { value: true },
      })
    )?.value,
  );
  if (!enabled) return [];

  const worker = await db.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      displayName: true,
      role: true,
      isActive: true,
      workerType: true,
      machineType: true,
      machineCapabilities: true,
      craftCapabilities: { select: { craftId: true } },
    },
  });
  if (
    !worker ||
    worker.role !== Role.WORKER ||
    !worker.isActive ||
    !worker.workerType ||
    worker.workerType === WorkerType.COOK
  ) {
    return [];
  }
  const craftIds = worker.craftCapabilities.map((item) => item.craftId);
  if (craftIds.length === 0) return [];
  const machines = workerMachines(worker);
  if (worker.workerType === WorkerType.MACHINE && machines.length === 0) {
    return [];
  }

  // 这里故意只返回抢单卡片需要的最小 DTO。未抢任务不经
  // getWorkerTaskDetail，也不放宽 getWorkerTaskScopeFilter。
  const rows = await db.productionTask.findMany({
    where: {
      isSelfClaimable: true,
      workerId: null,
      status: TaskStatus.PENDING,
      workerType: worker.workerType,
      craftId: { in: craftIds },
      ...(worker.workerType === WorkerType.MACHINE
        ? { claimMachineTypes: { hasSome: machines } }
        : {}),
      orderItem: {
        order: {
          status: { in: [OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION] },
        },
      },
    },
    select: {
      id: true,
      workerType: true,
      plannedQty: true,
      claimMachineTypes: true,
      orderItem: {
        select: {
          name: true,
          sequence: true,
          order: {
            select: {
              orderNo: true,
              customName: true,
              isUrgent: true,
              promisedDate: true,
              submitter: { select: { displayName: true } },
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
    orderBy: [
      { orderItem: { order: { isUrgent: 'desc' } } },
      { orderItem: { order: { promisedDate: { sort: 'asc', nulls: 'last' } } } },
      { createdAt: 'asc' },
    ],
  });

  return rows.flatMap((row) =>
    row.workerType
      ? [
          {
            id: row.id,
            workerType: row.workerType,
            plannedQty: row.plannedQty,
            claimMachineTypes: row.claimMachineTypes,
            item: {
              name: row.orderItem.name,
              sequence: row.orderItem.sequence,
            },
            craft: { name: row.craft.name },
            order: {
              orderNo: row.orderItem.order.orderNo,
              customName: row.orderItem.order.customName,
              isUrgent: row.orderItem.order.isUrgent,
              promisedDate: row.orderItem.order.promisedDate,
              submitterName: row.orderItem.order.submitter.displayName,
            },
          },
        ]
      : [],
  );
}
