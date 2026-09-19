import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessBackupReadiness } from '../lib/backup-readiness.mjs';
const end = '000000010000000000000010';
const options = { stanza: 'production', nowSeconds: 1000000 };
function fixture() {
  return [{ name: 'production', status: { code: 0 },
    repo: [1, 2].map(key => ({ key, status: { code: 0 } })),
    db: [1, 2].map(key => ({ id: 1, 'repo-key': key })),
    backup: [1, 2].map(key => ({ type: 'full', error: false, database: { id: 1, 'repo-key': key }, timestamp: { stop: 999000 }, archive: { stop: end } })),
    archive: [1, 2].map(key => ({ database: { id: 1, 'repo-key': key }, min: end, max: end })) }];
}
test('accepts two healthy current repositories', () => assert.deepEqual(assessBackupReadiness(fixture(), options), []));
for (const [name, change] of [
  ['wrong stanza', s => { s.name = 'different'; }],
  ['stanza error', s => { s.status.code = 1; }],
  ['one repository', s => { s.repo.pop(); }],
  ['unhealthy remote', s => { s.repo[1].status.code = 1; }],
  ['duplicate repository', s => { s.repo[1].key = 1; }],
  ['stale remote backup', s => { s.backup[1].timestamp.stop = 1; }],
  ['future backup', s => { s.backup[1].timestamp.stop = 2000000; }],
  ['missing timestamp', s => { delete s.backup[1].timestamp.stop; }],
  ['error backup', s => { s.backup[1].error = true; }],
  ['old database only', s => { s.db.push({ id: 2, 'repo-key': 2 }); }],
  ['missing remote WAL', s => { s.archive.pop(); }],
  ['WAL behind full backup', s => { s.archive[1].max = '000000010000000000000009'; }],
  ['WAL starts after backup', s => { s.archive[1].min = '000000010000000000000011'; }],
  ['WAL belongs to old database', s => { s.archive[1].database.id = 0; }],
]) test(`rejects ${name}`, () => { const f = fixture(); change(f[0]); assert.ok(assessBackupReadiness(f, options).length); });
test('rejects invalid configuration and malformed response', () => {
  for (const requiredRepos of [0, -1, 1.5, NaN]) assert.ok(assessBackupReadiness(fixture(), { ...options, requiredRepos }).length);
  assert.ok(assessBackupReadiness(null, options).length);
});
