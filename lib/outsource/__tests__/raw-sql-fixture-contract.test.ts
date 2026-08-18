import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('raw OutsourceOrder fixture contract', () => {
  it('writes every required field explicitly in each E2E fixture', () => {
    const file = path.join(process.cwd(), 'tests', 'e2e', '_helpers.ts');
    const source = readFileSync(file, 'utf8');
    const statements = [
      ...source.matchAll(
        /INSERT\s+INTO\s+"OutsourceOrder"\s*\(([\s\S]*?)\)\s*VALUES/giu,
      ),
    ];

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      const columns = statement[1] ?? '';
      expect(columns).toContain('"idempotencyKey"');
      expect(columns).toContain('"orderItemIds"');
    }
  });
});
