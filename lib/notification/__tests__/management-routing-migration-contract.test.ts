import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260902120700_management_notification_routing_setting/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('management notification routing migration', () => {
  it('只从五个托管事件的存量 active channel ID 初始化固定角色', () => {
    for (const event of [
      'ORDER_SUBMITTED',
      'ORDER_CHANGE_REQUESTED',
      'PRODUCTION_PROGRESS_ANOMALY',
      'PRODUCTION_STAGNANT',
      'PENDING_FACTORY_BACKLOG',
    ]) {
      expect(migration).toContain(`'${event}'`);
    }
    expect(migration).toContain("THEN 'factoryConfirmer'");
    expect(migration).toContain("THEN 'owner'");
    expect(migration).toContain('channel."isActive" = TRUE');
    expect(migration).toContain("'management_notification_routing'");
    expect(migration).toContain(
      "'enabled', jsonb_array_length(\"factoryConfirmerIds\") > 0",
    );
    expect(migration).toContain('ON CONFLICT ("key") DO NOTHING');
  });
});
