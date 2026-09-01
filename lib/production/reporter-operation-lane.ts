import {
  MachineType,
  PieceworkOperationType,
  Role,
  WorkerType,
} from '../../generated/prisma/enums';

export type OperationReporterAccount = {
  role: Role;
  isActive: boolean;
  workerType: WorkerType | null;
  machineType: MachineType | null;
};

/** One worker account has exactly one reportable operation lane. */
export function operationTypeForReporterAccount(
  account: OperationReporterAccount,
): PieceworkOperationType | null {
  if (account.role !== Role.WORKER || !account.isActive) return null;
  if (account.workerType === WorkerType.PACKER) {
    return PieceworkOperationType.PACKING;
  }
  if (
    account.workerType === WorkerType.MACHINE &&
    account.machineType === MachineType.HAND_PRESS
  ) {
    return PieceworkOperationType.PARTIAL;
  }
  if (
    account.workerType === WorkerType.MACHINE &&
    account.machineType === MachineType.WINDMILL
  ) {
    return PieceworkOperationType.FULL;
  }
  return null;
}
