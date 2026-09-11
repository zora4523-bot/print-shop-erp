import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = process.cwd();

describe('Prisma client synchronization contract', () => {
  it('regenerates the Prisma client before starting development', () => {
    const packageJson = JSON.parse(
      readFileSync(join(workspace, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.predev).toMatch(/(?:^|\s)prisma generate(?:\s|$)/);
  });

  // Playwright lifecycle and isolation behavior are verified by
  // tests/regression/playwright-database-isolation.test.ts and e2e-global-setup.test.ts.

  it('keeps the generated client schema byte-for-byte current', () => {
    const schema = readFileSync(join(workspace, 'prisma/schema.prisma'), 'utf8');
    const generatedSource = readFileSync(
      join(workspace, 'generated/prisma/internal/class.ts'),
      'utf8',
    );
    const inlineSchemaLiteral = generatedSource.match(
      /"inlineSchema":\s*("(?:\\.|[^"\\])*")/,
    )?.[1];

    expect(inlineSchemaLiteral).toBeDefined();
    expect(JSON.parse(inlineSchemaLiteral ?? '""')).toBe(schema);
  });

  it('keeps order creation on the generated transaction type', () => {
    const source = readFileSync(join(workspace, 'lib/order.ts'), 'utf8');

    expect(source).toContain('const txClient = tx;');
    expect(source).not.toContain('type OrderTxClient =');
    expect(source).not.toContain('as unknown as OrderTxClient');
  });
});
