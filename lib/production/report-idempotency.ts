import { createHash } from 'node:crypto';
import { formatDateInputShanghai } from '../format/dates';

/** Legacy request keys remain valid; the scanner uses a refresh-stable batch scope. */
export function reportIdempotencyKey(input: {
  key: string; kind: 'operation' | 'progress'; targetId: string; reporterId: string;
  completedQty: number; defectQty: number; reworkQty: number;
  workOrderProgressQuantity?: number;
}, now = new Date()): string {
  if (!input.key.startsWith('batch:')) return input.key;
  if (!/^batch:(0|[1-9]\d{0,8})$/.test(input.key)) throw new Error('Invalid report batch');
  const facts = [input.kind, input.targetId, input.reporterId, input.completedQty,
    input.defectQty, input.reworkQty, input.workOrderProgressQuantity ?? null,
    formatDateInputShanghai(now), Number(input.key.slice(6))];
  return `report:${createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
}
