import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807181000_outsource_payment_ledger',
    'migration.sql',
  ),
  'utf8',
);

describe('outsource payment ledger contract', () => {
  it('keeps a dedicated append-only model related to the outsource order and recorder', () => {
    const model = schema.slice(
      schema.indexOf('model OutsourcePayment {'),
      schema.indexOf('// ============================================================\n// CDR', schema.indexOf('model OutsourcePayment {')),
    );

    expect(model).toContain('idempotencyKey   String   @unique');
    expect(model).toContain('amount           Decimal  @db.Decimal(12, 2)');
    expect(model).toContain('paidAt           DateTime');
    expect(model).toContain('recordedById     String');
    expect(model).toContain(
      'outsourceOrder OutsourceOrder @relation(fields: [outsourceOrderId], references: [id], onDelete: Restrict)',
    );
    expect(model).toContain(
      'recordedBy     User           @relation("OutsourcePaymentRecorder", fields: [recordedById], references: [id], onDelete: Restrict)',
    );
    expect(schema).toContain('payments      OutsourcePayment[]');
    expect(schema).toMatch(
      /recordedOutsourcePayments\s+OutsourcePayment\[\]\s+@relation\("OutsourcePaymentRecorder"\)/,
    );
  });

  it('enforces positive amounts, unique request keys, restrictive foreign keys, and query indexes in SQL', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('CREATE TABLE "OutsourcePayment"');
    expect(migration).toContain('"amount" DECIMAL(12, 2) NOT NULL');
    expect(migration).toContain(
      'CONSTRAINT "OutsourcePayment_amount_positive" CHECK ("amount" > 0)',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "OutsourcePayment_idempotencyKey_key"',
    );
    expect(migration.match(/ON DELETE RESTRICT ON UPDATE CASCADE/g)).toHaveLength(
      2,
    );
    expect(migration).toContain(
      '"OutsourcePayment_outsourceOrderId_paidAt_idx"',
    );
    expect(migration).toContain(
      '"OutsourcePayment_recordedById_createdAt_idx"',
    );
  });

  it('does not write sales bills or employee payroll from the payment domain', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib', 'outsource.ts'),
      'utf8',
    );
    const paymentDomain = source.slice(
      source.indexOf('export async function recordOutsourcePayment('),
      source.indexOf('export type OutsourceMutationResult'),
    );

    expect(paymentDomain).toContain('tx.outsourcePayment.create');
    expect(paymentDomain).not.toMatch(
      /tx\.(?:bill|billPayment|salaryPeriod|dailyWorkerSalary|hourlyWorkerPayroll|csPayrollPayment)\b/,
    );
  });
});
