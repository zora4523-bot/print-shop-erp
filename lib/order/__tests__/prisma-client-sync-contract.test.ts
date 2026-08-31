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

  it('starts the Playwright server through the development lifecycle', () => {
    const source = readFileSync(join(workspace, 'playwright.config.ts'), 'utf8');

    expect(source).toMatch(/command:\s*`pnpm (?:run )?dev\b/);
    expect(source).not.toContain(
      'command: `node ./node_modules/next/dist/bin/next dev',
    );
  });

  it('isolates append-only production E2E facts from the normal database', () => {
    const config = readFileSync(
      join(workspace, 'playwright.config.ts'),
      'utf8',
    );
    const helpers = readFileSync(
      join(workspace, 'tests/e2e/_helpers.ts'),
      'utf8',
    );

    expect(config).toContain('E2E_DATABASE_URL');
    expect(config).toContain('pointsAtSameDatabase');
    expect(config).toContain(
      'reuseExistingServer: !hasIsolatedE2eDatabase && !process.env.CI',
    );
    expect(helpers).toContain('productionOperationE2eIsolationFailure()');
    expect(helpers.indexOf('productionOperationE2eIsolationFailure()')).toBeLessThan(
      helpers.indexOf('return withDb(async (db) => {', helpers.indexOf('seedE2eProductionOperationFixture')),
    );
  });

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
