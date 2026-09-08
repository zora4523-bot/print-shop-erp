import { OrderChangeRequestError } from './change-request-error';
import { parseStrictYmd } from '@/lib/auth/schemas';

export function proposedDueDateText(
  value: Date | null | undefined,
): string | null | undefined {
  if (value == null) return value;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OrderChangeRequestError('承诺交期格式无效');
  }
  return value.toISOString().slice(0, 10);
}

export function readProposedDueDate(value: unknown): Date | null | undefined {
  if (!value || typeof value !== 'object' || !('promisedDate' in value)) {
    return undefined;
  }
  const date = value.promisedDate;
  if (date === null) return null;
  if (typeof date !== 'string') throw new OrderChangeRequestError('申请交期数据已损坏');
  const parsed = parseStrictYmd(date);
  if (!parsed) throw new OrderChangeRequestError('申请交期数据已损坏');
  return parsed;
}

export function dueDateChangePreview(proposed: unknown, current: Date | null) {
  const next = readProposedDueDate(proposed);
  return next === undefined ? undefined : {
    before: proposedDueDateText(current) ?? null,
    after: proposedDueDateText(next) ?? null,
  };
}
