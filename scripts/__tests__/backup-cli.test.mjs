import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(contents, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-backup-cli-'));
  try {
    const file = join(dir, 'info.json'); writeFileSync(file, contents);
    return spawnSync(process.execPath, [resolve('scripts/check-backup-readiness.mjs'), '--info-file', file], {
      encoding: 'utf8', env: { ...process.env, PGBACKREST_STANZA: 'pg-meta', BACKUP_REQUIRED_REPOS: '2', BACKUP_MAX_AGE_HOURS: '30', ...env },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('CLI fails closed for invalid JSON without echoing its content', () => {
  const r = run('secret-fixture-invalid-json'); assert.equal(r.status, 1); assert.doesNotMatch(r.stderr+r.stdout, /secret-fixture-invalid-json/);
});
test('CLI does not substitute another stanza', () => { const r = run('[{"name":"other"}]'); assert.equal(r.status, 1); assert.match(r.stderr, /未找到 stanza/); });
test('CLI rejects fractional/invalid gate settings', () => {
  for (const env of [{ BACKUP_REQUIRED_REPOS: '1.5' }, { BACKUP_REQUIRED_REPOS: '0' }, { BACKUP_MAX_AGE_HOURS: 'garbage' }]) assert.equal(run('[]', env).status, 1);
});
test('CLI labels a valid offline snapshot accurately', () => {
  const end = '000000010000000000000001';
  const f = [{ name: 'pg-meta', status: { code: 0 },
    repo: [1, 2].map(key => ({ key, status: { code: 0 } })),
    db: [1, 2].map(key => ({ id: 1, 'repo-key': key })),
    backup: [1, 2].map(key => ({ type: 'full', error: false, database: { id: 1, 'repo-key': key }, timestamp: { stop: Math.floor(Date.now()/1000) }, archive: { stop: end } })),
    archive: [1, 2].map(key => ({ database: { id: 1, 'repo-key': key }, min: end, max: end })) }];
  const r = run(JSON.stringify(f)); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /离线快照/); assert.match(r.stdout, /通过/);
});
