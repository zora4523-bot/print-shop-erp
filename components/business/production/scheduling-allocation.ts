export type DraftAssignment = {
  clientId: string;
  taskId?: string;
  workerId: string;
  plannedQty: string;
  overrideReason: string;
};

export function assignmentIssue(
  assignments: DraftAssignment[],
  itemQuantity: number,
): string | null {
  if (assignments.length === 0) return '请至少添加一位师傅';
  if (assignments.some((assignment) => !assignment.workerId)) {
    return '请为每一条分配选择师傅';
  }
  const workerIds = assignments.map((assignment) => assignment.workerId);
  if (new Set(workerIds).size !== workerIds.length) {
    return '同一工艺的多条分配必须选择不同师傅';
  }
  const quantities = assignments.map((assignment) => {
    if (!/^\d+$/.test(assignment.plannedQty)) return null;
    const parsed = Number(assignment.plannedQty);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  });
  if (quantities.some((quantity) => quantity === null)) {
    return '每位师傅的分配数量必须是大于 0 的整数';
  }
  const allocatedQty = quantities.reduce<number>(
    (sum, quantity) => sum + (quantity ?? 0),
    0,
  );
  return allocatedQty === itemQuantity
    ? null
    : `当前合计 ${allocatedQty}，必须等于款式数量 ${itemQuantity}`;
}
