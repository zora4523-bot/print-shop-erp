import type { Prisma } from '../../generated/prisma/client';

type LockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

export function agentPeriodLockKey(agentUserId: string, period: string): string {
  return `print-shop-erp:agent-monthly-billing:period:${agentUserId}:${period}`;
}

export function agentBillLockKey(billId: string): string {
  return `print-shop-erp:agent-monthly-billing:bill:${billId}`;
}

export function agentBillCreditLockKey(creditId: string): string {
  return `print-shop-erp:agent-monthly-billing:credit:${creditId}`;
}

export function agentBillRequestLockKey(
  kind: 'credit' | 'receipt' | 'confirm',
  idempotencyKey: string,
): string {
  return `print-shop-erp:agent-monthly-billing:${kind}-request:${idempotencyKey}`;
}

export async function lockAgentPeriod(
  tx: LockClient,
  agentUserId: string,
  period: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentPeriodLockKey(
    agentUserId,
    period,
  )}))`;
}

export async function lockAgentBill(
  tx: LockClient,
  billId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentBillLockKey(
    billId,
  )}))`;
}

export async function lockAgentBillCredit(
  tx: LockClient,
  creditId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentBillCreditLockKey(
    creditId,
  )}))`;
}

/** 串行化同一销售的补收录入，使累计待分摊补收的上限校验不被并发绕过。 */
export function agentSurchargeLockKey(agentUserId: string): string {
  return `print-shop-erp:agent-monthly-billing:surcharge:${agentUserId}`;
}

export async function lockAgentSurcharges(
  tx: LockClient,
  agentUserId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentSurchargeLockKey(
    agentUserId,
  )}))`;
}

export async function lockAgentBillRequest(
  tx: LockClient,
  kind: 'credit' | 'receipt' | 'confirm',
  idempotencyKey: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentBillRequestLockKey(
    kind,
    idempotencyKey,
  )}))`;
}
