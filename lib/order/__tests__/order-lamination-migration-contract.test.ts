import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260827100000_order_item_lamination',
    'migration.sql',
  ),
  'utf8',
);

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('order item lamination migration contract', () => {
  it('adds the five structured lamination values without rewriting history', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('CREATE TYPE "OrderLamination" AS ENUM');
    for (const value of [
      'NONE',
      'MATTE',
      'SOFT_TOUCH',
      'NEW_GLOSS',
      'LASER',
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain(
      'ADD COLUMN "lamination" "OrderLamination" NOT NULL DEFAULT \'NONE\'',
    );
    expect(migration).not.toMatch(/UPDATE\s+"OrderItem"/i);
  });

  it('enforces that only color-print items can carry lamination', () => {
    expect(migration).toContain(
      'ADD CONSTRAINT "OrderItem_lamination_pricing_route_check"',
    );
    expect(migration).toContain(
      '"pricingRoute" = \'COLOR_PRINT\'::"OrderItemPricingRoute"',
    );
    expect(migration).toContain(
      '"lamination" = \'NONE\'::"OrderLamination"',
    );
  });

  it('keeps the Prisma enum and persisted default aligned with SQL', () => {
    const enumBlock = schema.slice(
      schema.indexOf('enum OrderLamination {'),
      schema.indexOf('\n}', schema.indexOf('enum OrderLamination {')),
    );
    expect(enumBlock).toContain('NONE');
    expect(enumBlock).toContain('MATTE');
    expect(enumBlock).toContain('SOFT_TOUCH');
    expect(enumBlock).toContain('NEW_GLOSS');
    expect(enumBlock).toContain('LASER');

    const itemModel = schema.slice(
      schema.indexOf('model OrderItem {'),
      schema.indexOf('\n}', schema.indexOf('model OrderItem {')),
    );
    expect(itemModel).toContain(
      'lamination          OrderLamination       @default(NONE)',
    );
  });
});
