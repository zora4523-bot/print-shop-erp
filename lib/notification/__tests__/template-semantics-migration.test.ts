import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260902121200_notification_template_semantics/migration.sql',
  ),
  'utf8',
);

describe('notification template semantics migration', () => {
  it('makes newly inserted rules fail closed unless explicitly enabled', () => {
    expect(migration).toContain(
      'ALTER COLUMN "isActive" SET DEFAULT false',
    );
  });

  it('updates only the exact historical defaults and preserves custom templates', () => {
    expect(migration).toContain(`"eventType" = 'ORDER_SCHEDULED'`);
    expect(migration).toContain(`"eventType" = 'ORDER_COMPLETED'`);
    expect(migration).toContain(`"messageTemplate" = '**工单已排产**`);
    expect(migration).toContain(`"messageTemplate" = '**工单完工**`);
    expect(migration).toContain('**工单已下发**');
    expect(migration).toContain('**生产已完成**');
    expect(migration).not.toMatch(
      /WHERE\s+"eventType"\s*=\s*'ORDER_(?:SCHEDULED|COMPLETED)'\s*;/u,
    );
  });
});
