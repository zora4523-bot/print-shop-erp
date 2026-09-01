import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const foundationMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120000_admin_order_workflow_billing_foundations',
    'migration.sql',
  ),
  'utf8',
);
const concurrentIndexMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120100_order_settlement_candidate_index',
    'migration.sql',
  ),
  'utf8',
);

function prismaBlock(kind: 'enum' | 'model', name: string): string {
  const match = schema.match(
    new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`Missing Prisma ${kind} ${name}`);
  return match[1];
}

describe('admin workflow and monthly billing foundation migration contract', () => {
  it('expands the lifecycle while preserving every legacy value', () => {
    const statuses = prismaBlock('enum', 'OrderStatus');
    for (const status of [
      'DRAFT',
      'PENDING_FACTORY',
      'REJECTED',
      'CONFIRMED',
      'ON_HOLD',
      'RELEASED',
      'FOILING',
      'PACKING',
      'SHIPPED',
      'SETTLED',
      'CANCELLED',
      'SUBMITTED',
      'SCHEDULING',
      'IN_PRODUCTION',
      'COMPLETED',
      'FINISHED',
    ]) {
      expect(statuses).toMatch(new RegExp(`\\b${status}\\b`));
    }

    const requestStatuses = prismaBlock(
      'enum',
      'OrderChangeRequestStatus',
    );
    for (const status of [
      'PENDING',
      'APPROVED',
      'DENIED',
      'WITHDRAWN',
      'REJECTED',
      'CANCELLED',
      'STALE',
    ]) {
      expect(requestStatuses).toMatch(new RegExp(`\\b${status}\\b`));
    }

    expect(foundationMigration).toContain(
      'ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS',
    );
    expect(foundationMigration).not.toMatch(
      /DROP\s+(?:TYPE|TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"Order"/i,
    );
    expect(foundationMigration).not.toMatch(/ALTER TABLE "Bill"/);
  });

  it('adds versioned settlement, change adjudication, stars, and selected-export membership', () => {
    const order = prismaBlock('model', 'Order');
    expect(order).toMatch(/workOrderVersion\s+Int\s+@default\(1\)/);
    expect(order).toMatch(/settledAt\s+DateTime\?/);
    expect(order).toMatch(/settlementContractVersion\s+Int\?/);

    const request = prismaBlock('model', 'OrderChangeRequest');
    expect(request).toContain('type                  OrderChangeRequestType');
    expect(request).toContain('modifyKind            OrderChangeModifyKind?');
    expect(request).toContain('producedQty           Int?');
    expect(request).toContain('settleFee             Decimal?');
    expect(request).toContain('workOrderVersionAfter Int?');

    expect(prismaBlock('model', 'UserOrderStar')).toContain(
      '@@unique([userId, orderId])',
    );
    const selection = prismaBlock('model', 'OrderExportSelection');
    expect(selection).toContain('@@unique([exportId, orderId])');
    expect(selection).toContain('@@unique([exportId, sequence])');
    expect(selection).toContain('onDelete: Cascade');
    expect(selection).toContain('onDelete: Restrict');
  });

  it('stores reject, hold, and resume as immutable reasoned decisions', () => {
    const decisions = prismaBlock('model', 'OrderWorkflowDecision');
    for (const field of [
      'orderId',
      'fromStatus',
      'toStatus',
      'action',
      'reasonCode',
      'reasonNote',
      'affectedFigs',
      'recoveryEvidence',
      'actorId',
      'idempotencyKey',
      'createdAt',
    ]) {
      expect(decisions).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(prismaBlock('enum', 'OrderWorkflowReasonCode')).toMatch(
      /PAPER_OUT[\s\S]*DESIGN_ERROR[\s\S]*PRICE_PENDING/,
    );
    expect(foundationMigration).toContain(
      'CREATE TRIGGER "OrderWorkflowDecision_immutable"',
    );
    expect(foundationMigration).toContain(
      '"recoveryEvidence" <> \'{}\'::jsonb',
    );
  });

  it('keeps print acknowledgements and billing corrections as immutable ledgers', () => {
    const printJob = prismaBlock('model', 'OrderPrintJob');
    expect(printJob).toContain('requestJobId     String?');
    expect(printJob).not.toContain(
      '@@unique([orderId, workOrderVersion, state])',
    );
    expect(printJob).toContain('idempotencyKey   String             @unique');
    expect(foundationMigration).toContain(
      'CREATE TRIGGER "OrderPrintJob_immutable"',
    );

    const credit = prismaBlock('model', 'AgentMonthlyBillCredit');
    expect(credit).toContain('sourceItemId');
    expect(credit).toContain('requestedAmount');
    expect(credit).toContain('idempotencyKey');
    expect(credit).not.toMatch(/remaining/i);

    const allocation = prismaBlock('model', 'AgentMonthlyBillAdjustment');
    expect(allocation).toContain('creditId');
    expect(allocation).toContain('@@unique([creditId, billId])');
    expect(allocation).not.toMatch(/remaining/i);
    expect(foundationMigration).toContain(
      'CREATE TRIGGER "AgentMonthlyBillCredit_immutable"',
    );
    expect(foundationMigration).toContain(
      'Credit allocations require a later DRAFT bill for the same agent',
    );
    expect(foundationMigration).toContain(
      'Requested credit exceeds its source member amount',
    );
  });

  it('allows zero-value receipts while freezing confirmed financial facts', () => {
    expect(foundationMigration).toContain('CHECK (\n      "amount" >= 0');
    expect(foundationMigration).toContain(
      'NEW."totalAmount" <> OLD."totalAmount"',
    );
    for (const field of [
      'settledFee',
      'settledAt',
      'settlementContractVersion',
      'submitterId',
      'settlementType',
      'billingMode',
    ]) {
      expect(foundationMigration).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    expect(schema).toMatch(/model Bill \{/);
    expect(schema).toMatch(/model BillItem \{/);
    expect(schema).toMatch(/model BillPayment \{/);
  });

  it('builds the settlement candidate index in its own non-transactional migration', () => {
    expect(foundationMigration).not.toContain(
      'Order_settlement_candidate_idx',
    );
    expect(concurrentIndexMigration.trim()).toMatch(
      /^CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_settlement_candidate_idx"[\s\S]+WHERE "settledFee" IS NOT NULL;$/,
    );
    expect(concurrentIndexMigration).not.toMatch(
      /^\s*(?:BEGIN|COMMIT|START\s+TRANSACTION)\s*;/im,
    );
    expect(concurrentIndexMigration.match(/;/g)).toHaveLength(1);
  });
});
